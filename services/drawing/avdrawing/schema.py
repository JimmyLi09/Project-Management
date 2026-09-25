"""Drawing-model schema — the contract with src/av/core/drawing.ts.

Model space is millimetres, Y up, origin at the screen's bottom-left (§8.2).
Validation is explicit rather than trusting the payload, because a malformed
drawing must fail loudly instead of producing a silently wrong DXF.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

ANCHORS = ("start", "middle", "end")


class DrawingError(ValueError):
    """The drawing payload does not match the contract."""


@dataclass(frozen=True)
class Layer:
    name: str
    aci: int
    entities: tuple[dict[str, Any], ...]


@dataclass(frozen=True)
class Drawing:
    title: str
    layers: tuple[Layer, ...]

    @property
    def entity_count(self) -> int:
        return sum(len(layer.entities) for layer in self.layers)


_REQUIRED: dict[str, tuple[str, ...]] = {
    "line": ("x1", "y1", "x2", "y2"),
    "rect": ("x", "y", "w", "h"),
    "circle": ("cx", "cy", "r"),
    "text": ("x", "y", "h", "s", "anchor"),
}


def parse(payload: Any) -> Drawing:
    if not isinstance(payload, dict):
        raise DrawingError("drawing must be an object")
    title = payload.get("title")
    if not isinstance(title, str):
        raise DrawingError("drawing.title must be a string")
    raw_layers = payload.get("layers")
    if not isinstance(raw_layers, list) or not raw_layers:
        raise DrawingError("drawing.layers must be a non-empty array")
    return Drawing(title=title, layers=tuple(_layer(x) for x in raw_layers))


def _layer(raw: Any) -> Layer:
    if not isinstance(raw, dict):
        raise DrawingError("each layer must be an object")
    name, aci = raw.get("name"), raw.get("aci")
    if not isinstance(name, str) or not name:
        raise DrawingError("layer.name must be a non-empty string")
    if not isinstance(aci, int) or not 1 <= aci <= 255:
        raise DrawingError(f"layer {name!r}: aci must be an AutoCAD colour index 1-255")
    entities = raw.get("entities", [])
    if not isinstance(entities, list):
        raise DrawingError(f"layer {name!r}: entities must be an array")
    return Layer(name=name, aci=aci, entities=tuple(_entity(name, e) for e in entities))


def _entity(layer: str, raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise DrawingError(f"layer {layer!r}: each entity must be an object")
    kind = raw.get("k")
    if kind not in _REQUIRED:
        raise DrawingError(f"layer {layer!r}: unknown entity kind {kind!r}")
    for field in _REQUIRED[kind]:
        if field not in raw:
            raise DrawingError(f"layer {layer!r}: {kind} entity missing {field!r}")
    if kind == "text":
        if not isinstance(raw["s"], str):
            raise DrawingError(f"layer {layer!r}: text.s must be a string")
        if raw["anchor"] not in ANCHORS:
            raise DrawingError(f"layer {layer!r}: text.anchor must be one of {ANCHORS}")
        _numbers(layer, raw, ("x", "y", "h"))
    else:
        _numbers(layer, raw, _REQUIRED[kind])
    return raw


def _numbers(layer: str, raw: dict[str, Any], fields: Iterable[str]) -> None:
    for field in fields:
        value = raw[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise DrawingError(f"layer {layer!r}: {field!r} must be a number, got {value!r}")
