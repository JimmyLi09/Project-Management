/* REQ-055:导出的 Excel(.xlsx)—— 和预览同一份数据、同一个样子。
   这里只管「怎么画」:ExportOverlay 把预览正在用的那几张表(清单 clTable、
   排期 schedTable)原样交过来,不在这里另拼数据 —— 免得两边又对不上。
   格式照 docs/requirements/assets/055-清单Excel格式样板.xlsx:
   标题 16 号粗体 / 客户行灰字 / 小标题下粗线 / 分组浅灰底 / 表头浅底 /
   细边框、顶端对齐、自动换行 / Pending 浅黄 / A4 一页宽 / 不显示网格线 / Arial。
   exceljs 由调用方传进来(浏览器里点按钮时才动态 import,测试里直接 import),
   这个文件只引它的类型,不进首屏包。
   所有格子一律写成字符串:「+65 …」「- 待定」「=…」都原样是文字,不会被当成公式;
   日期也是预览上那串显示文字,不转成 Excel 日期。 */
import type * as ExcelJSNS from 'exceljs';

type ExcelJSMod = typeof ExcelJSNS;

/* 预览和 Excel 共用的一格:预览按它出 <td> 的样式,Excel 按它出字体 / 底色 / 对齐 */
export type XStyle = { align?: 'left' | 'center' | 'right'; bold?: boolean; color?: string; fill?: string; spacing?: boolean; pre?: boolean };
export type XCell = { v: string; span?: number; st?: XStyle };
export type XRow = { key: string; cells: XCell[] };
/* w:预览里 <th> 的宽度(百分比);xw:Excel 的列宽 */
export type XHead = { v: string; w?: string; xw: number };
/* group:有就先出一行合并的分组标题(清单的分类) */
export type XTable = { group?: string; heads: XHead[]; rows: XRow[] };
/* level 2 = 预览里的 h2(业务色 / 深色、下面一道粗线);3 = h3 小标题。
   tight:紧贴上一段,不空行(周数模式最后那行「Sum」) */
export type XSection = { heading?: string; color?: string; level?: 2 | 3; tight?: boolean; tables: XTable[]; empty?: string };
export type XCover = { brand: string; kind: string; code: string; name: string; client: string; meta: [string, string][][] };
export type XSheet = { name: string; title: string; sub: string; cover?: XCover; sections: XSection[]; notes?: { title: string; text: string } };
export type XBook = { sheets: XSheet[]; orient: 'portrait' | 'landscape'; header: string };

const FONT = 'Arial';
const DARK = '#1F2430';
const argb = (hex: string) => {
  let h = hex.replace('#', '').toUpperCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return 'FF' + h;
};
const THIN = { style: 'thin' as const, color: { argb: 'FFD9D4CA' } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const RULE = { bottom: { style: 'medium' as const, color: { argb: argb(DARK) } } };
const solid = (hex: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: argb(hex) } });

type Look = {
  font: Partial<ExcelJSNS.Font>;
  fill?: string;
  border?: Partial<ExcelJSNS.Borders>;
  alignment?: Partial<ExcelJSNS.Alignment>;
};

/* 写进 XML 之前去掉 XML 里不允许的字符,不然 Excel 打开时会提示「修复」。
   exceljs 自己会去掉 0x00-0x1F 里的控制符;落单的代理项(从别处粘贴进来的半个 emoji)和 U+FFFE / U+FFFF 它不管,这里补上 */
function clean(s: string): string {
  if (!/[\uD800-\uDFFF\uFFFE\uFFFF]/.test(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xDC00 && n <= 0xDFFF) { out += s[i] + s[i + 1]; i++; }
      continue;
    }
    if ((c >= 0xDC00 && c <= 0xDFFF) || c === 0xFFFE || c === 0xFFFF) continue;
    out += s[i];
  }
  return out;
}
const cleanValue = (v: string | ExcelJSNS.CellRichTextValue): string | ExcelJSNS.CellRichTextValue =>
  (typeof v === 'string' ? clean(v) : { richText: v.richText.map((t) => ({ ...t, text: clean(t.text) })) });

