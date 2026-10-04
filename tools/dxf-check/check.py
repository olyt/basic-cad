"""Inspect DXF using ezdxf; never save or recover the input file."""

import argparse
import json
import sys

import ezdxf
from ezdxf.entities import DXFTagStorage
from ezdxf.enums import InsertUnits
from ezdxf.lldxf.encoding import decode_dxf_unicode


def entity_summary(entity):
    kind = entity.dxftype()
    dxf = entity.dxf
    properties = (
        entity.graphic_properties() if isinstance(entity, DXFTagStorage)
        else dxf.all_existing_dxf_attribs()
    )
    geometry = None
    if kind == "LINE":
        geometry = {
            "coordinates": "WCS",
            "start": list(dxf.start),
            "end": list(dxf.end),
        }
    elif kind in ("CIRCLE", "ARC"):
        geometry = {
            "coordinates": "OCS",
            "center": list(dxf.center),
            "radius": dxf.radius,
        }
        if kind == "ARC":
            geometry.update(start_angle=dxf.start_angle, end_angle=dxf.end_angle)
    elif kind == "LWPOLYLINE":
        geometry = {
            "coordinates": "OCS",
            "closed": entity.closed,
            "elevation": dxf.elevation,
            "constant_width": dxf.const_width,
            "vertices": [
                {
                    "x": float(x), "y": float(y),
                    "start_width": float(start), "end_width": float(end),
                    "bulge": float(bulge),
                }
                for x, y, start, end, bulge in entity.get_points("xyseb")
            ],
        }
    return {
        "type": kind,
        "handle": dxf.handle,
        "layer": decode_dxf_unicode(properties.get("layer", "0")),
        "color": properties.get("color", 256),
        "linetype": decode_dxf_unicode(properties.get("linetype", "BYLAYER")),
        "lineweight": properties.get("lineweight", -1),
        "extrusion": list(properties.get("extrusion", (0, 0, 1))),
        "geometry": geometry,
    }


def inspect_file(path):
    doc = ezdxf.readfile(path, errors="strict")
    try:
        unit_name = InsertUnits(doc.units).name
    except ValueError:
        unit_name = "UNKNOWN"
    # Capture parsed values before audit() can change them in memory.
    summary = {
        "ezdxf_version": ezdxf.__version__,
        "version": doc.dxfversion,
        "units": {"code": doc.units, "name": unit_name},
        "layers": [
            {
                "name": decode_dxf_unicode(layer.dxf.name),
                "color": layer.dxf.color,
                "off": layer.is_off(),
                "frozen": layer.is_frozen(),
                "locked": layer.is_locked(),
                "linetype": layer.dxf.linetype,
                "lineweight": layer.dxf.lineweight,
            }
            for layer in sorted(doc.layers, key=lambda layer: layer.dxf.name)
        ],
        "spaces": [
            {
                "name": decode_dxf_unicode(block.name),
                "entities": [entity_summary(entity) for entity in block],
            }
            for block in sorted(doc.blocks, key=lambda block: block.name)
        ],
    }
    auditor = doc.audit()
    summary["audit"] = {
        name: [{"code": int(entry.code), "message": entry.message} for entry in entries]
        for name, entries in (("errors", auditor.errors), ("fixes", auditor.fixes))
    }
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="DXF file to inspect")
    args = parser.parse_args()
    try:
        summary = inspect_file(args.file)
        output = json.dumps(summary, indent=4, ensure_ascii=True, allow_nan=False)
    except (OSError, ezdxf.DXFError, ValueError, UnicodeError) as error:
        print(f"DXF check failed: {error}", file=sys.stderr)
        return 2
    errors, fixes = summary["audit"]["errors"], summary["audit"]["fixes"]
    print(f"ezdxf audit: {len(errors)} error(s), {len(fixes)} repair(s)", file=sys.stderr)
    print(output)
    return 1 if errors or fixes else 0


if __name__ == "__main__":
    sys.exit(main())
