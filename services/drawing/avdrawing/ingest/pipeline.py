"""03 解析提取 — grade the drawing, run the matching reader, hand 04 the records."""

from __future__ import annotations

from pathlib import Path

from . import dxf_reader, ocr, pdf_reader
from .grade import grade
from .models import DrawingIngest
from .pdf_reader import Calibration


def ingest(
    path: Path,
    *,
    calibration: Calibration | None = None,
    ocr_backend: ocr.OcrBackend | None = None,
) -> DrawingIngest:
    """Extract the six §4.1 elements from one drawing.

    B-grade needs a scale and C-grade needs an OCR engine; neither is guessed,
    because a wrong scale or a missing engine would silently produce numbers that
    look fine and are not.
    """
    level = grade(path)
    if level == "A":
        return dxf_reader.read(path)
    if level == "B":
        if calibration is None:
            raise ValueError(f"{path.name} 为矢量 PDF，须先完成比例尺标定（§2.1）。")
        return pdf_reader.read(path, calibration)
    if ocr_backend is None:
        raise ValueError(f"{path.name} 为扫描件，须提供 OCR 引擎。")
    return ocr.read(path, ocr_backend)


def summarise(result: DrawingIngest, threshold: float = 0.9) -> str:
    """One-line status for 04's list view."""
    pending = result.unconfirmed_below(threshold)
    gate = "可进入 05" if result.may_enter_configuration(threshold) else f"待确认 {len(pending)} 项"
    return f"{result.drawing}  {result.grade} 级  {len(result.extractions)} 项要素  {gate}"
