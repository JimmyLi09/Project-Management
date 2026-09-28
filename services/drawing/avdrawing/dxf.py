"""DXF renderer — §8.1 layers, §8.2 file settings.

R2010, millimetres ($INSUNITS = 4), origin at the screen's bottom-left. The
drawing model already carries those coordinates, so nothing is transformed here:
whatever the SVG shows is what the DXF contains.

Run: python -m avdrawing.dxf <drawing.json> <out.dxf>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment

from .schema import Drawing, parse

DXF_VERSION = "R2010"
INSUNITS_MM = 4

#: Text style carrying a CJK font, so 箱体编号 and the 图纸信息栏 are legible
#: when the file is opened in AutoCAD. CAD falls back to its own font if the
#: named one is absent, which degrades the glyphs but never the geometry.
CJK_STYLE = "AV-HZ"
CJK_FONT = "simsun.ttc"

_ALIGN = {
    "start": TextEntityAlignment.LEFT,
    "middle": TextEntityAlignment.CENTER,
    "end": TextEntityAlignment.RIGHT,
}


def build(drawing: Drawing) -> ezdxf.document.Drawing:
    doc = ezdxf.new(DXF_VERSION, setup=True)
    doc.header["$INSUNITS"] = INSUNITS_MM
    doc.styles.add(CJK_STYLE, font=CJK_FONT)
    msp = doc.modelspace()

    for layer in drawing.layers:
        # Every layer is created even when empty, so all eight can be switched
        # independently in AutoCAD (A7).
        doc.layers.add(name=layer.name, color=layer.aci)
        attribs = {"layer": layer.name}
        for e in layer.entities:
            kind = e["k"]
            if kind == "line":
                msp.add_line((e["x1"], e["y1"]), (e["x2"], e["y2"]), dxfattribs=attribs)
            elif kind == "rect":
                x, y, w, h = e["x"], e["y"], e["w"], e["h"]
                msp.add_lwpolyline(
                    [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
                    close=True,
                    dxfattribs=attribs,
                )
            elif kind == "circle":
                msp.add_circle((e["cx"], e["cy"]), e["r"], dxfattribs=attribs)
            elif kind == "text":
                text = msp.add_text(
                    e["s"],
                    height=e["h"],
                    dxfattribs={**attribs, "style": CJK_STYLE},
                )
                text.set_placement((e["x"], e["y"]), align=_ALIGN[e["anchor"]])
    return doc


def render(payload: dict, out: Path) -> Path:
    doc = build(parse(payload))
    doc.saveas(out)
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    src, dst = Path(argv[0]), Path(argv[1])
    render(json.loads(src.read_text(encoding="utf-8")), dst)
    print(dst)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
