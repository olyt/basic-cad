import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import ezdxf


class CheckerTests(unittest.TestCase):
    def run_check(self, doc):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "drawing with spaces.dxf"
            doc.saveas(path)
            original = path.read_bytes()
            result = self.run_cli(str(path))
            self.assertEqual(path.read_bytes(), original)
        return result, json.loads(result.stdout) if result.stdout else None

    def run_cli(self, *args):
        return subprocess.run(
            [sys.executable, str(Path(__file__).with_name("check.py")), *args],
            capture_output=True, text=True, check=False,
        )

    def test_geometry_properties_spaces_and_units(self):
        for code, name in ((0, "Unitless"), (1, "Inches"), (4, "Millimeters")):
            with self.subTest(units=code):
                doc = ezdxf.new("R2000", units=code)
                layer = doc.layers.add("墙", color=3, lineweight=25)
                layer.off()
                layer.freeze()
                layer.lock()
                space = doc.modelspace()
                space.add_line((1, 2, 3), (4, 5, 6), dxfattribs={"layer": "墙", "color": 2})
                space.add_circle((3, 4), 5)
                space.add_arc((5, 6), 7, 350, 10, dxfattribs={"extrusion": (0, 0, -1)})
                space.add_lwpolyline([(1, 2, 3, 4, -0.5), (5, 6, 0, 0, 0)], close=True)
                space.add_text("unsupported")
                doc.paperspace().add_circle((0, 0), 1)
                doc.blocks.new("symbol").add_line((0, 0), (1, 1))
                result, summary = self.run_check(doc)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(summary["version"], "AC1015")
                self.assertEqual(summary["units"], {"code": code, "name": name})
                spaces = {space["name"]: space["entities"] for space in summary["spaces"]}
                line, circle, arc, polyline, text = spaces["*Model_Space"]
                self.assertEqual(line["geometry"]["end"], [4, 5, 6])
                self.assertEqual((line["layer"], line["color"], circle["color"]), ("墙", 2, 256))
                self.assertEqual((circle["geometry"]["center"], circle["geometry"]["radius"]), ([3, 4, 0], 5))
                self.assertEqual((arc["geometry"]["start_angle"], arc["geometry"]["end_angle"]), (350, 10))
                self.assertEqual(arc["extrusion"], [0, 0, -1])
                self.assertTrue(polyline["geometry"]["closed"])
                self.assertEqual(polyline["geometry"]["vertices"][0], {
                    "x": 1, "y": 2, "start_width": 3, "end_width": 4, "bulge": -0.5,
                })
                self.assertEqual(text["type"], "TEXT")
                self.assertIsNone(text["geometry"])
                self.assertEqual(len(spaces["*Paper_Space"]), 1)
                self.assertEqual(len(spaces["symbol"]), 1)
                reported_layer = next(layer for layer in summary["layers"] if layer["name"] == "墙")
                self.assertEqual(reported_layer, {
                    "name": "墙", "color": -3, "off": True, "frozen": True,
                    "locked": True, "linetype": "Continuous", "lineweight": 25,
                })

    def test_audit_repairs_fail_and_summary_precedes_repair(self):
        doc = ezdxf.new("R2000")
        doc.modelspace().add_line((0, 0), (1, 1), dxfattribs={"linetype": "MISSING"})
        result, summary = self.run_check(doc)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertTrue(summary["audit"]["fixes"])
        model = next(space for space in summary["spaces"] if space["name"] == "*Model_Space")
        self.assertEqual(model["entities"][0]["linetype"], "MISSING")

    def test_unfixable_audit_errors_fail(self):
        doc = ezdxf.new("R2000")
        doc.blocks.new("cycle").add_blockref("cycle", (0, 0))
        result, summary = self.run_check(doc)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertTrue(summary["audit"]["errors"])

    def test_missing_and_malformed_input_fail_cleanly(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.dxf"
            for content in (None, "not a DXF file\n"):
                with self.subTest(content=content):
                    if content is not None:
                        path.write_text(content)
                    result = self.run_cli(str(path))
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("DXF check failed:", result.stderr)
                    self.assertNotIn("Traceback", result.stderr)
                    self.assertEqual(result.stdout, "")

    def test_nonfinite_geometry_fails(self):
        doc = ezdxf.new("R2000")
        doc.modelspace().add_line((float("nan"), 0), (1, 1))
        result, _ = self.run_check(doc)
        self.assertEqual(result.returncode, 2)
        self.assertIn("DXF check failed:", result.stderr)

    def test_missing_argument_fails(self):
        self.assertEqual(self.run_cli().returncode, 2)

    def test_unknown_entity_type_stays_in_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "unknown.dxf"
            doc = ezdxf.new("R2000")
            doc.modelspace().add_line((0, 0), (1, 1), dxfattribs={"color": 3})
            doc.saveas(path)
            path.write_text(path.read_text().replace("\nLINE\n", "\nCUSTOM_ENTITY\n"))
            original = path.read_bytes()
            result = self.run_cli(str(path))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(path.read_bytes(), original)
            spaces = json.loads(result.stdout)["spaces"]
            entity = next(space for space in spaces if space["name"] == "*Model_Space")["entities"][0]
            self.assertEqual((entity["type"], entity["color"], entity["geometry"]), ("CUSTOM_ENTITY", 3, None))


if __name__ == "__main__":
    unittest.main()
