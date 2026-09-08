/* ===== REQ-035: .docx / .xlsx 的读,和 .docx 的写 =====
   两种格式都是「ZIP 里放几个 XML」,所以只靠 server/zip.ts 就够,不引任何库。
   读:把正文抠成纯文本 / Markdown —— 知识库正文本来就是 Markdown,
       所以段落、标题、表格转成对应的 Markdown 就行,样式一律丢掉。
   写:拼一份最小但合法的 OOXML,Word / WPS / Pages 都打得开。
   .pdf 不在这里 —— 没有解析器就老老实实当附件存,不假装能读。 */
import { unzip, zip } from './zip';

const dec = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&');

export const xmlEsc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  /* XML 1.0 不允许的控制字符 —— 留着会让 Word 报「文件已损坏」 */
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/* ---- 读 .docx ---- */
export function docxToMarkdown(buf: Buffer): string {
  const files = unzip(buf);
  const xml = files.get('word/document.xml');
  if (!xml) throw new Error('这不是一份 Word 文档(缺 word/document.xml)');
  const doc = xml.toString('utf8');

  const out: string[] = [];
  /* 表格和段落在正文里是平级的,按出现顺序走一遍 */
  const blocks = doc.match(/<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g) || [];
  for (const b of blocks) {
    if (b.startsWith('<w:tbl')) { out.push(tableToMd(b)); continue; }
    const text = paraText(b);
    if (!text.trim()) { out.push(''); continue; }
    /* 标题:样式名里带 Heading1 / 标题 1 之类 */
    const st = /<w:pStyle[^>]*w:val="([^"]+)"/.exec(b)?.[1] || '';
    const lvl = /heading\s*([1-6])|标题\s*([1-6])/i.exec(st);
    if (lvl) { out.push('#'.repeat(Number(lvl[1] || lvl[2])) + ' ' + text); continue; }
    /* 列表:段落挂了 numPr。有些文档(包括本平台导出的)直接把「• 」写进正文,
       一并还原成 Markdown 的「- 」,免得往返一次就多个符号。 */
    if (/<w:numPr\b/.test(b)) { out.push('- ' + text.replace(/^[•·]\s*/, '')); continue; }
    if (/^[•·]\s+/.test(text)) { out.push('- ' + text.replace(/^[•·]\s*/, '')); continue; }
    out.push(text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function paraText(p: string): string {
  let s = '';
  for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)) {
    if (m[1] != null) s += dec(m[1]);
    else if (m[0].startsWith('<w:tab')) s += '\t';
    else s += ' ';
  }
  return s.trim();
}

function tableToMd(tbl: string): string {
  const rows = tbl.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
  const grid = rows.map((r) => (r.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [])
    .map((c) => (c.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(paraText).join(' ').replace(/\|/g, '\\|').trim()));
  if (!grid.length) return '';
  const w = Math.max(...grid.map((r) => r.length));
  const line = (cells: string[]) => '| ' + Array.from({ length: w }, (_, i) => cells[i] || '').join(' | ') + ' |';
  return [line(grid[0]), '|' + ' --- |'.repeat(w), ...grid.slice(1).map(line)].join('\n');
}

/* ---- 读 .xlsx:每张表转成一段 Markdown 表格 ---- */
export function xlsxToMarkdown(buf: Buffer): string {
  const files = unzip(buf);
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) {
    for (const m of ss.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => dec(x[1])).join(''));
    }
  }
  const sheets = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  const out: string[] = [];
  sheets.forEach((name, si) => {
    const xml = files.get(name)!.toString('utf8');
    const rows: string[][] = [];
    for (const r of xml.match(/<row\b[\s\S]*?(?:\/>|<\/row>)/g) || []) {
      const cells: string[] = [];
      for (const c of r.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const col = colIndex(/r="([A-Z]+)\d+"/.exec(c)?.[1] || '');
        const t = /t="([^"]+)"/.exec(c)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
        const inline = [...c.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => dec(x[1])).join('');
        let text = inline;
        if (!text && v != null) text = t === 's' ? (shared[Number(v)] ?? '') : dec(v);
        while (cells.length < col) cells.push('');
        cells[col] = text.replace(/\|/g, '\\|').trim();
      }
      if (cells.some((x) => x)) rows.push(cells);
    }
    if (!rows.length) return;
    const w = Math.max(...rows.map((r) => r.length));
    const line = (cells: string[]) => '| ' + Array.from({ length: w }, (_, i) => cells[i] || '').join(' | ') + ' |';
    if (sheets.length > 1) out.push(`## Sheet ${si + 1}`);
    out.push([line(rows[0]), '|' + ' --- |'.repeat(w), ...rows.slice(1).map(line)].join('\n'), '');
  });
  return out.join('\n').trim();
}

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
};

/* ---- 写 .docx:把 Markdown 正文拼成一份最小合法的 OOXML ---- */
export function markdownToDocx(title: string, md: string): Buffer {
  const body: string[] = [para(title, { style: 'Title', bold: true, size: 36 })];
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    /* Markdown 表格 */
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i]));
        i++;
      }
      body.push(table(rows));
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { body.push(para(h[2], { style: `Heading${h[1].length}`, bold: true, size: 32 - h[1].length * 2 })); i++; continue; }
    const li = /^\s*[-*+]\s+(.*)$/.exec(l);
    if (li) { body.push(para('• ' + li[1], { indent: 360 })); i++; continue; }
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(l);
    if (ol) { body.push(para(`${ol[1]}. ${ol[2]}`, { indent: 360 })); i++; continue; }
    body.push(para(l));
    i++;
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ]);
}

const splitRow = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());

function runs(text: string): string {
  /* **粗体** 转成 w:b,其余原样 —— 行内格式只支持这一种,够用且不会拼出坏 XML */
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((x) => x !== '');
  if (!parts.length) return '<w:r><w:t xml:space="preserve"></w:t></w:r>';
  return parts.map((p) => {
    const b = /^\*\*([^*]+)\*\*$/.exec(p);
    const t = xmlEsc(b ? b[1] : p);
    return `<w:r>${b ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
  }).join('');
}

function para(text: string, o: { style?: string; bold?: boolean; size?: number; indent?: number } = {}): string {
  const pr = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
    o.indent ? `<w:ind w:left="${o.indent}"/>` : '',
    o.bold || o.size ? `<w:rPr>${o.bold ? '<w:b/>' : ''}${o.size ? `<w:sz w:val="${o.size}"/>` : ''}</w:rPr>` : '',
  ].join('');
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${runs(text)}</w:p>`;
}

function table(rows: string[][]): string {
  const w = Math.max(...rows.map((r) => r.length));
  const cell = (t: string) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / w)}" w:type="dxa"/></w:tcPr>${para(t)}</w:tc>`;
  const tr = (r: string[]) => `<w:tr>${Array.from({ length: w }, (_, i) => cell(r[i] || '')).join('')}</w:tr>`;
  const borders = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="999999"/>`).join('') + '</w:tblBorders>';
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>${borders}</w:tblPr>${rows.map(tr).join('')}</w:tbl>`;
}
