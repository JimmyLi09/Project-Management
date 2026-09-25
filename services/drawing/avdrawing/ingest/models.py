"""Extraction records — §9 计算链标注 and the §10 `extraction` table.

Every value that enters the calculation chain carries all three labels: where it
came from, how it was obtained, and how sure we are. The record keeps the raw
extraction and any human correction side by side ("同时保留原始与修正"), because
the correction is both the value 05 uses and the training sample 04 writes back.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

#: §4.1 — the six drawing-derived elements the ingest stage is asked to find.
LED_ELEMENTS: tuple[str, ...] = (
    "led_opening_w",
    "led_opening_h",
    "led_mount_h",
    "led_ctrl_dist",
    "led_pwr_dist",
    "led_view_min",
)

Method = Literal["ai_vision", "ai_ocr", "rule", "manual", "lookup"]
Grade = Literal["A", "B", "C"]

#: §2.1 — drawing grades. A is measurable, C is explicitly not (§13.2: 扫描件不可
#: 作为算量依据，仅作辅助识别，结论须人工输入).
GRADE_MEASURABLE: dict[str, bool] = {"A": True, "B": True, "C": False}


@dataclass(frozen=True)
class Provenance:
    """§9 — the three labels, in the same shape as the TypeScript core's."""

    source: str
    method: Method
    confidence: float | Literal["deterministic", "confirmed"]
    rule: str | None = None
    note: str | None = None

    def label(self) -> str:
        return f"rule · {self.rule}" if self.method == "rule" and self.rule else self.method

    def score(self) -> float:
        """Confidence as a number, for threshold comparisons."""
        if self.confidence in ("deterministic", "confirmed"):
            return 1.0
        return float(self.confidence)


@dataclass
class Extraction:
    """One extracted element, before and after 04 校核."""

    drawing: str
    element: str
    value: float | None
    unit: str
    prov: Provenance
    confirmed: bool = False
    corrected: float | None = None
    corrected_by: str = ""
    corrected_at: str = ""

    def __post_init__(self) -> None:
        if self.element not in LED_ELEMENTS:
            raise ValueError(f"unknown element {self.element!r}; expected one of {LED_ELEMENTS}")

    @property
    def final(self) -> float | None:
        """What 05 方案配置 reads: the correction when there is one."""
        return self.corrected if self.corrected is not None else self.value

    def confirm(self, by: str, corrected: float | None = None) -> None:
        """04 校核 — a PM confirms the value, optionally correcting it.

        The original stays in `value`; confirming promotes the record's
        confidence to 'confirmed' and records who did it (§9).
        """
        if corrected is not None:
            self.corrected = corrected
            self.corrected_by = by
            self.corrected_at = _now()
        self.confirmed = True
        self.prov = Provenance(
            source=self.prov.source,
            method=self.prov.method,
            confidence="confirmed",
            rule=self.prov.rule,
            note=self.prov.note,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DrawingIngest:
    """Everything one drawing produced, plus the 04 gate."""

    drawing: str
    grade: Grade
    scale_mm_per_unit: float
    extractions: list[Extraction] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def get(self, element: str) -> Extraction | None:
        return next((e for e in self.extractions if e.element == element), None)

    def unconfirmed_below(self, threshold: float) -> list[Extraction]:
        """A10 校核闸门 — items whose confidence is under the threshold and that
        nobody has confirmed yet."""
        return [e for e in self.extractions if not e.confirmed and e.prov.score() < threshold]

    def may_enter_configuration(self, threshold: float = 0.9) -> bool:
        """A10 — 置信度低于阈值的项未确认时，无法进入 05.

        A C-grade drawing can never pass on its own: §13.2 rules scanned sheets
        out as a basis for quantities, so every element has to be confirmed by a
        person regardless of how confident the OCR was.
        """
        if not GRADE_MEASURABLE[self.grade]:
            return all(e.confirmed for e in self.extractions) and bool(self.extractions)
        return not self.unconfirmed_below(threshold)


def write_back_samples(ingest: DrawingIngest, store: Path) -> int:
    """04 修正回写样本库.

    Appends every corrected extraction to a JSONL store as a labelled sample.
    This is what accumulates the 300+ annotations §14 wants before the legend
    recogniser moves from the vision API to a local YOLO model.
    """
    corrected = [e for e in ingest.extractions if e.corrected is not None]
    if not corrected:
        return 0
    store.parent.mkdir(parents=True, exist_ok=True)
    with store.open("a", encoding="utf-8") as fh:
        for e in corrected:
            fh.write(json.dumps({
                "drawing": e.drawing,
                "grade": ingest.grade,
                "element": e.element,
                "predicted": e.value,
                "label": e.corrected,
                "method": e.prov.method,
                "confidence": e.prov.score(),
                "source": e.prov.source,
                "by": e.corrected_by,
                "at": e.corrected_at,
            }, ensure_ascii=False) + "\n")
    return len(corrected)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
