"""03 解析提取 · 04 人工校核 · A9 计算链 · A10 校核闸门."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from avdrawing.ingest import grade, pipeline, semantic, vision, write_back_samples
from avdrawing.ingest.models import LED_ELEMENTS
from avdrawing.ingest.ocr import TextBox
from avdrawing.ingest.pdf_reader import Calibration
from tests.conftest import MOUNT_H, OPENING_H, OPENING_W


# ---------------------------------------------------------------- 分级 (§2.1)

def test_grading(dxf_drawing: Path, pdf_drawing: Path, scan_drawing: Path) -> None:
    assert grade(dxf_drawing) == "A"
    assert grade(pdf_drawing) == "B"
    assert grade(scan_drawing) == "C"


def test_unsupported_type_is_refused(tmp_path: Path) -> None:
    f = tmp_path / "notes.txt"
    f.write_text("x")
    with pytest.raises(ValueError, match="unsupported drawing type"):
        grade(f)


# ------------------------------------------------- 图层语义映射 (§14)

def test_layer_mapping_separates_real_layer_names() -> None:
    """Cosine alone cannot: "A-WALL" scores 0.79 against "led wall" while the
    genuine "屏体轮廓" scores 0.66. The marker gate is what makes it usable."""
    positives = ["LED SCREEN", "A-LED-DISPLAY", "led_wall", "LEDWALL", "LED-01",
                 "屏体", "屏体轮廓", "显示屏", "LED屏体", "大屏轮廓"]
    negatives = ["A-WALL", "A-DOOR", "M-DUCT", "E-LIGHT", "0", "DEFPOINTS",
                 "A-GLAZ", "轴线", "墙体", "标注", "S-BEAM", "A-CEILING"]
    best_negative = max(semantic.score(n, "led_screen").score for n in negatives)
    worst_positive = min(semantic.score(n, "led_screen").score for n in positives)
    assert best_negative == 0.0
    assert worst_positive > semantic.DEFAULT_THRESHOLD


def test_layer_mapping_is_separator_and_case_insensitive() -> None:
    scores = {semantic.score(n, "led_screen").score for n in ("LED SCREEN", "led-screen", "Led_Screen")}
    assert len(scores) == 1


# ------------------------------------------------------ A 级 DXF (§14)

def test_dxf_extracts_the_opening(dxf_drawing: Path) -> None:
    result = pipeline.ingest(dxf_drawing)
    assert result.grade == "A"
    assert {e.element for e in result.extractions} == set(LED_ELEMENTS)
    assert result.get("led_opening_w").value == pytest.approx(OPENING_W)
    assert result.get("led_opening_h").value == pytest.approx(OPENING_H)
    assert result.get("led_mount_h").value == pytest.approx(MOUNT_H)


def test_dxf_provenance_names_file_layer_and_coordinate(dxf_drawing: Path) -> None:
    """§9's example format: 01_平面图.dxf / A-WALL / (12400, 8200)."""
    prov = pipeline.ingest(dxf_drawing).get("led_opening_w").prov
    assert prov.source.startswith("01_平面图.dxf / A-LED-DISPLAY / (")
    assert prov.method == "rule"
    assert prov.label() == "rule · A级-DXF-实体范围"
    assert 0 < prov.score() <= 1


def test_dxf_measures_the_power_riser_distance(dxf_drawing: Path) -> None:
    riser = pipeline.ingest(dxf_drawing).get("led_pwr_dist")
    assert riser.value == pytest.approx(18.0, abs=0.05)
    assert riser.unit == "m"
    assert "未计走线路径" in riser.prov.note


def test_dxf_without_a_screen_layer_falls_back_to_manual(dxf_without_led: Path) -> None:
    result = pipeline.ingest(dxf_without_led)
    assert all(e.value is None and e.prov.method == "manual" for e in result.extractions)
    assert any("未能" in n for n in result.notes)
    assert not result.may_enter_configuration()


def test_dxf_with_unknown_units_is_refused(tmp_path: Path) -> None:
    import ezdxf
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 12  # nanometres — not a drawing unit we convert
    path = tmp_path / "bad-units.dxf"
    doc.saveas(path)
    with pytest.raises(ValueError, match="unsupported \\$INSUNITS"):
        pipeline.ingest(path)


