"""图例符号识别 — §14: Claude Sonnet 视觉 API，积累 300+ 标注样本后转 YOLO.

This is one of the two places §1 allows a model: reading a drawing. It returns
what it saw and how sure it was; it is never asked for a quantity, a power
figure or a circuit count — those are the deterministic core's, always.

Every recognition is a candidate for 04 校核. Confirmed corrections are written
back by `models.write_back_samples`, which is how the annotated set §14 wants
before moving to a local YOLO model accumulates.
"""

from __future__ import annotations

import base64
import json
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: §14 names Claude Sonnet for this step.
MODEL = "claude-sonnet-5"
MAX_TOKENS = 8000

SUPPORTED_MEDIA = {"image/png", "image/jpeg", "image/gif", "image/webp"}

SYSTEM = (
    "你是 AV 工程图纸的图例识别助手。只描述你在图像中实际看到的内容。"
    "不要计算数量、功率、回路数或任何工程量——那些由确定性程序负责，你给出的数字只会被丢弃。"
    "看不清或不确定时，如实给出较低的 confidence，不要猜测。"
)

PROMPT = (
    "识别这张工程图纸图例区中的符号条目。对每一条给出："
    "symbol（图例中的符号标记，如 LED-01）、meaning（其说明文字）、"
    "category（screen / power / data / structure / other）、"
    "confidence（0-1，你对这一条识别的把握）、"
    "note（看不清或有歧义时说明原因，否则留空）。"
    "只返回图例区中确实存在的条目。"
)

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "entries": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "meaning": {"type": "string"},
                    "category": {
                        "type": "string",
                        "enum": ["screen", "power", "data", "structure", "other"],
                    },
                    "confidence": {"type": "number"},
                    "note": {"type": "string"},
                },
                "required": ["symbol", "meaning", "category", "confidence", "note"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["entries"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class LegendEntry:
    symbol: str
    meaning: str
    category: str
    confidence: float
    note: str = ""


def recognise_legend(image: Path, client: Any | None = None) -> list[LegendEntry]:
    """Read the legend block of a drawing image.

    `client` is injectable so the pipeline can be exercised without the network;
    when omitted, a default `anthropic.Anthropic()` is constructed, which resolves
    credentials from the environment.
    """
    media_type = mimetypes.guess_type(image.name)[0]
    if media_type not in SUPPORTED_MEDIA:
        raise ValueError(f"unsupported image type {media_type!r} for {image.name}")

    if client is None:
        import anthropic

        client = anthropic.Anthropic()

    data = base64.standard_b64encode(image.read_bytes()).decode("ascii")
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM,
        thinking={"type": "adaptive"},
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    )
    return parse_response(response)


def parse_response(response: Any) -> list[LegendEntry]:
    """Pull the entries out of a Messages response.

    Guards the two failure modes that return HTTP 200: a refusal, and a run that
    hit the token ceiling mid-JSON.
    """
    stop = getattr(response, "stop_reason", None)
    if stop == "refusal":
        details = getattr(response, "stop_details", None)
        raise RuntimeError(f"图例识别被拒绝：{getattr(details, 'category', None)}")
    if stop == "max_tokens":
        raise RuntimeError("图例识别输出被截断，请缩小图像范围或提高 max_tokens。")

    text = next((b.text for b in response.content if b.type == "text"), None)
    if text is None:
        raise RuntimeError("图例识别未返回文本内容。")
    payload = json.loads(text)
    return [
        LegendEntry(
            symbol=e["symbol"], meaning=e["meaning"], category=e["category"],
            confidence=float(e["confidence"]), note=e.get("note", ""),
        )
        for e in payload["entries"]
    ]
