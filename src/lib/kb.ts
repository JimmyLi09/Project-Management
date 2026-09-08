/* ===== REQ-035: 知识库 / 运营中心 —— 文档模型与 Markdown 解析 =====

   正文用 **Markdown**,不是富文本 HTML。理由是安全:文档谁都能看、
   有编辑权的人写的内容会渲染在全公司同事的浏览器里,存 HTML 就等于开了一个
   储存型 XSS 的口子。这里把 Markdown 解析成结构化的块,由 React 逐个渲染成
   真实元素 —— 全程没有 dangerouslySetInnerHTML,写进正文的 <script> 只会
   原样显示成文字。

   标题 / 段落 / 列表 / 表格 / 图片 / 引用 / 代码块 / 分隔线都覆盖到了,
   够写 SOP 和培训材料。 */

export type KbCategory = 'role' | 'business' | 'process' | 'policy' | 'training' | 'other';

export const KB_CATEGORIES: [KbCategory, string, string][] = [
  ['role', '按角色', 'By role'],
  ['business', '按业务', 'By business'],
  ['process', '按流程环节', 'By process step'],
  ['policy', '通用制度', 'Company policy'],
  ['training', '培训材料', 'Training'],
  ['other', '其他', 'Other'],
];
export const catName = (c: string, lang: 'zh' | 'en') => {
  const f = KB_CATEGORIES.find((x) => x[0] === c);
  return f ? (lang === 'zh' ? f[1] : f[2]) : c;
};

export interface KbAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface KbDoc {
  id: string;
  title: string;
  titleEn: string;
  category: KbCategory;
  tags: string[];
  body: string;                 // Markdown
  /* REQ-035 内嵌调用:把文档挂到服务类型 / 工作流阶段上,
     在 Job Record、售后工作流那些地方就地列出来。 */
  anchors: { svc: string[]; stage: string[] };
  attachments: KbAttachment[];
  version: number;
  updatedAt: number;
  updatedBy: string;
  createdAt: number;
  createdBy: string;
}

export interface KbVersion {
  version: number;
  title: string;
  body: string;
  summary: string;              // 改动摘要
  at: number;
  by: string;
}

/* ---- Markdown → 块 ---- */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; v: string }
  | { t: 'i'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string };

export type Block =
  | { t: 'h'; level: number; kids: Inline[] }
  | { t: 'p'; kids: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'quote'; kids: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'img'; src: string; alt: string }
  | { t: 'hr' };

export function parseMarkdown(src: string): Block[] {
  const lines = (src || '').replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const l = lines[i];

    if (!l.trim()) { i++; continue; }

    /* 代码块 —— 里面的一切都当字面量,不再解析 */
    const fence = /^```(\w*)\s*$/.exec(l);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push({ t: 'code', lang: fence[1] || '', v: buf.join('\n') });
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { out.push({ t: 'hr' }); i++; continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { out.push({ t: 'h', level: h[1].length, kids: inline(h[2]) }); i++; continue; }

    /* 独占一行的图片 */
    const img = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(l);
    if (img) { out.push({ t: 'img', alt: img[1], src: img[2] }); i++; continue; }

    /* 表格:一行 | … | 后面跟一行分隔线 */
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const head = splitRow(lines[i]).map(inline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]).map(inline));
      out.push({ t: 'table', head, rows });
      continue;
    }

    if (/^\s*>\s?/.test(l)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', kids: inline(buf.join(' ')) });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(l)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*[-*+]\s+/, '')));
      out.push({ t: 'ul', items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*\d+[.)]\s+/, '')));
      out.push({ t: 'ol', items });
      continue;
    }

    /* 普通段落:连续的非空行合成一段 */
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i++]); }
    out.push({ t: 'p', kids: inline(buf.join(' ')) });
  }
  return out;
}

const isBlockStart = (l: string) =>
  /^(#{1,6})\s/.test(l) || /^\s*[-*+]\s/.test(l) || /^\s*\d+[.)]\s/.test(l) ||
  /^\s*>/.test(l) || /^\s*\|/.test(l) || /^```/.test(l) ||
  /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l) || /^\s*!\[[^\]]*\]\([^)\s]+\)\s*$/.test(l);

const splitRow = (l: string) =>
  l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());

/* 行内:**粗** *斜* `代码` [文字](链接)。
   链接只放行 http(s) 与站内 # 锚点 —— javascript: 之类一律降级成纯文字。 */
export function inline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|(?<!\*)\*([^*]+)\*(?!\*)|`([^`]+)`|\[([^\]]*)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) });
    if (m[1] != null) out.push({ t: 'b', v: m[1] });
    else if (m[2] != null) out.push({ t: 'i', v: m[2] });
    else if (m[3] != null) out.push({ t: 'code', v: m[3] });
    else {
      const href = m[5];
      if (safeHref(href)) out.push({ t: 'link', v: m[4] || href, href });
      else out.push({ t: 'text', v: `${m[4]} (${href})` });
    }
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}

export const safeHref = (h: string) => /^(https?:\/\/|\/|#|mailto:)/i.test(h.trim());

/* 正文摘要:给列表页用,去掉 Markdown 记号 */
export function excerpt(body: string, n = 120): string {
  const s = (body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`|_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* 关键词搜索:标题 / 正文 / 标签 都算命中 */
export function matchDoc(d: KbDoc, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (d.title + ' ' + d.titleEn + ' ' + d.tags.join(' ') + ' ' + d.body).toLowerCase().includes(s);
}

/* 两个版本的行级差异 —— 只标出增删,够看清「这版改了什么」 */
export type DiffLine = { kind: ' ' | '+' | '-'; text: string };
export function diffLines(a: string, b: string): DiffLine[] {
  const A = (a || '').split('\n');
  const B = (b || '').split('\n');
  /* 最长公共子序列。文档几百行,O(n²) 完全够用。 */
  const n = A.length, m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ kind: ' ', text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: '-', text: A[i++] }); }
    else { out.push({ kind: '+', text: B[j++] }); }
  }
  while (i < n) out.push({ kind: '-', text: A[i++] });
  while (j < m) out.push({ kind: '+', text: B[j++] });
  return out;
}