# ------------------------------------------------ B 级 矢量 PDF (§14)

def test_pdf_requires_calibration_first(pdf_drawing: Path) -> None:
    """§2.1 — 比例尺标定 is a step, not an inference."""
    with pytest.raises(ValueError, match="比例尺标定"):
        pipeline.ingest(pdf_drawing)


def test_pdf_measures_against_the_supplied_scale(pdf_drawing: Path) -> None:
    result = pipeline.ingest(pdf_drawing, calibration=Calibration.from_scale(50))
    assert result.grade == "B"
    assert result.get("led_opening_w").value == pytest.approx(OPENING_W, rel=0.01)
    assert result.get("led_opening_h").value == pytest.approx(OPENING_H, rel=0.01)


def test_pdf_raises_confidence_when_a_dimension_corroborates(pdf_drawing: Path) -> None:
    """§9's 三源一致 idea, applied to the two sources a PDF offers."""
    result = pipeline.ingest(pdf_drawing, calibration=Calibration.from_scale(50))
    prov = result.get("led_opening_w").prov
    assert prov.score() > 0.9
    assert "双源互证" in prov.note


def test_pdf_two_point_calibration_matches_the_scale_form() -> None:
    by_scale = Calibration.from_scale(50).mm_per_pt
    by_points = Calibration.from_reference((0, 0), (100, 0), 100 * by_scale).mm_per_pt
    assert by_points == pytest.approx(by_scale)


def test_pdf_rejects_degenerate_calibration() -> None:
    with pytest.raises(ValueError, match="distinct"):
        Calibration.from_reference((10, 10), (10, 10), 1000)
    with pytest.raises(ValueError, match="positive"):
        Calibration.from_scale(0)


# --------------------------------------------------- C 级 扫描件 (§13.2)

class FakeOcr:
    def __init__(self, boxes: list[TextBox]) -> None:
        self._boxes = boxes

    def read(self, image: Path) -> list[TextBox]:
        return list(self._boxes)


def test_scan_candidates_never_pass_the_gate_on_their_own(scan_drawing: Path) -> None:
    """§13.2 — 扫描件不可作为算量依据，结论须人工输入."""
    backend = FakeOcr([
        TextBox("4480", 0.99, (10, 10, 60, 24)),
        TextBox("2560", 0.98, (10, 40, 60, 54)),
    ])
    result = pipeline.ingest(scan_drawing, ocr_backend=backend)
    assert result.grade == "C"
    assert result.get("led_opening_w").value == 4480
    # Even at OCR confidence 0.99 the record stays below any sane threshold …
    assert result.get("led_opening_w").prov.score() <= 0.75
    # … and the gate is closed until a person has confirmed every element.
    assert not result.may_enter_configuration(threshold=0.5)
    for e in result.extractions:
        e.confirm(by="PM-Jimmy", corrected=e.value)
    assert result.may_enter_configuration(threshold=0.5)


def test_scan_requires_an_ocr_engine(scan_drawing: Path) -> None:
    with pytest.raises(ValueError, match="OCR 引擎"):
        pipeline.ingest(scan_drawing)


def test_scan_without_readable_numbers_is_all_manual(scan_drawing: Path) -> None:
    result = pipeline.ingest(scan_drawing, ocr_backend=FakeOcr([TextBox("图例", 0.9, (0, 0, 1, 1))]))
    assert all(e.value is None for e in result.extractions)


# -------------------------------------------- 04 校核 · A10 闸门 · 样本回写

def test_gate_blocks_until_low_confidence_items_are_confirmed(dxf_drawing: Path) -> None:
    result = pipeline.ingest(dxf_drawing)
    pending = result.unconfirmed_below(0.9)
    assert pending, "安装标高与观看距离等项本就应低于阈值"
    assert not result.may_enter_configuration(0.9)
    for e in pending:
        e.confirm(by="PM-Jimmy")
    assert result.may_enter_configuration(0.9)


def test_confirmation_keeps_the_original_beside_the_correction(dxf_drawing: Path) -> None:
    """§10 — 同时保留原始与修正."""
    result = pipeline.ingest(dxf_drawing)
    item = result.get("led_opening_w")
    original = item.value
    item.confirm(by="PM-Jimmy", corrected=4500.0)
    assert item.value == original
    assert item.corrected == 4500.0
    assert item.final == 4500.0
    assert item.prov.confidence == "confirmed"
    assert item.prov.score() == 1.0
    assert item.corrected_by == "PM-Jimmy" and item.corrected_at


