import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import ezdxf
from ezdxf.lldxf.encoding import decode_dxf_unicode
from ezdxf.math import Vec3

from generate_fixtures import CORPUS


WEIGHTS = {-1: "by-layer", -2: "by-block", -3: "default"}
LINETYPES = {"BYLAYER": "by-layer", "BYBLOCK": "by-block", "CONTINUOUS": "continuous"}
GEOMETRY_TYPES = {"LINE": "line", "CIRCLE": "circle", "ARC": "arc", "LWPOLYLINE": "polyline"}
UNITS = {0: "unitless", 1: "inches", 4: "millimeters"}
NORMALS = {(0, 0, 1): "supported", (0, 0, -1): "converted"}


def classification(entity):
    if entity.dxftype() not in GEOMETRY_TYPES:
        return "unsupported"
    return NORMALS.get(tuple(entity.dxf.extrusion), "unsupported")


def normalized_layer(properties):
    return {**properties, "visible": properties["visible"] and not properties["frozen"]}


def angles_normalized(geometry):
    segments = geometry["segments"] if geometry["type"] == "polyline" else [geometry]
    return all(0 <= segment["startAngle"] < math.tau for segment in segments if segment["type"] == "arc")


def layer_properties(layer):
    return {
        "name": decode_dxf_unicode(layer.dxf.name), "color": abs(layer.dxf.color),
        "visible": not layer.is_off(), "frozen": layer.is_frozen(), "locked": layer.is_locked(),
        "lineweight": WEIGHTS.get(layer.dxf.lineweight, layer.dxf.lineweight),
        "linetype": LINETYPES[layer.dxf.linetype.upper()],
    }


def entity_properties(entity):
    return {
        "sourceType": entity.dxftype(), "layerName": decode_dxf_unicode(entity.dxf.layer),
        "color": "by-layer" if entity.dxf.color == 256 else entity.dxf.color,
        "lineweight": WEIGHTS.get(entity.dxf.lineweight, entity.dxf.lineweight),
        "linetype": LINETYPES[entity.dxf.linetype.upper()],
    }


def vector(point):
    return Vec3(point["x"], point["y"])


def samples(geometry):
    if geometry["type"] == "line":
        start, end = vector(geometry["start"]), vector(geometry["end"])
        return [start.lerp(end, fraction) for fraction in (0, 0.5, 1)]
    angles = [geometry["startAngle"] + geometry["sweep"] * fraction
              for fraction in (0, 0.5, 1)]
    return [vector(geometry["center"]) + Vec3(math.cos(angle), math.sin(angle))
            * geometry["radius"] for angle in angles]


def source_samples(entity):
    if entity.dxftype() == "LINE":
        return [entity.dxf.start.lerp(entity.dxf.end, fraction)
                for fraction in (0, 0.5, 1)]
    start = entity.dxf.start_angle
    sweep = (entity.dxf.end_angle - start) % 360
    return list(entity.vertices(start + sweep * fraction for fraction in (0, 0.5, 1)))


def close_points(actual, expected):
    return len(actual) == len(expected) and all(
        left.isclose(right, rel_tol=0, abs_tol=1e-7)
        for left, right in zip(actual, expected)
    )


def matching_part(entity, geometry):
    if GEOMETRY_TYPES.get(entity.dxftype()) != geometry["type"]:
        return False
    actual, expected = source_samples(entity), samples(geometry)
    return close_points(actual, expected) or close_points(actual, expected[::-1])


def polyline_matches(entity, geometry):
    segments = geometry["segments"]
    parts = list(entity.virtual_entities())
    if entity.closed != geometry["closed"] or len(parts) != len(segments):
        return False
    vertices = [samples(segment)[0] for segment in segments]
    if not geometry["closed"]:
        vertices.append(samples(segments[-1])[-1])
    if not close_points(list(entity.vertices_in_wcs()), vertices):
        return False
    return all(matching_part(part, segment) for part, segment in zip(parts, segments))


