"""§2.1 图纸分级 — A / B / C.

A  DXF            entity coordinates and layers are readable, so the drawing can
                  be measured (ezdxf).
B  矢量 PDF        vector paths and real text, measurable once a scale is set
                  (PyMuPDF).
C  扫描件          raster only. §13.2 is explicit: a scan is never a basis for
                  quantities, only an aid to recognition — every value has to be
                  entered or confirmed by a person.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

Grade = Literal["A", "B", "C"]

DXF_SUFFIXES = {".dxf", ".dwg"}
RASTER_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}

#: A PDF page with fewer than this many vector drawing operations and no
#: extractable text is a scan wrapped in a PDF, not a vector drawing.
VECTOR_OP_FLOOR = 20


def grade(path: Path) -> Grade:
    suffix = path.suffix.lower()
    if suffix in DXF_SUFFIXES:
        return "A"
    if suffix in RASTER_SUFFIXES:
        return "C"
    if suffix == ".pdf":
        return "B" if _pdf_is_vector(path) else "C"
    raise ValueError(f"unsupported drawing type {suffix!r}: {path}")


def _pdf_is_vector(path: Path) -> bool:
    import pymupdf

    with pymupdf.open(path) as doc:
        for page in doc:
            if page.get_text("text").strip():
                return True
            if len(page.get_drawings()) >= VECTOR_OP_FLOOR:
                return True
    return False
