/* REQ-055 · 导出 Excel(.xlsx):和格式样板逐格对照;文本原样;栏位开关、无分类、封面、两张表 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildXlsx, type XBook, type XHead, type XRow, type XSheet, type XTable } from '../exportXlsx.ts';

const SAMPLE = fileURLToPath(new URL('../../../docs/requirements/assets/055-清单Excel格式样板.xlsx', import.meta.url));
const load = async (buf: ArrayBuffer | Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as ArrayBuffer); return wb; };
const rgb = (c?: Partial<ExcelJS.Color>) => (c && c.argb ? c.argb.slice(-6).toUpperCase() : '');
const fillOf = (cell: ExcelJS.Cell) => (cell.fill && cell.fill.type === 'pattern' && cell.fill.pattern === 'solid' ? rgb(cell.fill.fgColor) : '');
const merges = (ws: ExcelJS.Worksheet) => [...((ws as unknown as { model: { merges: string[] } }).model.merges)].sort();

/* 173-Elite Park Avenue · 只勾 Scale Model · 栏位 Owner / Status / Remark(不勾 Date)—— 和样板同一份内容 */
const H: XHead[] = [{ v: 'Item', xw: 58 }, { v: 'Owner', xw: 16 }, { v: 'Status / Received', xw: 26 }, { v: 'Remark', xw: 30 }];
const it = (name: string, owner: string, status: string, remark: string): XRow => ({
  key: name, cells: [{ v: name }, { v: owner }, { v: status, st: status === 'Pending' ? { fill: '#fffbeb' } : undefined }, { v: remark, st: { pre: true } }],
});
const GROUPS: XTable[] = [
  { group: 'Site / Marketing / Requirements', heads: H, rows: [
    it('1:50 Architecture Scale model', 'Eric', 'Confirmed', '—'),
    it('Model type: marketing / location', 'JM', 'Confirmed', '—'),
    it('Title board (logos, north arrow, scale)', 'JM', 'Pending', 'Pending information'),
    it('Model stand info (base dim, access panel, power)', 'ID', 'Pending', 'Pending information'),
    it('Surrounding landmarks / road names', 'JM', 'Pending', 'Pending information'),
    it('Mock-up area decision (inform the client first)', 'Architects', 'Pending', 'Pending information'),
  ] },
  { group: 'From Architect', heads: H, rows: [
    it('Final CAD + SKP + plans / elevations / roof', '—', 'Pending', '—'),
    it('Façade material schedule', '—', 'Pending', '—'),
    it('Balcony floor finish', '—', 'Pending', '—'),
    it('Unit number', '—', 'Pending', '—'),
    it('Glass sample colour', '—', 'Pending', '—'),
  ] },
  { group: 'From Landscape (consultant)', heads: H, rows: [
    it('Planting layout + ref', '—', 'Pending', '—'),
    it('Landscape material spec', '—', 'Pending', '—'),
    it('Lighting plan + ref', '—', 'Pending', '—'),
    it('Other outdoor furniture', '—', 'Pending', '—'),
    it('Pool & water feature', '—', 'Pending', '—'),
  ] },
];
const NOTES = 'Note: incomplete information may affect the delivery schedule; repeated revisions after confirmation may incur additional charges.';
const elite = (over: Partial<XSheet> = {}): XSheet => ({
  name: 'Checklist', title: '050 · 173-Elite Park Avenue — Checklist',
  sub: 'Client: Noel Property Development Pte Ltd · Services: Scale Model · Stage: Handover to PM',
  sections: [{ heading: 'Information Checklist', color: '#3F7A4E', level: 2, tables: GROUPS }],
  notes: { title: 'Notes', text: NOTES }, ...over,
});
const book = (sheets: XSheet[], orient: 'portrait' | 'landscape' = 'portrait'): XBook => ({ sheets, orient, header: '050 · 173-Elite Park Avenue' });