def geometry_matches(entity, geometry):
    if GEOMETRY_TYPES.get(entity.dxftype()) != geometry["type"]:
        return False
    if geometry["type"] == "circle":
        center = entity.ocs().to_wcs(entity.dxf.center)
        return center.isclose(vector(geometry["center"]), rel_tol=0, abs_tol=1e-7) and math.isclose(
            entity.dxf.radius, geometry["radius"], rel_tol=0, abs_tol=1e-7)
    if geometry["type"] == "polyline":
        return polyline_matches(entity, geometry)
    return close_points(source_samples(entity), samples(geometry))


class FixtureTests(unittest.TestCase):
    def test_authored_expectations_match_serialized_drawings(self):
        manifests = sorted(CORPUS.glob("*.expected.json"))
        self.assertEqual(len(manifests), 5)
        unit_codes, unsupported, count = set(), set(), 0
        for path in manifests:
            expected = json.loads(path.read_text())
            document = ezdxf.readfile(path.with_name(path.name.replace(".expected.json", ".dxf")), errors="strict")
            self.assertEqual(document.dxfversion, "AC1015")
            self.assertEqual(document.units, expected["unitCode"])
            self.assertEqual(document.header["$CLAYER"], expected["currentLayer"])
            self.assertEqual(document.header["$MEASUREMENT"], expected["measurement"])
            self.assertEqual(expected["units"], UNITS[document.units])
            unit_codes.add(document.units)
            layers = {decode_dxf_unicode(layer.dxf.name): layer for layer in document.layers}
            self.assertEqual(set(layers), {layer["name"] for layer in expected["layers"]})
            for layer in expected["layers"]:
                self.assertEqual(normalized_layer(layer_properties(layers[layer["name"]])), layer)
            entities = list(document.modelspace())
            if path.name == "flipped-unitless.expected.json":
                self.assertEqual({entity.dxftype() for entity in entities}, set(GEOMETRY_TYPES))
                self.assertTrue(all(tuple(entity.dxf.extrusion) == (0, 0, -1) for entity in entities))
            self.assertEqual([entity.dxf.handle for entity in entities], [item["handle"] for item in expected["entities"]])
            for actual, item in zip(entities, expected["entities"]):
                properties = entity_properties(actual)
                self.assertEqual(properties, {key: item[key] for key in properties})
                self.assertEqual(classification(actual), item["classification"], (path.name, item["handle"]))
                if item["geometry"] is None:
                    unsupported.add(item["sourceType"])
                else:
                    self.assertTrue(geometry_matches(actual, item["geometry"]), (path.name, item["handle"]))
                    self.assertTrue(angles_normalized(item["geometry"]), (path.name, item["handle"]))
            supported = all(item["classification"] != "unsupported" for item in expected["entities"])
            self.assertEqual(expected["editable"], supported, path.name)
            count += len(entities)
            audit = document.audit()
            self.assertEqual((len(audit.errors), len(audit.fixes)), (0, 0), path.name)
        self.assertEqual((unit_codes, count, unsupported), ({0, 1, 4}, 16, {"TEXT", "INSERT", "HATCH", "DIMENSION"}))

    def test_fresh_processes_match_committed_bytes_and_check_never_writes(self):
        script = Path(__file__).with_name("generate_fixtures.py")
        committed = {path.name: path.read_bytes() for path in CORPUS.iterdir()}
        self.assertTrue(all(b"\r" not in data for data in committed.values()))
        with tempfile.TemporaryDirectory() as directory:
            for name in ("first", "second"):
                output = Path(directory) / name
                command = [sys.executable, str(script), "--output", str(output)]
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual({path.name: path.read_bytes() for path in output.iterdir()}, committed)
                self.assertEqual(subprocess.run(command + ["--check"], capture_output=True).returncode, 0)
            target = output / "primitives-mm.dxf"
            target.write_bytes(b"corrupt")
            self.assertEqual(subprocess.run(command + ["--check"], capture_output=True).returncode, 1)
            self.assertEqual(target.read_bytes(), b"corrupt")
