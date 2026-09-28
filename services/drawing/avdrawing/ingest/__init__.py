"""03 解析提取 / 04 人工校核 — drawing ingest for the LED business line.

§1's design rule holds here: the AI is confined to the two ends of the chain.
This package extracts values from drawings (some of it with a model) and records
how sure it is; nothing here computes a quantity, a power figure or a circuit
count — those come from the deterministic core.
"""

from .grade import grade
from .models import (
    LED_ELEMENTS,
    DrawingIngest,
    Extraction,
    Provenance,
    write_back_samples,
)

__all__ = [
    "LED_ELEMENTS", "DrawingIngest", "Extraction", "Provenance", "grade", "write_back_samples",
]