test('REQ-055 · 173-Elite Park Avenue 清单:和格式样板逐格一致(文字、合并、列宽、字体、底色、边框、打印设置)', async () => {
  const sample = (await load(readFileSync(SAMPLE))).getWorksheet('Checklist')!;
  const ws = (await load(await buildXlsx(ExcelJS, book([elite()])))).getWorksheet('Checklist')!;

  assert.deepEqual([1, 2, 3, 4].map((c) => ws.getColumn(c).width), [1, 2, 3, 4].map((c) => sample.getColumn(c).width), '列宽 58 / 16 / 26 / 30');
  assert.equal(ws.columnCount, 4, '没勾 Date:没有 Date 栏,不占位');
  assert.deepEqual(merges(ws), merges(sample), '合并区域一样(标题 / 客户行 / 小标题 / 三个分组标题 / 说明)');
  assert.equal(ws.rowCount, sample.rowCount, `行数一样(${sample.rowCount})`);

  for (let r = 1; r <= sample.rowCount; r++) {
    const isNotesText = r === sample.rowCount;   // 样板里说明那格是占位文字
    for (let c = 1; c <= 4; c++) {
      const a = ws.getCell(r, c), b = sample.getCell(r, c);
      const at = `${b.address}`;
      const own = !b.isMerged || b.master.address === b.address;   // 合并区里右边那几格读出来是左上角的值,只比底色边框
      if (!isNotesText && own) assert.equal(a.text, b.text, `${at} 文字`);
      assert.equal(fillOf(a), fillOf(b), `${at} 底色`);
      assert.equal(!!a.border?.bottom, !!b.border?.bottom, `${at} 下边框`);
      assert.equal(a.border?.bottom?.style, b.border?.bottom?.style, `${at} 下边框粗细`);
      if (own && b.value !== null && b.value !== undefined) {
        assert.equal(a.font?.name, 'Arial', `${at} Arial`);
        assert.equal(a.font?.size, b.font?.size, `${at} 字号`);
        assert.equal(!!a.font?.bold, !!b.font?.bold, `${at} 粗体`);
        assert.equal(!!a.font?.italic, !!b.font?.italic, `${at} 斜体`);
        assert.equal(rgb(a.font?.color), rgb(b.font?.color), `${at} 字色`);
        assert.equal(a.alignment?.vertical, b.alignment?.vertical, `${at} 垂直对齐`);
      }
    }
    if (sample.getRow(r).height && r !== sample.rowCount) assert.equal(ws.getRow(r).height, sample.getRow(r).height, `第 ${r} 行行高`);
  }
  assert.equal(ws.getCell('C10').text, 'Pending');
  assert.equal(fillOf(ws.getCell('C10')), 'FFFBEB', 'Pending 浅黄');
  assert.equal(fillOf(ws.getCell('C8')), '', 'Confirmed 不上色');
  assert.equal(ws.getCell('A32').text, NOTES, '最后是公司说明原文');
  assert.ok((ws.getRow(32).height || 0) >= 18, '说明那行按字数撑高');

  const ps = ws.pageSetup;
  assert.equal(ps.paperSize, 9, 'A4');
  assert.equal(ps.orientation, 'portrait');
  assert.equal(ps.fitToPage, true);
  assert.equal(ps.fitToWidth, 1, '一页宽');
  assert.equal(ps.fitToHeight, 0, '高度不限');
  assert.equal(ps.printTitlesRow, '1:2', '标题两行每页重复');
  assert.equal(ws.views[0]?.showGridLines, false, '不显示网格线');
  assert.equal(ws.headerFooter.oddHeader, '&L&8 050 · 173-Elite Park Avenue', '页眉:项目(字号码和编号之间隔开,不会把 050 读成字号)');
  assert.equal(ws.headerFooter.oddFooter, '&L&8 Audax Visuals&R&8 &P / &N', '页脚:Audax Visuals + 页码');
});

