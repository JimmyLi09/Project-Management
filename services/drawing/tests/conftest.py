"""Synthetic drawings, so the ingest tests need no proprietary sample files."""

from __future__ import annotations

from pathlib import Path

import ezdxf
import pymupdf
import pytest

#: 144-Chuan Grove's real opening, so the ingest tests line up with the core's.
OPENING_W = 4480.0
OPENING_H = 2560.0
MOUNT_H = 1200.0


@pytest.fixture(scope="session")
def dxf_drawing(tmp_path_factory) -> Path:
    """An A-grade drawing: LED outline on a recognisable layer, plus decoys."""
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4  # millimetres
    msp = doc.modelspace()
    for name in ("A-WALL", "A-LED-DISPLAY", "M-DUCT", "E-POWER-RISER", "A-DOOR"):
        doc.layers.add(name)

    msp.add_lwpolyline(
        [(0, MOUNT_H), (OPENING_W, MOUNT_H), (OPENING_W, MOUNT_H + OPENING_H), (0, MOUNT_H + OPENING_H)],
        close=True, dxfattribs={"layer": "A-LED-DISPLAY"},
    )
    msp.add_lwpolyline([(-2000, 0), (12000, 0), (12000, 6000), (-2000, 6000)],
                       close=True, dxfattribs={"layer": "A-WALL"})
    # Power riser 18 m to the right of the screen centre.
    msp.add_circle((OPENING_W / 2 + 18000, MOUNT_H + OPENING_H / 2), 400,
                   dxfattribs={"layer": "E-POWER-RISER"})
    msp.add_line((0, 5000), (1000, 5000), dxfattribs={"layer": "M-DUCT"})

    path = tmp_path_factory.mktemp("dxf") / "01_平面图.dxf"
    doc.saveas(path)
    return path


@pytest.fixture(scope="session")
def dxf_without_led(tmp_path_factory) -> Path:
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4
    for name in ("A-WALL", "M-DUCT", "S-BEAM"):
        doc.layers.add(name)
    doc.modelspace().add_lwpolyline([(0, 0), (100, 0), (100, 100), (0, 100)],
                                    close=True, dxfattribs={"layer": "A-WALL"})
    path = tmp_path_factory.mktemp("dxf2") / "无屏体.dxf"
    doc.saveas(path)
    return path


@pytest.fixture(scope="session")
def pdf_drawing(tmp_path_factory) -> Path:
    """A B-grade drawing at 1:50: outline, label and dimension annotations.

    At 1:50, 4480 mm is 4480 / (25.4/72 * 50) = 253.98 pt.
    """
    mm_per_pt = (25.4 / 72.0) * 50
    w, h = OPENING_W / mm_per_pt, OPENING_H / mm_per_pt

    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    rect = pymupdf.Rect(100, 200, 100 + w, 200 + h)
    page.draw_rect(rect, width=1)
    page.insert_text((rect.x0, rect.y0 - 8), "LED SCREEN", fontsize=8)
    page.insert_text(((rect.x0 + rect.x1) / 2 - 12, rect.y1 + 14), f"{OPENING_W:.0f}", fontsize=8)
    page.insert_text((rect.x1 + 10, (rect.y0 + rect.y1) / 2), f"{OPENING_H:.0f}", fontsize=8)

    path = tmp_path_factory.mktemp("pdf") / "02_立面图.pdf"
    doc.save(path)
    doc.close()
    return path


@pytest.fixture(scope="session")
def scan_drawing(tmp_path_factory) -> Path:
    """A C-grade drawing: a raster page with no extractable text."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 400, 300))
    pix.clear_with(200)
    page.insert_image(pymupdf.Rect(50, 50, 450, 350), pixmap=pix)
    path = tmp_path_factory.mktemp("scan") / "03_扫描件.pdf"
    doc.save(path)
    doc.close()
    return path
