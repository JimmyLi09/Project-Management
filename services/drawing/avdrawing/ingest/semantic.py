"""图层语义映射 — §14: text embedding + 余弦相似度，不需大模型.

Drawing layers are named by whoever drew them: "LED", "A-LED-DISPLAY", "屏体",
"显示屏轮廓". Mapping those to our elements is a text-similarity problem, not a
reasoning one.

The embedding is a character-bigram term-frequency vector: no model, no network,
deterministic, and it copes with the two things that actually vary between
drafters — mixed Chinese/English and separators (-/_/space).

Cosine alone is not enough for precision. Measured against real CAD layer names,
"A-WALL" scores 0.79 against "led wall" while the genuine "屏体轮廓" scores 0.66,
so the two classes overlap and no threshold separates them. Each element
therefore also carries **marker** substrings that must appear in the name: a
layer that never says LED / 屏 / 显示 is not the LED layer, whatever its bigrams
look like. The markers give precision; the cosine ranks the candidates that pass.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class Element:
    terms: tuple[str, ...]      # phrasings to measure similarity against
    markers: tuple[str, ...]    # at least one must occur in the name


#: Extend this as real drawings arrive rather than reaching for a model — a
#: missed layer name is a lexicon gap, not a reasoning failure.
LEXICON: dict[str, Element] = {
    "led_screen": Element(
        terms=("led", "led screen", "led display", "ledwall", "led wall",
               "屏体", "显示屏", "led屏", "大屏", "显示屏轮廓"),
        markers=("led", "屏", "显示"),
    ),
    "led_opening": Element(
        terms=("opening", "screen opening", "开口", "屏体开口", "洞口", "预留洞口"),
        markers=("opening", "开口", "洞口"),
    ),
    "led_mount_h": Element(
        terms=("mounting height", "install height", "安装标高", "标高", "离地高度"),
        markers=("height", "标高", "高度"),
    ),
    "led_ctrl_dist": Element(
        terms=("control room", "control", "机房", "控制室", "弱电间"),
        markers=("control", "机房", "控制", "弱电"),
    ),
    "led_pwr_dist": Element(
        terms=("power riser", "electrical riser", "强电井", "配电间", "电源井"),
        markers=("riser", "强电", "配电", "电源"),
    ),
    "led_view_min": Element(
        terms=("viewing distance", "观看距离", "最近观看距离", "视距"),
        markers=("viewing", "观看", "视距"),
    ),
}

DEFAULT_THRESHOLD = 0.5

_SPLIT = re.compile(r"[\s\-_/.,()\[\]#]+")


@dataclass(frozen=True)
class Match:
    """`name` is the layer that matched, `key` the element it maps to."""

    key: str
    name: str
    score: float
    matched: str


def normalise(text: str) -> str:
    """Lower-case and collapse the separators drafters disagree about."""
    return " ".join(p for p in _SPLIT.split(text.strip().lower()) if p)


def embed(text: str) -> Counter[str]:
    """Character-bigram term frequencies, with unigrams so single CJK characters
    and one-letter tokens still carry weight."""
    s = normalise(text)
    if not s:
        return Counter()
    grams = Counter(s)
    grams.update(s[i:i + 2] for i in range(len(s) - 1))
    return grams


def cosine(a: Counter[str], b: Counter[str]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(a[k] * b[k] for k in set(a) & set(b))
    if not dot:
        return 0.0
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb)


def has_marker(name: str, key: str) -> bool:
    flat = normalise(name).replace(" ", "")
    return any(m.replace(" ", "") in flat for m in LEXICON[key].markers)


def score(name: str, key: str) -> Match:
    """Similarity of one layer name to one element. Zero without a marker."""
    if key not in LEXICON:
        raise KeyError(f"no lexicon for {key!r}")
    if not has_marker(name, key):
        return Match(key=key, name=name, score=0.0, matched="")
    vector = embed(name)
    best_term, best_score = "", 0.0
    for term in LEXICON[key].terms:
        s = cosine(vector, embed(term))
        if s > best_score:
            best_term, best_score = term, s
    return Match(key=key, name=name, score=best_score, matched=best_term)


def classify(name: str, threshold: float = DEFAULT_THRESHOLD) -> Match | None:
    """Which element this layer name refers to, if any."""
    best = max((score(name, key) for key in LEXICON), key=lambda m: m.score, default=None)
    return best if best and best.score >= threshold else None


def pick_layer(names: list[str], key: str, threshold: float = DEFAULT_THRESHOLD) -> Match | None:
    """Best layer for `key` among a drawing's layer names.

    Returns None below the threshold rather than guessing — an unmatched layer
    becomes a manual entry in 04 校核, which is the honest outcome.
    """
    best = max((score(n, key) for n in names), key=lambda m: m.score, default=None)
    return best if best and best.score >= threshold else None
