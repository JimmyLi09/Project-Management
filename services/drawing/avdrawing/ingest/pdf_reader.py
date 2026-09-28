"""B 级 · 矢量 PDF 解析 — §14: PyMuPDF.

A vector PDF has real geometry but no layers and no units, so §2.1 pairs it with
比例尺标定: the scale is supplied, never inferred. Two ways in — a drawing scale
(1:50) or two reference points whose real-world distance is known.

Where a dimension annotation sits next to the measured rectangle and agrees with
it, the confidence is raised and the record says so — §9's "三源一致" idea applied
to the two sources a PDF actually offers.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from . import semantic
from .models import DrawingIngest, Extraction, Provenance

PT_TO_MM = 25.4 / 72.0

#: A rectangle must be at least this many points across to be a screen outline
#: rather than a title-block cell or a hatch fragment.
MIN_RECT_PT = 20.0

#: How close a dimension annotation must sit to a rectangle's edge (points) to
#: be read as that rectangle's dimension.
LABEL_RADIUS_PT = 60.0

#: Relative agreement between the measured edge and a nearby dimension text for
#: the two to count as corroborating.
AGREEMENT_TOLERANCE = 0.02

BASE_CONFIDENCE = 0.6
CORROBORATED_CONFIDENCE = 0.92

_NUMBER = re.compile(r"^\d{3,6}(?:\.\d+)?$")


@dataclass(frozen=True)
class Calibration:
    """Millimetres of real world per PDF point."""

    mm_per_pt: float
    source: str

    @classmethod
    def from_scale(cls, denominator: float) -> "Calibration":
        """A drawing at 1:`denominator`, e.g. from the title block."""
        if denominator <= 0:
            raise ValueError("scale denominator must be positive")
        return cls(mm_per_pt=PT_TO_MM * denominator, source=f"图框比例 1:{denominator:g}")

    @classmethod
    def from_reference(cls, p1: tuple[float, float], p2: tuple[float, float], real_mm: float) -> "Calibration":
        """Two points on the page whose real distance the user knows."""
        span = ((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2) ** 0.5
        if span <= 0:
            raise ValueError("reference points must be distinct")
        if real_mm <= 0:
            raise ValueError("reference length must be positive")
        return cls(mm_per_pt=real_mm / span, source=f"两点标定 {real_mm:g} mm / {span:.1f} pt")


def read(path: Path, calibration: Calibration, *, page_number: int = 0) -> DrawingIngest:
    out = DrawingIngest(drawing=path.name, grade="B", scale_mm_per_unit=calibration.mm_per_pt)
    out.notes.append(f"比例尺来源：{calibration.source}")

    with pymupdf.open(path) as doc:
        page = doc[page_number]
        words = [(w[4], pymupdf.Rect(w[:4])) for w in page.get_text("words")]
        rects = _rectangles(page)

    screen = _screen_rect(words, rects)
    if screen is None:
        out.notes.append("未能在页面上定位 LED 屏体轮廓，六项要素全部转人工录入。")
        out.extractions.extend(_all_manual(path.name))
        return out

    rect, label, label_score = screen
    where = f"{path.name} / p{page_number + 1} / ({rect.x0:.0f}, {rect.y0:.0f}) pt"
    dims = _dimension_texts(words, rect)

    for element, span_pt in (("led_opening_w", rect.width), ("led_opening_h", rect.height)):
        measured = span_pt * calibration.mm_per_pt
        corroborated = next((d for d in dims if abs(d - measured) <= measured * AGREEMENT_TOLERANCE), None)
        confidence = CORROBORATED_CONFIDENCE if corroborated else round(BASE_CONFIDENCE * label_score, 3)
        note = (f"标注文字 {corroborated:g} 与量取值一致，双源互证。" if corroborated
                else f"仅由矢量轮廓量取，依赖{calibration.source}，无标注文字佐证。")
        out.extractions.append(Extraction(
            path.name, element, round(corroborated if corroborated else measured, 1), "mm",
            Provenance(source=where, method="rule", rule="B级-PDF-矢量量取",
                       confidence=confidence, note=f"轮廓由文字「{label}」定位。{note}"),
        ))

    # 安装标高、控制室与强电井距离、观看距离不在矢量轮廓里，交人工。
    for element, unit in (("led_mount_h", "mm"), ("led_ctrl_dist", "m"),
                          ("led_pwr_dist", "m"), ("led_view_min", "m")):
        out.extractions.append(_manual(path.name, element, unit))
    return out


def _rectangles(page: pymupdf.Page) -> list[pymupdf.Rect]:
    out = []
    for drawing in page.get_drawings():
        rect = drawing["rect"]
        if rect.width >= MIN_RECT_PT and rect.height >= MIN_RECT_PT:
            out.append(rect)
    return out


def _screen_rect(words, rects) -> tuple[pymupdf.Rect, str, float] | None:
    """The rectangle nearest a word that names the LED screen.

    Labels do the identifying; geometry alone cannot tell a screen outline from
    any other box on the sheet.
    """
    labels = [(text, box, m.score) for text, box in words
              if (m := semantic.score(text, "led_screen")).score > 0]
    if not labels or not rects:
        return None
    best = None
    for text, box, score in labels:
        centre = ((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
        for rect in rects:
            distance = _point_to_rect(centre, rect)
            if best is None or distance < best[0]:
                best = (distance, rect, text, score)
    if best is None:
        return None
    return best[1], best[2], best[3]


def _dimension_texts(words, rect: pymupdf.Rect) -> list[float]:
    """Plain numbers sitting close to the rectangle — candidate dimensions."""
    out = []
    for text, box in words:
        if not _NUMBER.match(text):
            continue
        centre = ((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
        if _point_to_rect(centre, rect) <= LABEL_RADIUS_PT:
            out.append(float(text))
    return out


def _point_to_rect(point: tuple[float, float], rect: pymupdf.Rect) -> float:
    dx = max(rect.x0 - point[0], 0.0, point[0] - rect.x1)
    dy = max(rect.y0 - point[1], 0.0, point[1] - rect.y1)
    return (dx * dx + dy * dy) ** 0.5


def _manual(drawing: str, element: str, unit: str) -> Extraction:
    return Extraction(
        drawing=drawing, element=element, value=None, unit=unit,
        prov=Provenance(source="矢量图中未找到", method="manual", confidence=0.0,
                        note="需在 04 人工校核中补录。"),
    )


def _all_manual(drawing: str) -> list[Extraction]:
    return [_manual(drawing, e, u) for e, u in (
        ("led_opening_w", "mm"), ("led_opening_h", "mm"), ("led_mount_h", "mm"),
        ("led_ctrl_dist", "m"), ("led_pwr_dist", "m"), ("led_view_min", "m"))]