test('REQ-055 · 文本一律是字符串:「+65 …」「- 待定」「=…」「@…」、日期都原样,不会变成公式 / 数字 / 日期', async () => {
  const odd = ['+65 9123 4567', '- 待定', '=SUM(A1:A2)', '@foo', '2026-10-14', '0012', '1e5', '-5'];
  const sh = elite({ notes: undefined, sections: [{ heading: 'Information Checklist', level: 2, tables: [{ heads: H, rows: odd.map((v, i) => ({ key: String(i), cells: [{ v: `item ${i}` }, { v }, { v: 'Pending' }, { v }] })) }] }] });
  const buf = await buildXlsx(ExcelJS, book([sh]));
  const ws = (await load(buf)).getWorksheet('Checklist')!;
  odd.forEach((v, i) => {
    const cell = ws.getCell(6 + i, 2);
    assert.equal(cell.type, ExcelJS.ValueType.String, `${v} 是文字`);
    assert.equal(cell.value, v, `${v} 原样`);
  });
  /* 从别处粘贴进来的怪字符:控制符、落单的半个 emoji、U+FFFF —— 去掉,文件照样能打开,其余文字不动 */
  const weird = await buildXlsx(ExcelJS, book([elite({ notes: { title: 'Notes', text: 'a\u000Bb\u0001c \uD83D d\uFFFF e 😀' } })]));
  assert.equal((await load(weird)).getWorksheet('Checklist')!.getCell('A32').text, 'abc  d e 😀', '非法字符去掉,正常的 emoji 留着');
  const zip = await JSZip.loadAsync(buf as ArrayBuffer);
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  assert.ok(!/<f[ >]/.test(xml), '工作表里没有任何公式');
  assert.ok(!/ t="n"[^>]*><v>/.test(xml), '没有写成数字的格子');
});

test('REQ-055 · 取消 Owner:没有负责人栏,分组标题合并宽度跟着变成 3 栏', async () => {
  const H3 = H.filter((h) => h.v !== 'Owner');
  const tables = GROUPS.map((g) => ({ ...g, heads: H3, rows: g.rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== 1) })) }));
  const ws = (await load(await buildXlsx(ExcelJS, book([elite({ sections: [{ heading: 'Information Checklist', color: '#3F7A4E', level: 2, tables }] })])))).getWorksheet('Checklist')!;
  assert.equal(ws.columnCount, 3);
  assert.deepEqual([1, 2, 3].map((c) => ws.getColumn(c).width), [58, 26, 30]);
  assert.ok(merges(ws).includes('A6:C6') && merges(ws).includes('A1:C1'), '分组标题 / 标题都合并到 C');
  assert.deepEqual([1, 2, 3].map((c) => ws.getCell(7, c).text), ['Item', 'Status / Received', 'Remark']);
});

test('REQ-055 · 无分类:没有分组标题行,一个表头接所有项;中文工作表名「清单」', async () => {
  const sh = elite({
    name: '清单', title: '050 · 173-Elite Park Avenue — 信息清单', notes: undefined,
    sections: [{ heading: '信息清单', level: 2, tables: [{ heads: [{ v: '信息项', xw: 58 }, { v: '状态 / 收到内容', xw: 26 }], rows: [
      { key: 'a', cells: [{ v: '总图' }, { v: '未收到', st: { fill: '#fffbeb' } }] },
      { key: 'b', cells: [{ v: '立面' }, { v: '已收到 — 10/12 收到 CAD' }] },
    ] }] }],
  });
  const wb = await load(await buildXlsx(ExcelJS, book([sh], 'landscape')));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['清单']);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell('A4').text, '信息清单');
  assert.equal(rgb(ws.getCell('A4').font.color), '1F2430', '多业务 / 没有单一业务色时小标题用深色');
  assert.deepEqual([ws.getCell('A5').text, ws.getCell('B5').text], ['信息项', '状态 / 收到内容'], '小标题下面直接是表头,没有分组行');
  assert.equal(ws.getCell('B7').text, '已收到 — 10/12 收到 CAD');
  assert.equal(ws.rowCount, 7);
  assert.equal(ws.pageSetup.orientation, 'landscape', '方向跟预览的横向按钮');
  assert.equal(ws.pageSetup.printTitlesRow, '1:2');
});

