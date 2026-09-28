"""技术方案书排版：内容来自 TS 内核生成的 ProposalDoc（tests/fixtures/proposal/，由
src/av/core/proposal.ts 产出），这里检查封面、版权页、页眉页脚、表格与中英文字体。"""
import json
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

from avdrawing.proposal import render

FIX = Path(__file__).parent / "fixtures" / "proposal"


def _load(name):
    return json.loads((FIX / f"{name}.json").read_text(encoding="utf-8"))


def _open(tmp_path, name):
    return Document(render(_load(name), tmp_path / f"{name}.docx"))


def test_封面_版权页_正文(tmp_path):
    d = _open(tmp_path, "doc-zh")
    texts = [p.text for p in d.paragraphs]
    body = "\n".join(texts)
    i_title = texts.index("LED 显示屏系统技术方案")
    assert texts[i_title + 1] == "项目  144 Chuan Grove"
    assert texts[i_title + 2] == "客户  海晟置业"
    assert "版权声明" in texts and "© 2026 AUDAX。保留所有权利。" in texts
    assert texts.index("版权声明") < texts.index("一、方案概述")
    assert "共需 3 个供电回路，另预留 1 路备用，合计电源线 4 根" in body
    assert "六、待确认事项" not in body
    cells = [[c.text for c in r.cells] for t in d.tables for r in t.rows]
    assert ["640 × 480", "28 只", "库内标准"] in cells
    assert len(d.inline_shapes) == 1, "正文只有封面标志"


def test_页眉页脚(tmp_path):
    d = _open(tmp_path, "doc-zh")
    s = d.sections[0]
    assert s.different_first_page_header_footer, "封面不带页眉"
    head = s.header.paragraphs[0]
    assert "AUDAX" in head.text and "LED 显示屏系统技术方案" in head.text
    assert head._p.xpath(".//pic:pic"), "页眉含标志图"
    foot = s.footer.paragraphs[0]
    assert foot.text.startswith("AUDAX · LED 显示屏系统技术方案")
    assert any(el.text == "PAGE" for el in foot._p.iter(qn("w:instrText"))), "页脚含页码"


def test_英文版字体与内容(tmp_path):
    d = _open(tmp_path, "doc-en")
    texts = [p.text for p in d.paragraphs]
    assert "LED Display System Technical Proposal" in texts
    assert "Copyright" in texts and "1. Overview" in texts
    run = next(p for p in d.paragraphs if p.text == "1. Overview").runs[0]
    assert run.font.name == "Calibri"
    assert run._element.rPr.rFonts.get(qn("w:eastAsia")) == "Microsoft YaHei"
    cells = [[c.text for c in r.cells] for t in d.tables for r in t.rows]
    assert ["640 × 480", "28", "Standard (in library)"] in cells


def test_待确认事项与无客户(tmp_path):
    zh = _open(tmp_path, "doc-zh-warn")
    texts = [p.text for p in zh.paragraphs]
    assert "六、待确认事项" in texts
    assert not any(t.startswith("客户") for t in texts), "没有客户名时封面不留空行"
    en = "\n".join(p.text for p in _open(tmp_path, "doc-en-warn").paragraphs)
    assert "6. Items to Confirm" in en and "[LED-PWR-07] The electrical riser is 35 m away" in en
