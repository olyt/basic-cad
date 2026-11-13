import hashlib
import json
from pathlib import Path
import unittest

import ezdxf
from ezdxf.lldxf.encoding import decode_dxf_unicode

from test_fixtures import (
    GEOMETRY_TYPES, UNITS, angles_normalized, classification, entity_properties, geometry_matches,
    layer_properties, normalized_layer,
)


CORPUS = Path(__file__).resolve().parents[2] / "fixtures/dxf/r2000/librecad"


def record_value(record, code):
    return next((value for key, value in record if key == code), None)


def source_records(data):
    lines = data.decode("cp1252").splitlines()
    tags = [(int(lines[index]), lines[index + 1]) for index in range(0, len(lines), 2)]
    header = {value: tags[index + 1][1] for index, (code, value) in enumerate(tags) if code == 9}
    records = []
    for code, value in tags:
        if code == 0:
            records.append([])
        if records:
            records[-1].append((code, value))
    return records, header


class LibreCadFixtureTests(unittest.TestCase):
    def test_native_archives_match_handwritten_expectations(self):
        manifests = sorted(CORPUS.glob("*.expected.json"))
        self.assertEqual(len(manifests), 3)
        for path in manifests:
            with self.subTest(fixture=path.name):
                self.check_fixture(path)

    def check_fixture(self, path):
        expected = json.loads(path.read_text())
        source = path.with_name(path.name.replace(".expected.json", ".dxf"))
        original = source.read_bytes()
        self.assertEqual(hashlib.sha256(original).hexdigest(), expected["sourceSha256"])
        provenance = {key: expected["generator"][key] for key in ("name", "version", "method")}
        self.assertEqual(provenance, {"name": "LibreCAD", "version": "2.2.1.6", "method": "GUI"})
        self.assertFalse(expected["editable"])
        records, header = source_records(original)
        self.assertEqual(header["$ACADVER"], "AC1015")
        self.assertEqual(header["$ACADVER"], expected["sourceVersion"])
        self.assertEqual(header["$DWGCODEPAGE"], expected["codepage"])
        self.assertEqual(int(header["$INSUNITS"]), expected["unitCode"])
        self.assertEqual(int(header["$MEASUREMENT"]), expected["measurement"])
        self.assertEqual(expected["units"], UNITS[expected["unitCode"]])
        self.assertEqual(header["$CLAYER"], expected["currentLayer"])
        raw_layers = [record for record in records if record_value(record, 0) == "LAYER"]
        native_names = {decode_dxf_unicode(record_value(record, 2)) for record in raw_layers}
        self.assertEqual(native_names, {layer["name"] for layer in expected["sourceLayers"]})
        quirks = expected["nativeQuirks"]
        raw_entities = [record for record in records if record_value(record, 0) in GEOMETRY_TYPES]
        missing_owners = [record_value(record, 5) for record in raw_entities if record_value(record, 330) is None]
        self.assertEqual(missing_owners, quirks["missingEntityOwners"])
        plots = [record for record in records if record_value(record, 0) == "PLOTSETTINGS"]
        self.assertEqual([(record_value(record, 5), record_value(record, 330)) for record in plots],
                         [(quirks["ownerlessPlotSettings"], None)])

        document = ezdxf.readfile(source, errors="strict")
        self.assertEqual(document.dxfversion, expected["sourceVersion"])
        self.assertEqual(document.units, expected["unitCode"])
        layers = {decode_dxf_unicode(layer.dxf.name): layer for layer in document.layers}
        self.assertEqual(set(layers) - native_names, set(quirks["loadCreatedLayers"]))
        for layer in expected["sourceLayers"]:
            self.assertEqual(layer_properties(layers[layer["name"]]), layer)
        normalized = {name: normalized_layer(layer_properties(layers[name])) for name in native_names}
        self.assertEqual({layer["name"]: layer for layer in expected["layers"]}, normalized)
        entities = list(document.modelspace())
        self.assertEqual([entity.dxf.handle for entity in entities], [item["handle"] for item in expected["entities"]])
        self.assertEqual({tuple(entity.dxf.extrusion) for entity in entities}, {(0, 0, 1)})
        for actual, item in zip(entities, expected["entities"]):
            properties = entity_properties(actual)
            self.assertEqual(properties, {key: item[key] for key in properties})
            self.assertEqual(classification(actual), item["classification"], item["handle"])
            self.assertTrue(angles_normalized(item["geometry"]), item["handle"])
            if actual.dxftype() == "LWPOLYLINE":
                self.assertEqual((actual.dxf.elevation, actual.dxf.const_width), (0, 0))
                self.assertTrue(all(value == 0 for widths in actual.get_points("se") for value in widths))
            self.assertTrue(geometry_matches(actual, item["geometry"]), item["handle"])
        auditor = document.audit()
        observed_audit = {
            name: [{"code": int(item.code), "message": item.message} for item in entries]
            for name, entries in (("errors", auditor.errors), ("fixes", auditor.fixes))
        }
        self.assertEqual(observed_audit, expected["expectedAudit"])
        self.assertEqual(source.read_bytes(), original)