const tableWidth = (t: XTable) => Math.max(t.heads.length, ...t.rows.map((r) => r.cells.reduce((n, c) => n + (c.span || 1), 0)), 0);

/* 一张表的栏数 = 最宽那张表的栏数;列宽取那张表的。窄一点的表(比如排期只勾了
   「阶段 / 任务」、下面的交付清单有 3 栏)最后一格往右并到底,和预览里 100% 宽的表一样。 */
export function sheetColumns(sh: XSheet): number[] {
  const tables = sh.sections.flatMap((s) => s.tables);
  const widths: number[] = [];
  for (const t of tables) t.heads.forEach((h, i) => { if (widths[i] === undefined) widths[i] = h.xw; });
  const n = Math.max(1, widths.length, ...tables.map(tableWidth));
  for (let i = 0; i < n; i++) if (widths[i] === undefined) widths[i] = i === 0 ? 58 : 16;
  return widths;
}

/* 合并格子(公司说明)Excel 不会自动撑高:按字数估一个行高。中日韩字按两个字宽算。 */
function textHeight(text: string, chars: number): number {
  const per = Math.max(10, chars - 2);
  const lines = text.split('\n').reduce((n, ln) => {
    const w = [...ln].reduce((m, ch) => m + (/[\u2E80-\uFFEF]/.test(ch) ? 2 : 1), 0);
    return n + Math.max(1, Math.ceil(w / per));
  }, 0);
  return Math.max(18, lines * 13 + 6);
}

/* 页眉页脚和 PDF 一样:左上项目,左下 Audax Visuals,右下页码。& 在页眉里是控制符,要写成 &&;
   字号码「&8」后面紧跟数字会被连着读成字号(「&8005 · …」= 8005 号字),所以中间隔一个空格 */
const hf = (s: string) => s.replace(/&/g, '&&');
const SMALL = '&8 ';