def test_corrections_are_written_back_as_samples(dxf_drawing: Path, tmp_path: Path) -> None:
    """04 修正回写样本库 — the annotated set §14 wants before moving to YOLO."""
    result = pipeline.ingest(dxf_drawing)
    result.get("led_opening_w").confirm(by="PM-Jimmy", corrected=4500.0)
    result.get("led_opening_h").confirm(by="PM-Jimmy")  # confirmed, not corrected

    store = tmp_path / "samples" / "led.jsonl"
    assert write_back_samples(result, store) == 1
    rows = [json.loads(line) for line in store.read_text(encoding="utf-8").splitlines()]
    assert rows[0]["element"] == "led_opening_w"
    assert rows[0]["predicted"] == OPENING_W and rows[0]["label"] == 4500.0
    assert rows[0]["grade"] == "A" and rows[0]["by"] == "PM-Jimmy"

    # Appending a second drawing's corrections grows the same store.
    write_back_samples(result, store)
    assert len(store.read_text(encoding="utf-8").splitlines()) == 2


def test_unknown_element_is_rejected(dxf_drawing: Path) -> None:
    from avdrawing.ingest.models import Extraction, Provenance
    with pytest.raises(ValueError, match="unknown element"):
        Extraction("d.dxf", "led_colour", 1, "mm", Provenance("x", "manual", 0.0))


def test_summary_line_reports_the_gate(dxf_drawing: Path) -> None:
    result = pipeline.ingest(dxf_drawing)
    assert "A 级" in pipeline.summarise(result)
    assert "待确认" in pipeline.summarise(result)
    for e in result.extractions:
        e.confirm(by="PM")
    assert "可进入 05" in pipeline.summarise(result)


# ------------------------------------------------- 图例视觉识别 (§14)

class FakeBlock:
    type = "text"

    def __init__(self, text: str) -> None:
        self.text = text


class FakeResponse:
    def __init__(self, text: str, stop_reason: str = "end_turn") -> None:
        self.content = [FakeBlock(text)]
        self.stop_reason = stop_reason
        self.stop_details = None


class FakeMessages:
    def __init__(self, response: FakeResponse) -> None:
        self._response = response
        self.seen: dict = {}

    def create(self, **kwargs):
        self.seen = kwargs
        return self._response


class FakeClient:
    def __init__(self, response: FakeResponse) -> None:
        self.messages = FakeMessages(response)


@pytest.fixture
def legend_image(tmp_path: Path) -> Path:
    import pymupdf
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 80, 40))
    pix.clear_with(255)
    path = tmp_path / "legend.png"
    pix.save(path)
    return path


def test_legend_recognition_request_shape(legend_image: Path) -> None:
    payload = json.dumps({"entries": [
        {"symbol": "LED-01", "meaning": "LED 显示屏", "category": "screen",
         "confidence": 0.94, "note": ""},
    ]})
    client = FakeClient(FakeResponse(payload))
    entries = vision.recognise_legend(legend_image, client=client)

    assert [e.symbol for e in entries] == ["LED-01"]
    assert entries[0].category == "screen" and entries[0].confidence == 0.94

    sent = client.messages.seen
    assert sent["model"] == "claude-sonnet-5"          # §14 names Sonnet for this step
    assert sent["thinking"] == {"type": "adaptive"}
    assert sent["output_config"]["format"]["type"] == "json_schema"
    image_block = sent["messages"][0]["content"][0]
    assert image_block["source"]["media_type"] == "image/png"
    assert image_block["source"]["type"] == "base64"
    # §1 — the model is never asked to compute a quantity.
    assert "不要计算数量" in sent["system"]


def test_legend_recognition_surfaces_refusal_and_truncation(legend_image: Path) -> None:
    with pytest.raises(RuntimeError, match="被拒绝"):
        vision.recognise_legend(legend_image, client=FakeClient(FakeResponse("{}", "refusal")))
    with pytest.raises(RuntimeError, match="被截断"):
        vision.recognise_legend(legend_image, client=FakeClient(FakeResponse("{}", "max_tokens")))


