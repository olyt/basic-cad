"""Generate byte-stable R2000 inputs and authored semantic expectations."""

import argparse
from io import StringIO
import json
from pathlib import Path
import sys

import ezdxf

from fixture_cases import create_cases


CORPUS = Path(__file__).resolve().parents[2] / "fixtures/dxf/r2000/ezdxf"


def generate():
    if ezdxf.__version__ != "1.4.4" or sys.version_info[:3] != (3, 12, 14):
        raise RuntimeError("Use the pinned Python 3.12.14 / ezdxf 1.4.4 environment.")

    previous = ezdxf.options.write_fixed_meta_data_for_testing
    ezdxf.options.write_fixed_meta_data_for_testing = True
    try:
        files = {}
        for name, document, expected in create_cases():
            measurement = 1 if expected["unitCode"] == 4 else 0
            document.header["$CLAYER"] = "0"
            document.header["$DWGCODEPAGE"] = "ANSI_1252"
            document.header["$MEASUREMENT"] = measurement
            stream = StringIO(newline="\n")
            document.write(stream)
            files[f"{name}.dxf"] = document.encode(stream.getvalue())
            manifest = {
                "schemaVersion": 1,
                "generator": {"name": "ezdxf", "version": ezdxf.__version__,
                              "python": "3.12.14", "fixedMetadata": True},
                "sourceVersion": "AC1015",
                "codepage": "ANSI_1252",
                "measurement": measurement,
                "entityScope": "modelspace",
                **expected,
            }
            files[f"{name}.expected.json"] = (
                json.dumps(manifest, indent=4, sort_keys=True, ensure_ascii=True,
                           allow_nan=False) + "\n"
            ).encode("ascii")
        return files
    finally:
        ezdxf.options.write_fixed_meta_data_for_testing = previous


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=CORPUS)
    parser.add_argument("--check", action="store_true", help="Verify without writing.")
    args = parser.parse_args()
    files = generate()
    if args.check:
        existing = {
            path.name: path.read_bytes() for path in args.output.glob("*")
            if path.is_file()
        }
        changed = sorted(name for name in files.keys() | existing.keys()
                         if files.get(name) != existing.get(name))
        if changed:
            parser.exit(1, "Fixture mismatch: " + ", ".join(changed) + "\n")
        print(f"Verified {len(files) // 2} DXF/expectation pairs.")
    else:
        args.output.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            (args.output / name).write_bytes(data)
        print(f"Generated {len(files) // 2} DXF/expectation pairs in {args.output}.")


if __name__ == "__main__":
    main()