function drawSheet(wb: ExcelJSNS.Workbook, sh: XSheet, book: XBook) {
  const ws = wb.addWorksheet(sh.name, {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: book.orient, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddHeader: `&L${SMALL}${hf(book.header)}`, oddFooter: `&L${SMALL}Audax Visuals&R${SMALL}&P / &N` },
  });
  const widths = sheetColumns(sh);
  const N = widths.length;
  ws.columns = widths.map((w) => ({ width: w }));
  const total = widths.reduce((a, b) => a + b, 0);

  let r = 0;
  /* 写一格(span > 1 就合并到右边);合并区里每一格都上同样的底色和边框,不然合并后边框断开 */
  const put = (row: number, col: number, v: string | ExcelJSNS.CellRichTextValue, look: Look, span = 1) => {
    for (let c = col; c < col + span; c++) {
      const cell = ws.getCell(row, c);
      if (c === col) cell.value = cleanValue(v);
      cell.font = { name: FONT, size: 10, ...look.font };
      if (look.fill) cell.fill = solid(look.fill);
      if (look.border) cell.border = look.border;
      if (look.alignment) cell.alignment = look.alignment;
    }
    if (span > 1) ws.mergeCells(row, col, row, col + span - 1);
  };
  const line = (v: string | ExcelJSNS.CellRichTextValue, look: Look, height?: number) => {
    r += 1;
    put(r, 1, v, look, N);
    if (height) ws.getRow(r).height = height;
  };
  const blank = () => { r += 1; };

  /* REQ-021 封面:勾了就在标题上面加一小块(同预览封面),空一行再接正文 */
  if (sh.cover) {
    const c = sh.cover;
    line({ richText: [
      { text: c.brand, font: { name: FONT, size: 14, bold: true, color: { argb: 'FF0B2341' } } },
      ...(c.kind ? [{ text: `   ${c.kind.toUpperCase()}`, font: { name: FONT, size: 10, bold: true, color: { argb: 'FFB9772A' } } }] : []),
    ] }, { font: {}, border: RULE, alignment: { vertical: 'middle' } }, 24);
    if (c.code) line(c.code, { font: { bold: true, color: { argb: 'FFB9772A' } }, alignment: { vertical: 'bottom' } }, 20);
    line(c.name, { font: { size: 18, bold: true, color: { argb: 'FF0B2341' } }, alignment: { vertical: 'middle', wrapText: true } }, 30);
    line(c.client, { font: { size: 11, color: { argb: 'FF555555' } }, alignment: { vertical: 'top', wrapText: true } }, 20);
    for (const pairs of c.meta) {
      line({ richText: pairs.flatMap(([k, v], i) => [
        { text: `${i ? '      ' : ''}${k}: `, font: { name: FONT, size: 10, bold: true, color: { argb: 'FF3B3A36' } } },
        { text: v, font: { name: FONT, size: 10 } },
      ]) }, { font: {}, fill: '#FAF8F4', border: BOX, alignment: { vertical: 'middle', wrapText: true } });
    }
    blank();
  }

  /* 标题 + 客户行,打印时每页重复 */
  line(sh.title, { font: { size: 16, bold: true }, alignment: { vertical: 'middle', wrapText: true } }, 26);
  const titleRow = r;
  line(sh.sub, { font: { color: { argb: 'FF6B6558' } }, alignment: { vertical: 'middle', wrapText: true } });
  ws.pageSetup.printTitlesRow = `${titleRow}:${titleRow + 1}`;
  blank();

  const headColor = sh.sections.find((s) => s.heading && s.level !== 3)?.color || DARK;
  sh.sections.forEach((sec, si) => {
    if (si > 0 && !sec.tight) blank();
    if (sec.heading) {
      if (sec.level === 3) line(sec.heading, { font: { size: 10.5, bold: true, color: { argb: 'FF3B3A36' } }, alignment: { vertical: 'middle', wrapText: true } });
      else line(sec.heading, { font: { size: 12, bold: true, color: { argb: argb(sec.color || DARK) } }, border: RULE, alignment: { vertical: 'middle', wrapText: true } }, 20);
    }
    if (sec.empty) line(sec.empty, { font: { color: { argb: 'FF888888' } } });
    sec.tables.forEach((t, ti) => {
      if (t.group !== undefined) {
        blank();
        line(t.group, { font: { size: 10.5, bold: true }, fill: '#F1EEE8', border: BOX, alignment: { vertical: 'middle', wrapText: true } }, 20);
      } else if (ti > 0) blank();
      if (t.heads.length) {
        r += 1;
        t.heads.forEach((h, i) => {
          const last = i === t.heads.length - 1;
          put(r, i + 1, h.v, { font: { bold: true, color: { argb: 'FF3B3A36' } }, fill: '#FAF8F4', border: BOX, alignment: { vertical: 'middle', wrapText: true } }, last ? N - i : 1);
        });
      }
      for (const row of t.rows) {
        r += 1;
        let col = 1;
        row.cells.forEach((c, i) => {
          const last = i === row.cells.length - 1;
          const span = last ? Math.max(1, N - col + 1) : (c.span || 1);
          const st = c.st || {};
          put(r, col, c.v, {
            font: { bold: st.bold || undefined, color: st.color ? { argb: argb(st.color) } : undefined },
            fill: st.fill, border: BOX,
            alignment: { vertical: 'top', wrapText: true, horizontal: st.align },
          }, span);
          col += span;
        });
      }
    });
  });

  /* REQ-016 公司说明:勾了且有内容才出 —— 小标题 + 原文 */
  if (sh.notes && sh.notes.text.trim()) {
    blank();
    line(sh.notes.title, { font: { size: 11, bold: true, color: { argb: argb(headColor) } }, border: RULE, alignment: { vertical: 'middle', wrapText: true } });
    line(sh.notes.text, { font: { italic: true, color: { argb: 'FF6B6558' } }, alignment: { vertical: 'middle', wrapText: true } }, textHeight(sh.notes.text, total));
  }
}

export async function buildXlsx(X: ExcelJSMod, book: XBook): Promise<ArrayBuffer> {
  const wb = new X.Workbook();
  wb.creator = 'Audax Visuals';
  wb.created = new Date();
  for (const sh of book.sheets) drawSheet(wb, sh, book);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
