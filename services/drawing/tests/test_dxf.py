"""A7 DXF 图层 · §8.2 文件设置."""

from __future__ import annotations

import json
from pathlib import Path

import ezdxf
import pytest

from avdrawing.dxf import CJK_STYLE, DXF_VERSION, INSUNITS_MM, build, render
from avdrawing.schema import DrawingError, parse

FIXTURE = Path(__file__).parent / "fixtures" / "144-chuan-grove.drawing.json"

EXPECTED_LAYERS = {
    "LED-01-屏体轮廓": 7,
    "LED-02-箱体": 1,
    "LED-02B-定制箱体": 6,
    "LED-03-模组": 8,
    "LED-04-电源回路": 2,
    "LED-05-数据线": 3,
    "LED-06-标注": 4,
    "LED-07-文字": 7,
}


@pytest.fixture(scope="module")
def payload() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def doc(payload: dict):
    return build(parse(payload))


def test_file_settings(doc) -> None:
    """§8.2 — R2010, millimetres."""
    assert doc.dxfversion == ezdxf.DXF2010
    assert DXF_VERSION == "R2010"
    assert doc.header["$INSUNITS"] == INSUNITS_MM == 4


def test_eight_layers_present_and_independently_switchable(doc) -> None:
    """A7 — 八个图层齐全可独立开关."""
    for name, aci in EXPECTED_LAYERS.items():
        assert name in doc.layers, f"缺少图层 {name}"
        layer = doc.layers.get(name)
        assert layer.color == aci, f"{name} 色号应为 ACI {aci}"
        assert layer.is_on() and not layer.is_locked()


def test_every_entity_lands_on_its_layer(doc, payload) -> None:
    msp = doc.modelspace()
    for layer in payload["layers"]:
        drawn = len(msp.query(f'*[layer=="{layer["name"]}"]'))
        assert drawn == len(layer["entities"]), f'{layer["name"]} 实体数不符'
    assert len(msp) == sum(len(x["entities"]) for x in payload["layers"])


def test_origin_at_screen_bottom_left(doc) -> None:
    """§8.2 — coordinates are not transformed on the way out."""
    outline = doc.modelspace().query('LWPOLYLINE[layer=="LED-01-屏体轮廓"]')[0]
    corners = [(round(p[0]), round(p[1])) for p in outline.get_points("xy")]
    assert corners == [(0, 0), (4480, 0), (4480, 2560), (0, 2560)]


def test_cabinets_carry_their_numbering(doc) -> None:
    texts = {t.dxf.text for t in doc.modelspace().query('TEXT[layer=="LED-02-箱体"]')}
    assert "R1C1" in texts and "R5C7" in texts
    assert "640×480" in texts and "640×640" in texts


def test_information_panel_carries_the_disclaimer(doc) -> None:
    """§8.2 — 信息栏必须包含免责说明."""
    lines = [t.dxf.text for t in doc.modelspace().query('TEXT[layer=="LED-07-文字"]')]
    assert any("现场复核后方可施工" in x for x in lines)
    assert any("144-Chuan Grove" in x for x in lines)


def test_chinese_text_uses_a_cjk_style(doc) -> None:
    assert CJK_STYLE in doc.styles
    for t in doc.modelspace().query("TEXT"):
        assert t.dxf.style == CJK_STYLE


def test_written_file_reopens(payload, tmp_path: Path) -> None:
    out = render(payload, tmp_path / "out.dxf")
    reopened = ezdxf.readfile(out)
    assert set(EXPECTED_LAYERS) <= {x.dxf.name for x in reopened.layers}
    assert len(reopened.modelspace()) == len(build(parse(payload)).modelspace())


@pytest.mark.parametrize(
    "broken, message",
    [
        ({"title": "t"}, "layers"),
        ({"title": "t", "layers": [{"name": "L", "aci": 0, "entities": []}]}, "colour index"),
        ({"title": "t", "layers": [{"name": "L", "aci": 1, "entities": [{"k": "blob"}]}]}, "unknown entity kind"),
        ({"title": "t", "layers": [{"name": "L", "aci": 1, "entities": [{"k": "circle", "cx": 0, "cy": 0}]}]}, "missing 'r'"),
        ({"title": "t", "layers": [{"name": "L", "aci": 1,
          "entities": [{"k": "text", "x": 0, "y": 0, "h": 1, "s": "a", "anchor": "up"}]}]}, "anchor"),
    ],
)
def test_malformed_payloads_fail_loudly(broken: dict, message: str) -> None:
    with pytest.raises(DrawingError, match=message):
        parse(broken)
