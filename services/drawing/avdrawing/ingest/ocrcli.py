"""AV-015 §5 — the OCR fallback, as its own tiny entry point.

    python -m avdrawing.ingest.ocrcli <image>     -> {"boxes": [{"text", "confidence", "box"}]}

It runs in the separate OCR environment (.venv-ocr, see requirements-ocr.txt),
which carries PaddleOCR and nothing of the drawing service's own stack, so it
imports only the stdlib-only modules of this package. When the local vision
model is unavailable the web app calls this; when OCR is not installed either,
it answers {"code": "ocr_missing"} and the screen falls back to manual entry.
"""

from __future__ import annotations

import contextlib
import json
import sys
from pathlib import Path

from .ocr import OcrUnavailable, PaddleOcrBackend


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        return _emit({"error": "usage: python -m avdrawing.ingest.ocrcli <image>", "code": "usage"}, 2)
    image = Path(argv[0])
    # PaddleOCR prints its own logs and download progress; keep stdout for the JSON.
    with contextlib.redirect_stdout(sys.stderr):
        try:
            backend = PaddleOcrBackend()
        except OcrUnavailable as exc:
            return _emit({"error": str(exc), "code": "ocr_missing"}, 2)
        except Exception as exc:  # pragma: no cover - e.g. the first-run weight download failed
            return _emit({"error": f"文字识别启动失败：{exc}", "code": "ocr_failed"}, 2)
        try:
            boxes = backend.read(image)
        except Exception as exc:  # pragma: no cover - depends on the optional install
            return _emit({"error": f"文字识别失败：{exc}", "code": "ocr_failed"}, 2)
    return _emit({"boxes": [
        {"text": b.text, "confidence": round(b.confidence, 3), "box": [round(v, 1) for v in b.box]} for b in boxes
    ]}, 0)


def _emit(payload: dict, code: int) -> int:
    out = sys.__stdout__
    json.dump(payload, out, ensure_ascii=False)
    out.write("\n")
    out.flush()
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
