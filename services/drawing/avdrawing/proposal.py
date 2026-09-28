"""LED 技术方案书（Word）：模板 + 槽位填充。

移植自 avcost-phase1 的 app/core/proposal.py（2026-09-28）。不接任何模型：所有数字由
TypeScript 计算内核给出（src/av/core/proposal.ts 的 ProposalPayload），叙述文字按条件
从预写段落拼装。相对原版的改动：
  · 箱体清单的「状态」按实际库内 / 库外填写（原版一律写「库内标准」）；
  · 备用回路与备用数据线数量取自计算结果，不写死为 1；
  · 观看距离与强电井两段叙述跟随校验结果（LED-VD-01 / LED-PWR-07），不再另设阈值；
  · 中文字体同时写入东亚字体槽，Word 中才会真正用上微软雅黑。

用法：python -m avdrawing.proposal payload.json out.docx
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

FONT = "Microsoft YaHei"


def _font(run, size, bold=False, color=None):
    run.font.name = FONT
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONT)
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def _p(doc, text, size=10.5, bold=False, color=None, after=6, align=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(after)
    if align is not None:
        p.alignment = align
    _font(p.add_run(text), size, bold, color)
    return p


def _h(doc, text, level=1):
    _p(doc, text, size={1: 15, 2: 12.5}[level], bold=True, color="1F3864", after=8)


def _table(doc, header, rows):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    for i, h in enumerate(header):
        c = t.rows[0].cells[i]
        c.text = ""
        _font(c.paragraphs[0].add_run(h), 9.5, bold=True)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            _font(cells[i].paragraphs[0].add_run(str(v)), 9.5)
    return t


def _n(x) -> str:
    """4480.0 -> 4480, 2.5 -> 2.5"""
    return f"{x:g}"


def _codes(p: dict) -> set[str]:
    return {f["code"] for f in p["findings"]}


def narrative(p: dict) -> list[str]:
    """按计算结果条件拼装叙述段落。无模型参与。"""
    spare_pwr = p["nPowerCable"] - p["nCircuit"]
    spare_data = p["nDataCable"] - p["nDataRun"]
    out = [
        f"本方案针对 {_n(p['L'])} × {_n(p['H'])} mm 的显示区域，采用 P{_n(p['pitch'])} "
        f"{p['profile']} LED 显示屏，显示面积 {round(p['sqm'], 4):g} ㎡，"
        f"实际物理分辨率 {p['pxW']} × {p['pxH']} 像素。",
        f"屏体由 {p['cabinets']} 只箱体拼装而成，共计 {p['mods']} 块模组。"
        + ("箱体规格全部取自公司标准箱体库，无需定制。"
           if not p["custom"] else "部分箱体为库外规格，需向厂家定制，交期与价格另行确认。"),
        f"整屏最大功耗 {p['kw']:.2f} kW，按单回路 {_n(p['circuitKw'])} kW 配置，"
        f"共需 {p['nCircuit']} 个供电回路，另预留 {spare_pwr} 路备用，"
        f"合计电源线 {p['nPowerCable']} 根。",
        f"控制系统采用 {p['control']['name']}，按单网口带载 "
        f"{p['control']['dataPx']:,} 像素计算，需数据线 {p['nDataRun']} 条，"
        f"另预留 {spare_data} 条备用，合计 {p['nDataCable']} 根。",
    ]
    if p.get("viewMin"):
        out.append(
            f"最近观看距离 {_n(p['viewMin'])} m，小于 P{_n(p['pitch'])} 的推荐最小观看距离，近距离可能看到颗粒，建议复核点间距。"
            if "LED-VD-01" in _codes(p) else
            f"最近观看距离 {_n(p['viewMin'])} m，与 P{_n(p['pitch'])} 的点间距配置相匹配。"
        )
    if "LED-PWR-07" in _codes(p):
        out.append(f"强电井距屏体 {_n(p['pwrDist'])} m，超过 30 m，建议在屏体附近加装分配电箱以降低压降。")
    return out


def build(p: dict) -> Document:
    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = FONT
    st.element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONT)
    st.font.size = Pt(10.5)

    _p(doc, "LED 显示屏系统技术方案", size=20, bold=True, color="1F3864", after=4, align=WD_ALIGN_PARAGRAPH.CENTER)
    _p(doc, "　|　".join(x for x in (p.get("title"), p.get("client")) if x), size=11, color="666666", after=20,
       align=WD_ALIGN_PARAGRAPH.CENTER)

    _h(doc, "一、方案概述")
    for para in narrative(p):
        _p(doc, para, after=8)

    _h(doc, "二、屏体参数")
    _table(doc, ["项目", "参数", "依据"], [
        ["屏体尺寸", f"{_n(p['L'])} × {_n(p['H'])} mm", "图纸 / 人工确认"],
        ["显示面积", f"{round(p['sqm'], 4):g} ㎡", "F1"],
        ["点间距", f"P{_n(p['pitch'])}", "人工选择"],
        ["物理分辨率", f"{p['pxW']} × {p['pxH']}", "F4"],
        ["模组数量", f"{p['mods']} 块", "F2"],
        ["箱体数量", f"{p['cabinets']} 只", "F3"],
        ["最大功耗", f"{p['kw']:.2f} kW", "F5"],
    ])

    _h(doc, "三、箱体清单")
    _table(doc, ["规格 (mm)", "数量", "状态"], [
        [f"{_n(b['w'])} × {_n(b['h'])}", f"{b['count']} 只", "库内标准" if b["inLib"] else "库外，需定制"]
        for b in p["bom"]
    ])

    _h(doc, "四、供电与信号")
    _table(doc, ["项目", "配置", "依据"], [
        ["供电回路", f"{p['nCircuit']} 路", "F6"],
        ["回路分配", " / ".join(f"{w}W" for w in p["circuitsW"]), "按列均衡"],
        ["电源线（含备用）", f"{p['nPowerCable']} 根", "F7"],
        ["数据线", f"{p['nDataRun']} 条", "F8"],
        ["数据线（含备用）", f"{p['nDataCable']} 根", "F9"],
    ])

    _h(doc, "五、说明与限制")
    for t in [
        "本方案数值由规则引擎确定性计算，未使用生成式模型，每项结果均可追溯至公式编号。",
        f"计算依据规则包 {p['packVersion']}，参数组「{p['profile']}」。",
        "箱体规格与回路分组需现场复核后方可施工。结构承重、既有管线、实际净高不在本方案判断范围内。",
        "规范合规性（SCDF / BCA 等）须由工程师另行确认，系统不作判断。",
    ]:
        _p(doc, "· " + t, size=9.5, color="555555", after=4)

    if p["findings"]:
        _h(doc, "六、待确认事项")
        for f in p["findings"]:
            _p(doc, f"[{f['code']}] {f['message']}", size=9.5,
               color="7A2E2E" if f["severity"] == "block" else "8A4419", after=4)
    return doc


def render(payload: dict, out: Path) -> Path:
    build(payload).save(out)
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    src, dst = Path(argv[0]), Path(argv[1])
    render(json.loads(src.read_text(encoding="utf-8")), dst)
    print(dst)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
