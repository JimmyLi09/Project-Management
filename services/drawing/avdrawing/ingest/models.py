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

#: A10's threshold. The frozen spec says only "低于阈值"; the LED flow prototype
#: puts it at 85% ("置信度 < 85% 强制入队列").
REVIEW_THRESHOLD = 0.85

#: 05 cannot compute without these; the other four may be confirmed as "暂缺"
#: (they only feed warnings such as LED-VD-01 and LED-PWR-07).
REQUIRED_ELEMENTS: tuple[str, ...] = ("led_opening_w", "led_opening_h")

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
        """Items whose confidence is under the threshold and that nobody has
        confirmed yet."""
        return [e for e in self.extractions if not e.confirmed and e.prov.score() < threshold]

    def needs_review(self, e: Extraction, threshold: float = REVIEW_THRESHOLD) -> bool:
        """Whether 04 must confirm this item before 05 may use it (A10).

        A C-grade drawing's items always do: §13.2 rules scanned sheets out as a
        basis for quantities, so a person confirms every element regardless of
        how confident the OCR was.
        """
        if e.confirmed:
            # 未识别项补录 (§2.1): a required element confirmed without a value
            # has not actually been filled in.
            return e.element in REQUIRED_ELEMENTS and e.final is None
        return not GRADE_MEASURABLE[self.grade] or e.prov.score() < threshold

    def may_enter_configuration(self, threshold: float = REVIEW_THRESHOLD) -> bool:
        """A10 — 置信度低于阈值的项未确认时，无法进入 05."""
        if not self.extractions:
            return False
        return not any(self.needs_review(e, threshold) for e in self.extractions)

    def to_dict(self, threshold: float = REVIEW_THRESHOLD) -> dict[str, Any]:
        """The JSON handed to the 04 screen. Each item carries `needs_review`, so
        the gate rule lives here and the screen only tracks confirmations."""
        return {
            "drawing": self.drawing,
            "grade": self.grade,
            "scale_mm_per_unit": self.scale_mm_per_unit,
            "threshold": threshold,
            "notes": list(self.notes),
            "may_enter_configuration": self.may_enter_configuration(threshold),
            "extractions": [
                {**e.to_dict(), "needs_review": self.needs_review(e, threshold)}
                for e in self.extractions
            ],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DrawingIngest":
        """Rebuild a reviewed ingest sent back by the 04 screen."""
        out = cls(
            drawing=data["drawing"],
            grade=data["grade"],
            scale_mm_per_unit=float(data.get("scale_mm_per_unit", 0.0)),
            notes=list(data.get("notes", [])),
        )
        for raw in data["extractions"]:
            p = raw["prov"]
            out.extractions.append(Extraction(
                drawing=raw["drawing"], element=raw["element"], value=raw["value"], unit=raw["unit"],
                prov=Provenance(source=p["source"], method=p["method"], confidence=p["confidence"],
                                rule=p.get("rule"), note=p.get("note")),
                confirmed=bool(raw.get("confirmed")),
                corrected=raw.get("corrected"),
                corrected_by=raw.get("corrected_by", ""),
                corrected_at=raw.get("corrected_at", ""),
            ))
        return out


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