def test_legend_recognition_rejects_unsupported_images(tmp_path: Path) -> None:
    bad = tmp_path / "legend.bmp"
    bad.write_bytes(b"\x00")
    with pytest.raises(ValueError, match="unsupported image type"):
        vision.recognise_legend(bad, client=FakeClient(FakeResponse("{}")))


# ------------------------------------------------ CLI (the web app's entry)

def _cli(args: list[str], stdin: str | None = None) -> tuple[int, dict]:
    import subprocess, sys
    proc = subprocess.run(
        [sys.executable, "-m", "avdrawing.ingest.cli", *args],
        input=stdin, capture_output=True, text=True, cwd=Path(__file__).parent.parent,
    )
    return proc.returncode, json.loads(proc.stdout)


def test_cli_ingest_marks_what_needs_review(dxf_drawing: Path) -> None:
    code, out = _cli(["ingest", str(dxf_drawing)])
    assert code == 0
    assert out["grade"] == "A" and out["may_enter_configuration"] is False
    by = {e["element"]: e for e in out["extractions"]}
    assert by["led_opening_w"]["value"] == pytest.approx(OPENING_W)
    assert by["led_opening_w"]["needs_review"] is False   # 0.94 on the matched layer
    assert by["led_view_min"]["needs_review"] is True     # not on any drawing


def test_cli_reports_errors_as_json(pdf_drawing: Path) -> None:
    code, out = _cli(["ingest", str(pdf_drawing)])
    assert code == 2 and "比例尺标定" in out["error"]
    code, out = _cli(["ingest", str(pdf_drawing), "--scale", "50"])
    assert code == 0 and out["grade"] == "B"


def test_cli_scan_without_paddle_says_how_to_install(scan_drawing: Path) -> None:
    code, out = _cli(["ingest", str(scan_drawing)])
    assert code == 2 and "requirements-ocr.txt" in out["error"]


def test_cli_writeback_round_trips_the_reviewed_json(dxf_drawing: Path, tmp_path: Path) -> None:
    _, out = _cli(["ingest", str(dxf_drawing)])
    item = next(e for e in out["extractions"] if e["element"] == "led_opening_w")
    item.update(confirmed=True, corrected=4500.0, corrected_by="PM-Jimmy", corrected_at="2026-09-25T10:00:00+00:00")
    store = tmp_path / "led.jsonl"
    code, res = _cli(["writeback", str(store)], stdin=json.dumps(out))
    assert code == 0 and res == {"written": 1, "may_enter_configuration": False}
    row = json.loads(store.read_text(encoding="utf-8"))
    assert row["predicted"] == pytest.approx(OPENING_W) and row["label"] == 4500.0


def test_gate_ignores_confirmed_items_and_empty_ingests(dxf_drawing: Path) -> None:
    from avdrawing.ingest.models import DrawingIngest
    assert not DrawingIngest("x.dxf", "A", 1.0).may_enter_configuration()
    result = pipeline.ingest(dxf_drawing)
    d = result.to_dict()
    assert sum(e["needs_review"] for e in d["extractions"]) == len(result.unconfirmed_below(0.9))


def test_cli_writeback_passes_the_gate_only_when_everything_is_reviewed(dxf_drawing: Path, tmp_path: Path) -> None:
    _, out = _cli(["ingest", str(dxf_drawing)])
    for e in out["extractions"]:
        e["confirmed"] = True
        if e["value"] is None:
            e.update(corrected=3.0, corrected_by="PM", corrected_at="2026-09-25T10:00:00+00:00")
    code, res = _cli(["writeback", str(tmp_path / "s.jsonl")], stdin=json.dumps(out))
    assert code == 0 and res["may_enter_configuration"] is True


def test_a_required_element_confirmed_empty_keeps_the_gate_closed(dxf_without_led: Path) -> None:
    """未识别项补录 — confirming a blank opening is not filling it in."""
    result = pipeline.ingest(dxf_without_led)
    for e in result.extractions:
        e.confirm(by="PM")
    assert not result.may_enter_configuration()
    result.get("led_opening_w").confirm(by="PM", corrected=4480.0)
    result.get("led_opening_h").confirm(by="PM", corrected=2560.0)
    assert result.may_enter_configuration()
