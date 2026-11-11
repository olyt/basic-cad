"""Authored source cases and independent normalized geometry expectations."""

import math

import ezdxf


def point(value):
    return dict(zip(("x", "y"), value))


def line(start, end):
    return {"type": "line", "start": point(start), "end": point(end)}


def circle(center, radius):
    return {"type": "circle", "center": point(center), "radius": radius}


def arc(center, values):
    radius, start, sweep = values
    return {
        "type": "arc", "center": point(center), "radius": radius,
        "startAngle": start, "sweep": sweep,
    }


def polyline(segments, closed):
    return {"type": "polyline", "segments": segments, "closed": closed}


def layer(name, properties=None):
    return {
        "name": name, "color": 7, "visible": True, "frozen": False,
        "locked": False, "lineweight": "default", "linetype": "continuous",
        **(properties or {}),
    }


def record(entity, expected):
    return {
        "handle": entity.dxf.handle, "classification": "supported",
        "layerName": "0", "color": "by-layer", "lineweight": "by-layer",
        "linetype": "by-layer", **expected,
    }


def new_case(unit_code):
    doc = ezdxf.new("R2000", units=unit_code)
    return doc, {
        "units": {0: "unitless", 1: "inches", 4: "millimeters"}[unit_code],
        "unitCode": unit_code, "currentLayer": "0", "modelTolerance": {"distance": 1e-7},
        "editable": True, "layers": [layer("0"), layer("Defpoints")], "entities": [],
    }


def primitives():
    doc, expected = new_case(4)
    space = doc.modelspace()
    doc.layers.add("Outline", color=3, lineweight=35)
    expected["layers"].append(layer("Outline", {"color": 3, "lineweight": 35}))
    expected["entities"] = [
        record(
            space.add_line((1, 2), (11, 2), dxfattribs={"layer": "Outline", "color": 2, "lineweight": 25}),
            {"sourceType": "LINE", "geometry": line((1, 2), (11, 2)),
             "layerName": "Outline", "color": 2, "lineweight": 25},
        ),
        record(space.add_circle((20, 5), 3), {"sourceType": "CIRCLE", "geometry": circle((20, 5), 3)}),
        record(space.add_arc((30, 5), 4, 350, 10),
               {"sourceType": "ARC", "geometry": arc((30, 5), (4, math.radians(350), math.radians(20)))}),
    ]
    return "primitives-mm", doc, expected


def polylines():
    doc, expected = new_case(1)
    space = doc.modelspace()
    open_path = space.add_lwpolyline(
        [(0, 0, -1), (10, 0, 0), (10, 10, 0)], format="xyb", dxfattribs={"lineweight": 50},
    )
    closed_path = space.add_lwpolyline(
        [(0, 0, 0), (10, 0, 1), (10, 10, 0), (0, 10, 1)],
        format="xyb", close=True, dxfattribs={"color": 4, "lineweight": -2},
    )
    expected["entities"] = [
        record(open_path, {
            "sourceType": "LWPOLYLINE", "lineweight": 50,
            "geometry": polyline([
                arc((5, 0), (5, math.pi, -math.pi)), line((10, 0), (10, 10)),
            ], False),
        }),
        record(closed_path, {
            "sourceType": "LWPOLYLINE", "color": 4, "lineweight": "by-block",
            "geometry": polyline([
                line((0, 0), (10, 0)), arc((10, 5), (5, 1.5 * math.pi, math.pi)),
                line((10, 10), (0, 10)), arc((0, 5), (5, 0.5 * math.pi, math.pi)),
            ], True),
        }),
    ]
    return "polylines-inch", doc, expected


def flipped():
    doc, expected = new_case(0)
    space = doc.modelspace()
    normal = {"extrusion": (0, 0, -1)}
    converted = {"classification": "converted"}
    expected["entities"] = [
        record(space.add_line((1, 2), (5, 2), dxfattribs=normal),
               {"sourceType": "LINE", "geometry": line((1, 2), (5, 2)), **converted}),
        record(space.add_circle((8, 4), 2, dxfattribs=normal),
               {"sourceType": "CIRCLE", "geometry": circle((-8, 4), 2), **converted}),
        record(space.add_arc((3, 4), 2, 0, 90, dxfattribs=normal),
               {"sourceType": "ARC", "geometry": arc((-3, 4), (2, math.pi, -0.5 * math.pi)), **converted}),
        record(space.add_lwpolyline([(0, 0, 1), (10, 0, 0), (10, 10, 0)], format="xyb", dxfattribs=normal),
               {"sourceType": "LWPOLYLINE", "geometry": polyline([arc((-5, 0), (5, 0, -math.pi)),
                                                               line((-10, 0), (-10, 10))], False), **converted}),
    ]
    return "flipped-unitless", doc, expected


def unicode_layers():
    doc, expected = new_case(4)
    space = doc.modelspace()
    hidden = doc.layers.add("墙层", color=5, lineweight=35)
    hidden.off()
    hidden.freeze()
    hidden.lock()
    doc.layers.add("План é", color=3, lineweight=50)
    expected["layers"] += [
        layer("墙层", {"color": 5, "lineweight": 35, "visible": False, "frozen": True, "locked": True}),
        layer("План é", {"color": 3, "lineweight": 50}),
    ]
    expected["entities"] = [
        record(space.add_line((0, 0), (4, 3), dxfattribs={"layer": "墙层"}),
               {"sourceType": "LINE", "geometry": line((0, 0), (4, 3)), "layerName": "墙层"}),
        record(space.add_circle((8, 3), 2, dxfattribs={"layer": "План é"}),
               {"sourceType": "CIRCLE", "geometry": circle((8, 3), 2), "layerName": "План é"}),
    ]
    return "unicode-layers", doc, expected


def unsupported():
    doc, expected = new_case(4)
    space = doc.modelspace()
    block = doc.blocks.new("ProbeBlock")
    block.add_line((0, 0), (1, 1))
    background = space.add_line((0, 0), (10, 0))
    text = space.add_text("unsupported", dxfattribs={"insert": (0, 2), "height": 1})
    insert = space.add_blockref("ProbeBlock", (15, 0))
    hatch = space.add_hatch(color=2)
    hatch.paths.add_polyline_path([(0, 0), (4, 0), (4, 3), (0, 3)], is_closed=True)
    dimension = space.add_linear_dim(base=(0, 5), p1=(0, 0), p2=(10, 0))
    dimension.render()
    expected["editable"] = False
    expected["entities"] = [
        record(background, {"sourceType": "LINE", "geometry": line((0, 0), (10, 0))}),
        record(text, {"sourceType": "TEXT", "classification": "unsupported", "geometry": None}),
        record(insert, {"sourceType": "INSERT", "classification": "unsupported", "geometry": None}),
        record(hatch, {"sourceType": "HATCH", "classification": "unsupported", "geometry": None, "color": 2}),
        record(dimension.dimension, {"sourceType": "DIMENSION", "classification": "unsupported", "geometry": None}),
    ]
    return "unsupported-content", doc, expected


def create_cases():
    return [primitives(), polylines(), flipped(), unicode_layers(), unsupported()]
