"""Command-line entry for the web app — JSON in, JSON out.

    python -m avdrawing.ingest.cli ingest <drawing> [--scale 50] [--threshold 0.85]
    python -m avdrawing.ingest.cli writeback <store.jsonl>      # reviewed ingest JSON on stdin; re-checks the A10 gate, writes samples only if it passes
    python -m avdrawing.ingest.cli grade <drawing>              # {"grade": "A"|"B"|"C"} — AV-015 sends C to image judgement
    python -m avdrawing.ingest.cli raster <pdf> <outdir> [--max-pages 5]   # scanned PDF -> one PNG per page

The Next.js server spawns this per request, so the platform deploys as one app
on the intranet server (§14) without a second long-running service. Failures
print {"error": "..."} and exit 2, so the caller can show the message verbatim.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .grade import grade
from .models import REVIEW_THRESHOLD, DrawingIngest, write_back_samples
from .ocr import PaddleOcrBackend
from .pdf_reader import Calibration
from .pipeline import ingest


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="avdrawing.ingest.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ingest = sub.add_parser("ingest")
    p_ingest.add_argument("drawing", type=Path)
    p_ingest.add_argument("--scale", type=float, help="drawing scale denominator, e.g. 50 for 1:50")
    p_ingest.add_argument("--threshold", type=float, default=REVIEW_THRESHOLD)

    p_write = sub.add_parser("writeback")
    p_write.add_argument("store", type=Path)

    p_grade = sub.add_parser("grade")
    p_grade.add_argument("drawing", type=Path)

    p_raster = sub.add_parser("raster")
    p_raster.add_argument("pdf", type=Path)
    p_raster.add_argument("outdir", type=Path)
    p_raster.add_argument("--max-pages", type=int, default=5)
    p_raster.add_argument("--max-edge", type=int, default=1600)

    args = parser.parse_args(argv)
    try:
        if args.cmd == "ingest":
            # Only a scan loads the OCR engine; it is slow to start and optional.
            ocr_backend = PaddleOcrBackend() if grade(args.drawing) == "C" else None
            result = ingest(
                args.drawing,
                calibration=Calibration.from_scale(args.scale) if args.scale else None,
                ocr_backend=ocr_backend,
            )
            _emit(result.to_dict(args.threshold))
        elif args.cmd == "grade":
            _emit({"grade": grade(args.drawing)})
        elif args.cmd == "raster":
            _emit(raster(args.pdf, args.outdir, args.max_pages, args.max_edge))
        else:
            data = json.load(sys.stdin)
            reviewed = DrawingIngest.from_dict(data)
            threshold = float(data.get("threshold", REVIEW_THRESHOLD))
            # The gate is re-evaluated here, on the server's copy, so the screen
            # cannot talk its way past A10.
            gate = reviewed.may_enter_configuration(threshold)
            # Samples are written only when the review passes: a rejected submit
            # followed by a successful one must not record the corrections twice.
            written = write_back_samples(reviewed, args.store) if gate else 0
            _emit({"written": written, "may_enter_configuration": gate})
    except (ValueError, RuntimeError, OSError) as exc:
        _emit({"error": str(exc)})
        return 2
    return 0


def raster(pdf: Path, outdir: Path, max_pages: int, max_edge: int) -> dict:
    """AV-015 §4.1 — a scanned PDF, page by page, as PNGs no larger than
    `max_edge` on the long side (what the vision model is shown)."""
    import pymupdf

    outdir.mkdir(parents=True, exist_ok=True)
    pages: list[str] = []
    with pymupdf.open(pdf) as doc:
        total = doc.page_count
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            long_pt = max(page.rect.width, page.rect.height) or 1
            zoom = min(max_edge / long_pt, 200 / 72)   # at most 200 dpi
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            out = outdir / f"p{i + 1}.png"
            pix.save(out)
            pages.append(str(out))
    return {"total": total, "pages": pages}


def _emit(payload: dict) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