test('REQ-055 · 封面:标题上面一小块封面信息,空一行再接清单;每页重复的是标题两行', async () => {
  const sh = elite({ cover: { brand: 'AUDAX', kind: 'Checklist', code: '050', name: '173-Elite Park Avenue', client: 'Noel Property Development Pte Ltd', meta: [
    [['Project no.', '050'], ['Client', 'Noel Property Development Pte Ltd']],
    [['Delivery date', '30 Nov 2026'], ['Exported', '14 Oct 2026']],
    [['Services', 'Scale Model'], ['PM', 'Eric']],
  ] } });
  const ws = (await load(await buildXlsx(ExcelJS, book([sh])))).getWorksheet('Checklist')!;
  assert.equal(ws.getCell('A1').text, 'AUDAX   CHECKLIST');
  assert.equal(ws.getCell('A2').text, '050');
  assert.equal(ws.getCell('A3').text, '173-Elite Park Avenue');
  assert.equal(ws.getCell('A5').text, 'Project no.: 050      Client: Noel Property Development Pte Ltd');
  assert.equal(ws.getCell('A7').text, 'Services: Scale Model      PM: Eric');
  assert.equal(ws.getCell('A8').text, '', '封面下面空一行');
  assert.equal(ws.getCell('A9').text, '050 · 173-Elite Park Avenue — Checklist');
  assert.equal(ws.pageSetup.printTitlesRow, '9:10');
});

test('REQ-055 · 排期 + 清单:两张表,清单第一、排期第二;窄的表最后一格并到底;小计 / Sum 行', async () => {
  const sched: XSheet = {
    name: 'Schedule', title: '171-50JHS — Schedule', sub: 'Client: X · Services: CGI, Animation · Stage: Production',
    sections: [
      { heading: 'CGI — Production Schedule', color: '#2C7A7B', level: 2, tables: [{ heads: [{ v: 'Phase / Task', xw: 34 }, { v: 'Dates', xw: 26 }, { v: 'Duration', xw: 14 }], rows: [
        { key: '1', cells: [{ v: 'Modelling' }, { v: '01 Oct 2026 – 07 Oct 2026' }, { v: '1 week' }] },
        { key: 'sub', cells: [{ v: 'Subtotal', span: 2, st: { align: 'right', bold: true } }, { v: '1 weeks', st: { bold: true } }] },
      ] }] },
      { heading: 'Service Scope / Deliverables', level: 3, tables: [{ heads: [{ v: 'Service item', xw: 34 }, { v: 'Detail', xw: 16 }], rows: [{ key: '0', cells: [{ v: 'Aerial' }, { v: '- 3 views' }] }] }] },
      { tight: true, tables: [{ heads: [], rows: [{ key: 'sum', cells: [{ v: 'Sum · Overall duration', span: 2, st: { align: 'right', bold: true, fill: '#f0f2f5' } }, { v: '1 weeks', st: { bold: true, fill: '#f0f2f5' } }] }] }] },
    ],
  };
  const wb = await load(await buildXlsx(ExcelJS, book([elite({ notes: undefined }), sched])));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Checklist', 'Schedule']);
  const ws = wb.getWorksheet('Schedule')!;
  assert.deepEqual([1, 2, 3].map((c) => ws.getColumn(c).width), [34, 26, 14]);
  assert.equal(rgb(ws.getCell('A4').font.color), '2C7A7B', '业务名小标题用业务色');
  assert.equal(ws.getCell('A6').text, 'Modelling');
  assert.ok(merges(ws).includes('A7:B7') && ws.getCell('A7').alignment.horizontal === 'right', '小计跨前两栏、靠右');
  assert.equal(ws.getCell('A9').text, 'Service Scope / Deliverables');
  assert.ok(merges(ws).includes('B10:C10') && merges(ws).includes('B11:C11'), '交付清单只有两栏:最后一栏并到 C');
  assert.equal(ws.getCell('B11').text, '- 3 views');
  assert.equal(ws.getCell('A12').text, 'Sum · Overall duration', 'Sum 紧贴着,不空行');
  assert.equal(fillOf(ws.getCell('C12')), 'F0F2F5');
  assert.equal(ws.pageSetup.fitToWidth, 1);
  assert.equal(ws.views[0]?.showGridLines, false);
});
