"""C 级 · 扫描件 OCR — §14: PaddleOCR (PP-OCRv4)，可本地运行.

§13.2 governs what comes out of here: 扫描件不可作为算量依据，仅作辅助识别，结论
须人工输入. So this module never produces a value 05 can use on its own — every
extraction it emits is a *candidate* that 04 校核 must confirm, which
`DrawingIngest.may_enter_configuration` enforces for grade C regardless of how
confident the OCR was.

The backend is behind an interface so the pipeline can be tested without the
PaddleOCR install, and so a different engine can be dropped in later.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .models import DrawingIngest, Extraction, Provenance

#: A dimension on a drawing: 3-6 digits, optionally with a decimal part.
_DIMENSION = re.compile(r"\b(\d{3,6}(?:\.\d+)?)\b")

#: Scanned dimensions are read, never trusted; this ceiling keeps them below any
#: sane 校核 threshold so they always surface for confirmation.
OCR_CONFIDENCE_CEILING = 0.75


@dataclass(frozen=True)
class TextBox:
    text: str
    confidence: float
    box: tuple[float, float, float, float]  # x0, y0, x1, y1 in pixels


class OcrBackend(Protocol):
    def read(self, image: Path) -> list[TextBox]:
        """Text boxes found in the image, in reading order."""


class PaddleOcrBackend:
    """PP-OCRv4 via PaddleOCR. Requires the optional `requirements-ocr.txt`.

    The model is loaded once and reused; the first call downloads the weights,
    so warm it up before a batch rather than inside a request.
    """

    def __init__(self, lang: str = "ch", use_angle_cls: bool = True) -> None:
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:  # pragma: no cover - depends on the optional install
            raise RuntimeError(
                "PaddleOCR 未安装。执行 pip install -r requirements-ocr.txt 后重试。"
            ) from exc
        self._engine = PaddleOCR(use_angle_cls=use_angle_cls, lang=lang, show_log=False)

    def read(self, image: Path) -> list[TextBox]:  # pragma: no cover - needs the optional install
        out: list[TextBox] = []
        for line in self._engine.ocr(str(image), cls=True) or []:
            for box, (text, score) in line or []:
                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                out.append(TextBox(text=text, confidence=float(score),
                                   box=(min(xs), min(ys), max(xs), max(ys))))
        return out


def read(path: Path, backend: OcrBackend) -> DrawingIngest:
    """Read a scan into candidate extractions, all requiring confirmation."""
    out = DrawingIngest(drawing=path.name, grade="C", scale_mm_per_unit=0.0)
    out.notes.append("扫描件：按 §13.2，OCR 结果仅作辅助识别，不可作为算量依据，全部要素须人工确认。")

    boxes = backend.read(path)
    numbers = [
        (float(m.group(1)), b)
        for b in boxes
        for m in _DIMENSION.finditer(b.text)
    ]
    if not numbers:
        out.notes.append("未识别到任何尺寸数字。")
        out.extractions.extend(_all_manual(path.name))
        return out

    # The two largest plausible dimensions are the usual width/height candidates.
    ranked = sorted(numbers, key=lambda pair: pair[0], reverse=True)[:2]
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    for element, (value, box) in zip(("led_opening_w", "led_opening_h"), ranked):
        out.extractions.append(Extraction(
            path.name, element, value, "mm",
            Provenance(
                source=f"{path.name} / OCR / ({box.box[0]:.0f}, {box.box[1]:.0f}) px",
                method="ai_ocr",
                confidence=round(min(box.confidence, OCR_CONFIDENCE_CEILING), 3),
                note="扫描件候选值，须人工确认后方可使用。",
            ),
        ))

    for element, unit in (("led_mount_h", "mm"), ("led_ctrl_dist", "m"),
                          ("led_pwr_dist", "m"), ("led_view_min", "m")):
        out.extractions.append(_manual(path.name, element, unit))
    return out


def _manual(drawing: str, element: str, unit: str) -> Extraction:
    return Extraction(
        drawing=drawing, element=element, value=None, unit=unit,
        prov=Provenance(source="扫描件中未识别", method="manual", confidence=0.0,
                        note="需在 04 人工校核中补录。"),
    )


def _all_manual(drawing: str) -> list[Extraction]:
    return [_manual(drawing, e, u) for e, u in (
        ("led_opening_w", "mm"), ("led_opening_h", "mm"), ("led_mount_h", "mm"),
        ("led_ctrl_dist", "m"), ("led_pwr_dist", "m"), ("led_view_min", "m"))]
