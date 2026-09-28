"""A 级 · DXF 解析 — §14: ezdxf 读实体坐标与图层.

Rule-based throughout: no model is involved in reading a DXF. What is uncertain
is *which* layer holds the screen, and that uncertainty is carried as the
extraction's confidence (the semantic match score), not hidden.
"""

from __future__ import annotations

from pathlib import Path

import ezdxf
from ezdxf import bbox

from . import semantic
from .models import DrawingIngest, Extraction, Provenance

#: $INSUNITS values we can convert to millimetres. Anything else is refused
#: rather than guessed — a wrong unit silently scales every quantity.
MM_PER_UNIT: dict[int, float] = {
    0: 1.0,     # unitless: the industry default for CAD drawings is millimetres
    1: 25.4,    # inches
    2: 304.8,   # feet
    4: 1.0,     # millimetres
    5: 10.0,    # centimetres
    6: 1000.0,  # metres
}

#: Reading a screen outline's bottom edge as the mounting height assumes the
#: drawing's Y origin is finished floor level, which is usual but not certain.
MOUNT_HEIGHT_CONFIDENCE = 0.55


def read(path: Path, *, layer_threshold: float = semantic.DEFAULT_THRESHOLD) -> DrawingIngest:
    doc = ezdxf.readfile(path)
    insunits = int(doc.header.get("$INSUNITS", 0))
    if insunits not in MM_PER_UNIT:
        raise ValueError(f"{path.name}: unsupported $INSUNITS {insunits}; set the drawing units before import")
    mm = MM_PER_UNIT[insunits]

    msp = doc.modelspace()
    names = [layer.dxf.name for layer in doc.layers]
    out = DrawingIngest(drawing=path.name, grade="A", scale_mm_per_unit=mm)
    if insunits == 0:
        out.notes.append("图纸未声明单位（$INSUNITS = 0），按毫米解析。导入前请确认。")

    screen = semantic.pick_layer(names, "led_screen", layer_threshold)
    if screen is None:
        out.notes.append(f"未能在 {len(names)} 个图层中识别出屏体图层，六项要素全部转人工录入。")
        for element, unit in _MANUAL_ALL:
            out.extractions.append(_manual(path.name, element, unit))
        return out

    extents = bbox.extents(msp.query(f'*[layer=="{screen.name}"]'))
    if not extents.has_data:
        out.notes.append(f"图层「{screen.name}」无可测实体。")
        for element, unit in _MANUAL_ALL:
            out.extractions.append(_manual(path.name, element, unit))
        return out

    lo, hi = extents.extmin, extents.extmax
    where = f"{path.name} / {screen.name} / ({lo.x:.0f}, {lo.y:.0f})"
    prov = Provenance(source=where, method="rule", rule="A级-DXF-实体范围",
                      confidence=round(screen.score, 3),
                      note=f"图层由语义映射匹配到「{screen.matched}」")

    out.extractions.append(Extraction(path.name, "led_opening_w", round((hi.x - lo.x) * mm, 1), "mm", prov))
    out.extractions.append(Extraction(path.name, "led_opening_h", round((hi.y - lo.y) * mm, 1), "mm", prov))
    out.extractions.append(Extraction(
        path.name, "led_mount_h", round(lo.y * mm, 1), "mm",
        Provenance(source=where, method="rule", rule="A级-DXF-下沿标高",
                   confidence=min(MOUNT_HEIGHT_CONFIDENCE, round(screen.score, 3)),
                   note="按屏体下沿 Y 坐标推得，前提是图纸 Y 原点为完成面标高，须人工确认。"),
    ))

    centre = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2)
    for element, key in (("led_ctrl_dist", "led_ctrl_dist"), ("led_pwr_dist", "led_pwr_dist")):
        target = semantic.pick_layer(names, key, layer_threshold)
        distance = _distance_to_layer(msp, target.name, centre, mm) if target else None
        if distance is None:
            out.extractions.append(_manual(path.name, element, "m"))
            continue
        out.extractions.append(Extraction(
            path.name, element, round(distance / 1000.0, 2), "m",
            Provenance(source=f"{path.name} / {target.name}", method="rule", rule="A级-DXF-图层间距",
                       confidence=round(min(screen.score, target.score) * 0.9, 3),
                       note="按图层几何中心的平面直线距离推得，未计走线路径，须人工确认。"),
        ))

    # 最近观看距离不在图纸上，只能由人给出（§4.1）。
    out.extractions.append(_manual(path.name, "led_view_min", "m"))
    return out


_MANUAL_ALL = (
    ("led_opening_w", "mm"), ("led_opening_h", "mm"), ("led_mount_h", "mm"),
    ("led_ctrl_dist", "m"), ("led_pwr_dist", "m"), ("led_view_min", "m"),
)


def _manual(drawing: str, element: str, unit: str) -> Extraction:
    return Extraction(
        drawing=drawing, element=element, value=None, unit=unit,
        prov=Provenance(source="图纸中未找到", method="manual", confidence=0.0,
                        note="需在 04 人工校核中补录。"),
    )


def _distance_to_layer(msp, layer: str, centre: tuple[float, float], mm: float) -> float | None:
    extents = bbox.extents(msp.query(f'*[layer=="{layer}"]'))
    if not extents.has_data:
        return None
    lo, hi = extents.extmin, extents.extmax
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    return (((cx - centre[0]) ** 2 + (cy - centre[1]) ** 2) ** 0.5) * mm
