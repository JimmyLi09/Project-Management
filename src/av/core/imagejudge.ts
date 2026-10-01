/* ===== AV-015 图片智能判读 · 确定性部分 =====
   The local vision model only *looks* and *reads*: what kind of picture this is,
   and which numbers are written on it. Everything after that is here, and is
   deterministic (AV-001 §1):

   - unit normalisation and range checks on what the model read ("2400m m" → 2400 mm)
   - the C-grade confidence caps (≤ 0.75 overall, ≤ 0.4 for anything estimated)
   - 「还缺什么」— a fixed rule table, never the model
   - arc length from chord + rise / radius
   - pitch candidates from the price library under LED-VD-01
   - similar cases from the case library
   - the gate before 05, and the values handed to it

   Framework-free, like the rest of src/av/core, so it is tested on its own and
   runs the same on the server and in the screen. */

import type { DrawingElement } from './handoff.ts';
import type { LedCurve, Maintain } from './types.ts';

/* ── what the model is asked to return (Ollama `format`, JSON Schema) ── */

export type ImageKind = 'drawing' | 'drawing_screenshot' | 'site_photo' | 'render' | 'screenshot' | 'unrelated';
export type Intent = 'site' | 'ref' | 'other';
export type Shape = 'flat' | 'concave' | 'convex' | 'corner' | 'irregular' | 'unknown';
export type Mount = 'recessed' | 'wall' | 'floor' | 'hanging' | 'truss' | 'unknown';
export type Env = 'indoor' | 'outdoor' | 'unknown';
export type Engine = 'vision' | 'ocr' | 'manual';

export interface RawReading {
  text: string;          // exactly as written on the picture, '' when not visible
  confidence: number;
  source: string;        // where on the picture, in words
  estimated: boolean;    // inferred from proportions rather than read
}

export interface JudgeRaw {
  image_type: ImageKind;
  image_type_confidence: number;
  environment: Env;
  space: string;
  description: string;
  intent_guess: Intent;
  intent_reason: string;
  shape: Shape;
  shape_confidence: number;
  shape_source: string;
  mount: Mount;
  mount_confidence: number;
  mount_source: string;
  width: RawReading;
  height: RawReading;
  mount_height: RawReading;
  control_distance: RawReading;
  power_distance: RawReading;
  viewing_distance: RawReading;
  pitch: RawReading;
  aspect_ratio: RawReading;
  other_text: string[];
}

const READING = {
  type: 'object',
  properties: {
    text: { type: 'string' }, confidence: { type: 'number' }, source: { type: 'string' }, estimated: { type: 'boolean' },
  },
  required: ['text', 'confidence', 'source', 'estimated'],
} as const;

const READINGS = ['width', 'height', 'mount_height', 'control_distance', 'power_distance', 'viewing_distance', 'pitch', 'aspect_ratio'] as const;

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    image_type: { type: 'string', enum: ['drawing', 'drawing_screenshot', 'site_photo', 'render', 'screenshot', 'unrelated'] },
    image_type_confidence: { type: 'number' },
    environment: { type: 'string', enum: ['indoor', 'outdoor', 'unknown'] },
    space: { type: 'string' },
    description: { type: 'string' },
    intent_guess: { type: 'string', enum: ['site', 'ref', 'other'] },
    intent_reason: { type: 'string' },
    shape: { type: 'string', enum: ['flat', 'concave', 'convex', 'corner', 'irregular', 'unknown'] },
    shape_confidence: { type: 'number' },
    shape_source: { type: 'string' },
    mount: { type: 'string', enum: ['recessed', 'wall', 'floor', 'hanging', 'truss', 'unknown'] },
    mount_confidence: { type: 'number' },
    mount_source: { type: 'string' },
    ...Object.fromEntries(READINGS.map((k) => [k, READING])),
    other_text: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'image_type', 'image_type_confidence', 'environment', 'space', 'description', 'intent_guess', 'intent_reason',
    'shape', 'shape_confidence', 'shape_source', 'mount', 'mount_confidence', 'mount_source', ...READINGS, 'other_text',
  ],
} as const;

/* The reading rules go into the prompt *and* are enforced below — the prompt is
   a request, the code is the guarantee. */
export const JUDGE_PROMPT = `你是 LED 显示屏工程公司的读图助手。看这张图片，只做两件事：判断它是什么；读出图上**写着**的信息。严格按 JSON 输出。

规则：
1. image_type：drawing=施工图/CAD 出图；drawing_screenshot=施工图的截图或手机拍的图纸；site_photo=现场照片（可带手写或画上去的标注）；render=效果图/概念图；screenshot=聊天、表格、网页等其他截图；unrelated=与 LED 屏无关。
2. 数字只能来自图上看得见的标注或文字，原样抄进 text（例如 "2400m m"、"5760"、"FFL+900"、"APPROX. 12m"），不要换算单位，不要补单位。看不见就 text 留空 ""、confidence 0。不许编造。
3. 如果某个值是按比例推算的（例如按门高推屏离地高度），estimated=true，text 写推算出的数并带单位，source 写清按什么推算。效果图没有标注时，宽和高必须留空。
4. width=屏宽，height=屏高，mount_height=屏底离地高度，control_distance=到控制室距离，power_distance=到配电箱/强电井距离，viewing_distance=观众最近观看距离，pitch=图上写的点间距或型号（如 "P1.86"），aspect_ratio=屏的长宽比（如 "16:9"，可按画面估）。
5. shape：flat 平面、concave 内凹弧、convex 外凸弧、corner 转角、irregular 异形。mount：recessed 嵌墙、wall 挂墙、floor 落地、hanging 吊装、truss 桁架。
6. intent_guess：site=要施工的现场；ref=客户想要类似效果的参考；other=只是资料。
7. source 用中文一句话说明依据，例如「读自图上手写标注 2400m m」「看图判断：屏面向内弯」。space、description、intent_reason 用中文。
8. confidence 取 0 到 1。other_text 列出图上其他可能有用的文字（如 "DB AT CORRIDOR"）。
9. 图上同一条标注只能填进一个字段：一个数字已经当作屏宽或屏高，就不要再填到离地高度、距离等其他字段（那些字段留空）。
10. shape、mount 是看图判断的，shape_source、mount_source 写「看图判断：……」说明看到了什么，不要引用尺寸标注。`;

/* ── normalised result ── */

export type ItemKey = DrawingElement | 'shape' | 'mount' | 'pitch_hint' | 'ratio';

export interface JudgeItem {
  key: ItemKey;
  value: number | string | null;   // numbers in `unit`; shape / mount as their code; pitch as mm
  unit: 'mm' | 'm' | '';
  confidence: number;
  raw: string;                     // what was written on the picture
  source: string;
  estimated: boolean;
  dropped?: string;                // a reading we discarded, and why
}

export interface OcrNumber { text: string; mm: number | null; confidence: number }

export interface JudgeResult {
  engine: Engine;
  kind: ImageKind | null;
  kindConfidence: number;
  env: Env;
  space: string;
  description: string;
  intentGuess: Intent | null;
  intentWhy: string;
  items: JudgeItem[];
  otherText: string[];
  ocr: OcrNumber[];                // the OCR fallback: numbers for a person to assign
  notes: string[];
}

/* §4.2 rule 5 / AV-002: a scan is never measured, so no reading may claim more. */
export const C_GRADE_CAP = 0.75;
export const ESTIMATE_CAP = 0.4;

export const MM_ELEMENTS: DrawingElement[] = ['led_opening_w', 'led_opening_h', 'led_mount_h'];
export const M_ELEMENTS: DrawingElement[] = ['led_ctrl_dist', 'led_pwr_dist', 'led_view_min'];
export const ELEMENTS: DrawingElement[] = ['led_opening_w', 'led_opening_h', 'led_mount_h', 'led_view_min', 'led_ctrl_dist', 'led_pwr_dist'];

/* Plausible ranges; a reading outside is dropped with a note, never clamped. */
export const RANGE: Record<DrawingElement, [number, number]> = {
  led_opening_w: [200, 50_000],
  led_opening_h: [200, 50_000],
  led_mount_h: [0, 30_000],
  led_view_min: [0.3, 200],
  led_ctrl_dist: [0.5, 500],
  led_pwr_dist: [0.5, 500],
};

const RAW_KEY: Record<DrawingElement, keyof JudgeRaw> = {
  led_opening_w: 'width', led_opening_h: 'height', led_mount_h: 'mount_height',
  led_view_min: 'viewing_distance', led_ctrl_dist: 'control_distance', led_pwr_dist: 'power_distance',
};

const clamp01 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const round = (x: number, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; };
const str = (x: unknown, max = 300) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

/* A length as written → the element's unit. Handles "2400m m", "2400 mm",
   "2,400", "2.4m", "2.4 米", "240cm", "FFL+900", "APPROX. 12m", "约12米".
   Without a unit, a length element reads a big number as mm and a small one as
   m; a distance element the other way round. Returns null when there is no
   number to read. */
export function parseLength(text: string, want: 'mm' | 'm'): number | null {
  if (!text) return null;
  const s = text
    .replace(/[，,](?=\d{3}(?!\d))/g, '')                  // thousands separators
    .replace(/[\s ]+/g, ' ')
    .replace(/m\s+m\b/gi, 'mm')                           // "2400m m"
    .replace(/毫\s*米/g, 'mm').replace(/厘\s*米/g, 'cm').replace(/公\s*尺|米/g, 'm');
  const m = /(\d+(?:\.\d+)?)\s*(mm|cm|m)?(?![a-z])/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || '').toLowerCase();
  let mm: number;
  if (unit === 'mm') mm = n;
  else if (unit === 'cm') mm = n * 10;
  else if (unit === 'm') mm = n * 1000;
  else mm = want === 'mm' ? (n < 100 ? n * 1000 : n) : (n > 200 ? n : n * 1000);
  return want === 'mm' ? round(mm) : round(mm / 1000, 2);
}

/* "P1.86", "LED-01 P1.86", "1.86mm", "pitch 2.5" → mm; null otherwise. */
export function parsePitch(text: string): number | null {
  if (!text) return null;
  const m = /P\s*(\d+(?:\.\d+)?)/i.exec(text) || /(\d+(?:\.\d+)?)\s*mm/i.exec(text) || /^\s*(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const p = Number(m[1]);
  return p >= 0.3 && p <= 40 ? p : null;
}

/* "16:9", "16 : 9", "1.78" → w / h. */
export function parseRatio(text: string): number | null {
  if (!text) return null;
  const m = /(\d+(?:\.\d+)?)\s*[:：xX×/]\s*(\d+(?:\.\d+)?)/.exec(text);
  if (m) { const a = Number(m[1]), b = Number(m[2]); return a > 0 && b > 0 ? a / b : null; }
  const n = parseFloat(text);
  return n > 0.1 && n < 20 ? n : null;
}

const KIND_OK = new Set<ImageKind>(['drawing', 'drawing_screenshot', 'site_photo', 'render', 'screenshot', 'unrelated']);
const SHAPE_OK = new Set<Shape>(['flat', 'concave', 'convex', 'corner', 'irregular', 'unknown']);
const MOUNT_OK = new Set<Mount>(['recessed', 'wall', 'floor', 'hanging', 'truss', 'unknown']);
const INTENT_OK = new Set<Intent>(['site', 'ref', 'other']);

const reading = (raw: Partial<JudgeRaw>, k: keyof JudgeRaw): RawReading => {
  const r = (raw[k] ?? {}) as Partial<RawReading>;
  return { text: str(r.text, 80), confidence: clamp01(r.confidence), source: str(r.source, 160), estimated: r.estimated === true };
};

/* Kinds whose sizes must come from a written annotation with a unit: a render
   has no dimensions, so a bare number read off one is more likely invented. */
const NEEDS_UNIT = new Set<ImageKind>(['render', 'screenshot', 'unrelated']);
const HAS_UNIT = /(mm|cm|\dm\b|m\s*m|米)/i;

/* ── one annotation, one field (1001) ──
   The 0930 photo has two hand-written numbers. The model filled the screen height
   with "2000mm" — and the mounting height with the same "2000mm". An annotation
   on the picture says one thing, so it may fill one field: the readings that
   reuse it are blanked (with the reason) and the field goes to 「还缺什么」.
   Estimates are worked out, not read, so they never collide. */

/* The annotation as written, so that copies of it compare equal:
   "2000mm" = "2000" = "２，０００ ｍｍ" = "2,000 mm" → "2000"; "FFL+2000" stays "ffl+2000"
   (a different annotation); "2.5m" stays "2.5m". Empty when there is no number. */
export function annotationKey(text: string): string {
  const t = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/(\d)[,，](?=\d{3}(?!\d))/g, '$1');
  if (!/\d/.test(t)) return '';
  return t.replace(/(\d)mm$/, '$1');
}

const NAME: Record<DrawingElement, string> = {
  led_opening_w: '屏宽', led_opening_h: '屏高', led_mount_h: '离地高度',
  led_view_min: '最近观看距离', led_ctrl_dist: '控制室距离', led_pwr_dist: '配电箱距离',
};
/* What a field's source or annotation would say if it really were that field */
const HINT: Record<DrawingElement, RegExp> = {
  led_opening_w: /宽|\bw\b|width/i,
  led_opening_h: /(?<!标)高(?!度)|\bh\b|height/i,
  led_mount_h: /离地|地面|底|标高|ffl|aff|mount|elev/i,
  led_view_min: /观看|视距|view/i,
  led_ctrl_dist: /控制|ctrl|control/i,
  led_pwr_dist: /配电|电箱|强电|\bdb\b|power/i,
};
const SIZE: DrawingElement[] = ['led_opening_w', 'led_opening_h'];

function dedupeAnnotations(items: JudgeItem[]) {
  const groups = new Map<string, JudgeItem[]>();
  for (const i of items) {
    if (i.value === null || i.estimated) continue;
    const k = annotationKey(i.raw);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    /* the best match: width / height first, then the field the source wording points to, then the surer reading */
    const own = (i: JudgeItem) => HINT[i.key as DrawingElement].test(`${i.source} ${i.raw}`);
    const score = (i: JudgeItem) => (SIZE.includes(i.key as DrawingElement) ? 4 : 0) + (own(i) ? 2 : 0) + i.confidence;
    const keep = [...g].sort((a, b) => score(b) - score(a) || ELEMENTS.indexOf(a.key as DrawingElement) - ELEMENTS.indexOf(b.key as DrawingElement))[0];
    for (const i of g) {
      if (i === keep) continue;
      /* a square screen: width and height may well carry the same number */
      if (SIZE.includes(i.key as DrawingElement) && SIZE.includes(keep.key as DrawingElement)) continue;
      /* its own source names it ("离地 2000"、"配电箱旁 5m"): a second annotation with the same number, not a copy */
      if (own(i)) continue;
      i.dropped = `图上「${i.raw}」已用作${NAME[keep.key as DrawingElement]}，同一条标注不重复填；${NAME[i.key as DrawingElement]}请另行补充`;
      i.value = null;
      i.confidence = 0;
    }
  }
}

/* shape / mount sources: always 「看图判断」; the model's words only when they describe what it saw, not a dimension */
function lookedAt(src: unknown): string {
  const t = str(src, 160).replace(/^看图判断[:：]?\s*/, '');
  return t && !/\d/.test(t) && !/[「」『』“”‘’"'《》]/.test(t) && !/标注|尺寸|dimension/i.test(t) ? `看图判断：${t}` : '看图判断';
}

/* The model's JSON → what the screen shows. Everything the model said is a
   candidate; this decides which candidates are even admissible. */
export function normalise(input: unknown): JudgeResult {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<JudgeRaw>;
  const kind = KIND_OK.has(raw.image_type as ImageKind) ? raw.image_type as ImageKind : null;
  const notes: string[] = [];
  const items: JudgeItem[] = [];

  for (const el of ELEMENTS) {
    const r = reading(raw, RAW_KEY[el]);
    const unit = MM_ELEMENTS.includes(el) ? 'mm' : 'm';
    const base: JudgeItem = { key: el, value: null, unit, confidence: 0, raw: r.text, source: r.source, estimated: r.estimated };
    const v = parseLength(r.text, unit);
    if (v === null) { items.push({ ...base, raw: '', source: r.text ? r.source : '' }); continue; }
    const sizeEl = el === 'led_opening_w' || el === 'led_opening_h';
    if (sizeEl && kind === 'render' && r.estimated) {
      items.push({ ...base, dropped: `效果图上没有尺寸，模型估的 ${r.text} 不采用` });
      continue;
    }
    if (sizeEl && kind && NEEDS_UNIT.has(kind) && !r.estimated && !HAS_UNIT.test(r.text)) {
      items.push({ ...base, dropped: `「${r.text}」没有单位，这类图片上的裸数字不当作尺寸` });
      continue;
    }
    const [lo, hi] = RANGE[el];
    if (v < lo || v > hi) {
      items.push({ ...base, dropped: `读到「${r.text}」= ${v} ${unit}，超出合理范围 ${lo}–${hi.toLocaleString('en-US')} ${unit}，已丢弃` });
      continue;
    }
    const cap = r.estimated ? ESTIMATE_CAP : C_GRADE_CAP;
    items.push({ ...base, value: v, confidence: round(Math.min(r.confidence, cap), 2) });
  }

  dedupeAnnotations(items);

  /* shape and mounting always get a row: when the model could not tell, a person picks.
     They are judged by looking, never read off a dimension — the source says so (1001) */
  const shape = SHAPE_OK.has(raw.shape as Shape) && raw.shape !== 'unknown' ? raw.shape as Shape : null;
  items.push({ key: 'shape', value: shape, unit: '', confidence: shape ? round(Math.min(clamp01(raw.shape_confidence), C_GRADE_CAP), 2) : 0,
    raw: '', source: shape ? lookedAt(raw.shape_source) : '', estimated: false });
  const mount = MOUNT_OK.has(raw.mount as Mount) && raw.mount !== 'unknown' ? raw.mount as Mount : null;
  items.push({ key: 'mount', value: mount, unit: '', confidence: mount ? round(Math.min(clamp01(raw.mount_confidence), C_GRADE_CAP), 2) : 0,
    raw: '', source: mount ? lookedAt(raw.mount_source) : '', estimated: false });
  const p = reading(raw, 'pitch');
  const pitch = p.estimated ? null : parsePitch(p.text);   // a pitch is read, never guessed
  if (pitch !== null) {
    items.push({ key: 'pitch_hint', value: pitch, unit: 'mm', confidence: round(Math.min(p.confidence, C_GRADE_CAP), 2),
      raw: p.text, source: p.source, estimated: false });
  }
  const ar = reading(raw, 'aspect_ratio');
  const ratio = parseRatio(ar.text);
  if (ratio !== null) {
    items.push({ key: 'ratio', value: ar.text, unit: '', confidence: round(Math.min(ar.confidence, ESTIMATE_CAP), 2),
      raw: ar.text, source: ar.source, estimated: true });
  }

  if (items.some((i) => i.dropped)) notes.push('部分读数不合规，已丢弃，见各项说明。');
  return {
    engine: 'vision', kind, kindConfidence: round(Math.min(clamp01(raw.image_type_confidence), C_GRADE_CAP), 2),
    env: raw.environment === 'indoor' || raw.environment === 'outdoor' ? raw.environment : 'unknown',
    space: str(raw.space, 60), description: str(raw.description, 200),
    intentGuess: INTENT_OK.has(raw.intent_guess as Intent) ? raw.intent_guess as Intent : null,
    intentWhy: str(raw.intent_reason, 200),
    items, otherText: Array.isArray(raw.other_text) ? raw.other_text.map((t) => str(t, 120)).filter(Boolean).slice(0, 12) : [],
    ocr: [], notes,
  };
}

/* The fallbacks: no model, or no model and no OCR. Every element is a blank for
   a person to fill; OCR numbers, when there are any, are offered to assign. */
export function manualResult(engine: 'ocr' | 'manual', ocr: OcrNumber[] = []): JudgeResult {
  return {
    engine, kind: null, kindConfidence: 0, env: 'unknown', space: '', description: '', intentGuess: null, intentWhy: '',
    items: [
      ...ELEMENTS.map((el): JudgeItem => ({ key: el, value: null, unit: MM_ELEMENTS.includes(el) ? 'mm' : 'm', confidence: 0, raw: '', source: '', estimated: false })),
      ...(['shape', 'mount'] as const).map((key): JudgeItem => ({ key, value: null, unit: '', confidence: 0, raw: '', source: '', estimated: false })),
    ],
    otherText: [], ocr, notes: [],
  };
}

/* OCR text boxes → the numbers on the picture that could be a size. */
export function ocrNumbers(boxes: { text: string; confidence: number }[]): OcrNumber[] {
  const out: OcrNumber[] = [];
  for (const b of boxes) {
    if (!/\d/.test(b.text)) continue;
    /* a bare number on a drawing is millimetres; only a written unit says otherwise */
    const bare = /(\d+(?:[.,]\d+)*)/.exec(b.text);
    const mm = HAS_UNIT.test(b.text) ? parseLength(b.text, 'mm') : bare ? Number(bare[1].replace(/,/g, '')) : null;
    out.push({ text: b.text.slice(0, 40), mm: mm !== null && mm >= RANGE.led_opening_w[0] && mm <= RANGE.led_opening_w[1] ? mm : null,
      confidence: round(Math.min(clamp01(b.confidence), C_GRADE_CAP), 2) });
  }
  return out.slice(0, 20);
}

/* ── the person's side ── */

export interface JudgeReview {
  intent: Intent | null;
  confirmed: Partial<Record<ItemKey, boolean>>;
  values: Partial<Record<ItemKey, number | string | null>>;   // corrections, same unit as the item
  answers: Partial<Record<AskAnswerKey, string>>;
  pitch: number | null;
}

export type AskAnswerKey = 'arc' | 'radKind' | 'rad' | 'view' | 'mountH' | 'maint' | 'ctrl' | 'pwr' | 'size_w' | 'size_h' | 'snapW' | 'snapH';

export const emptyReview = (): JudgeReview => ({ intent: null, confirmed: {}, values: {}, answers: {}, pitch: null });

export const itemOf = (r: JudgeResult, k: ItemKey) => r.items.find((i) => i.key === k);

/* What the person settled on for an item: their correction, else the reading. */
export function finalOf(r: JudgeResult, rv: JudgeReview, k: ItemKey): number | string | null {
  if (k in rv.values) return rv.values[k] ?? null;
  return itemOf(r, k)?.value ?? null;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const isCurved = (shape: unknown) => shape === 'concave' || shape === 'convex';

/* Items a person must confirm one by one (C-grade rule): every reading that has
   a value, and the shape (it decides the 06 待询价 line). */
export function toConfirm(r: JudgeResult): ItemKey[] {
  return r.items.filter((i) => i.value !== null && i.key !== 'ratio').map((i) => i.key);
}

/* ── 还缺什么: a fixed rule table (§4.3) ── */

export interface Ask {
  id: 'arc' | 'rad' | 'view' | 'mount_h' | 'maint' | 'dist' | 'size' | 'dxf';
  zh: string; en: string;
  whyZh: string; whyEn: string;
}

export function asks(r: JudgeResult, rv: JudgeReview): Ask[] {
  const out: Ask[] = [];
  const shape = finalOf(r, rv, 'shape');
  const has = (k: DrawingElement) => finalOf(r, rv, k) !== null;
  if (r.kind === 'drawing_screenshot' || r.kind === 'drawing') {
    out.push({ id: 'dxf',
      zh: '这是施工图的截图 / 照片。截图读出的尺寸只能当参考，请向甲方要 DXF / PDF 原件。',
      en: 'This is a screenshot / photo of a drawing. Ask the client for the DXF / PDF original.',
      whyZh: 'DXF 可直接读取坐标，比截图准确得多。', whyEn: 'A DXF is read from its coordinates, far more accurate than a screenshot.' });
  }
  const sizeFromPicture = rv.intent !== 'ref';
  if (!sizeFromPicture || !has('led_opening_w') || !has('led_opening_h')) {
    const ratio = itemOf(r, 'ratio')?.value;
    out.push({ id: 'size',
      zh: rv.intent === 'ref' ? '我们现场的屏宽和屏高是多少？（参考图只参考形状和效果）' : '屏的宽和高大概多少？',
      en: rv.intent === 'ref' ? 'Width and height at our site? (the reference picture only shows the look)' : 'Screen width and height?',
      whyZh: ratio ? `给出其中一边，可按图上约 ${ratio} 的比例推出另一边（推出的值标「按比例推算」）。` : '05 排箱体要用。',
      whyEn: ratio ? `Give one side and the other follows from the ~${ratio} ratio (marked as derived).` : '05 needs it to lay out cabinets.' });
  }
  if (isCurved(shape)) {
    out.push({ id: 'arc',
      zh: '标注的宽是沿弧面量的（弧长），还是两端的直线距离（弦长）？', en: 'Is the width measured along the curve (arc) or straight across (chord)?',
      whyZh: '弧长决定箱体数量；弦长还要再给弧高或半径才能换算。', whyEn: 'Arc length sets the cabinet count; a chord needs a rise or radius too.' });
    out.push({ id: 'rad',
      zh: '弧的半径或弧高（矢高）是多少？', en: 'Radius or rise (sagitta) of the curve?',
      whyZh: '决定用弧形箱体还是柔性模组，以及结构怎么做。', whyEn: 'Decides curved cabinets vs flexible modules, and the structure.' });
  }
  /* an estimate is not an answer: the pitch rests on this number, so a guessed one is asked about too */
  const guessed = (k: DrawingElement) => !!itemOf(r, k)?.estimated && !(k in rv.values);
  if (!has('led_view_min') || (guessed('led_view_min') && !rv.answers.view)) {
    out.push({ id: 'view', zh: '观众离屏最近大概几米？', en: 'Nearest viewing distance (m)?',
      whyZh: '点间距按规则 LED-VD-01「点间距(mm) ≤ 最近观看距离(m)」选。', whyEn: 'Pitch is chosen by LED-VD-01: pitch (mm) ≤ viewing distance (m).' });
  }
  /* 离地高度:没读到、或者读到的那条标注已经用作屏宽 / 屏高(见 dedupeAnnotations)时问;
     参考图上的是别人现场的,和屏宽屏高一样要问我们自己的 */
  if (rv.intent !== 'other' && (rv.intent === 'ref' || !has('led_mount_h'))) {
    const dropped = !!itemOf(r, 'led_mount_h')?.dropped;
    out.push({ id: 'mount_h',
      zh: rv.intent === 'ref' ? '我们现场屏底离地面多高？（参考图上的不算）' : '屏底离地面多高？',
      en: rv.intent === 'ref' ? 'Height of the screen bottom above the floor at our site? (not the reference picture)' : 'How high is the bottom of the screen above the floor?',
      whyZh: dropped ? '图上那条标注已经用作屏的尺寸，离地高度要另外确认。' : '决定支架 / 钢结构做法和观看角度。',
      whyEn: dropped ? 'That annotation is already the screen size; the mounting height needs confirming separately.' : 'Sets the bracket / steelwork and the viewing angle.' });
  }
  if (finalOf(r, rv, 'mount') === 'recessed') {
    out.push({ id: 'maint', zh: '屏后面有没有检修空间？', en: 'Is there service access behind the screen?',
      whyZh: '嵌墙安装多半只能前维护，影响箱体型号。', whyEn: 'Recessed screens are usually front-serviced, which changes the cabinet.' });
  }
  if (!has('led_ctrl_dist') || !has('led_pwr_dist')) {
    out.push({ id: 'dist', zh: '控制室、配电箱离屏大概多远？', en: 'Distance to the control room and the power board?',
      whyZh: '决定信号线、电源线长度；不填就在 05 标「待补」。', whyEn: 'Sets the cable runs; left blank, 05 marks it as to be filled.' });
  }
  return out;
}

/* ── arc length (§4.4): chord c with rise s, or with radius R ── */

export function arcFromRise(chord: number, rise: number): { arc: number; radius: number } | null {
  if (!(chord > 0 && rise > 0) || rise > chord / 2) return null;   // more than a half circle is not a screen
  const R = (chord * chord / 4 + rise * rise) / (2 * rise);
  return { arc: R * 2 * Math.asin(chord / (2 * R)), radius: R };
}

export function arcFromRadius(chord: number, radius: number): { arc: number; rise: number } | null {
  if (!(chord > 0 && radius > 0) || chord > 2 * radius) return null;
  const theta = 2 * Math.asin(chord / (2 * radius));
  return { arc: radius * theta, rise: radius - Math.sqrt(radius * radius - chord * chord / 4) };
}

export type CurveInfo = LedCurve;

/* The width 05 lays cabinets along, with how it was obtained. */
export function curveOf(r: JudgeResult, rv: JudgeReview, width: number | null): { curve: CurveInfo | null; error: string | null } {
  const shape = finalOf(r, rv, 'shape');
  if (!isCurved(shape) || width === null) return { curve: null, error: null };
  const a = rv.answers.arc;
  const given: LedCurve['given'] | null = a === 'arc' || a === 'chord' || a === 'unknown' ? a : null;
  if (!given) return { curve: null, error: '弧形屏：先回答宽是弧长还是弦长' };
  const rad = num(rv.answers.rad);
  const kind = rv.answers.radKind === 'rise' ? 'rise' : 'radius';
  const base = { shape: shape as 'concave' | 'convex', given, width };
  if (given === 'chord') {
    if (rad === null) return { curve: null, error: '弦长要换算成弧长：请填半径或弧高' };
    if (kind === 'rise') {
      const a = arcFromRise(width, rad);
      if (!a) return { curve: null, error: '弧高须大于 0 且不超过弦长的一半' };
      return { curve: { ...base, arc: Math.round(a.arc), radius: Math.round(a.radius), rise: rad }, error: null };
    }
    const a = arcFromRadius(width, rad);
    if (!a) return { curve: null, error: '半径须不小于弦长的一半' };
    return { curve: { ...base, arc: Math.round(a.arc), radius: rad, rise: Math.round(a.rise) }, error: null };
  }
  return { curve: { ...base, arc: width, radius: kind === 'radius' ? rad : null, rise: kind === 'rise' ? rad : null }, error: null };
}

/* ── pitch candidates (§4.4) — the kernel's choice, not the model's ── */

export interface PitchOption {
  pitch: number;
  label: string;           // as printed in the library, e.g. "P1.86"
  items: number;           // how many library entries carry it
  rank: number;            // 0 = cheapest per ㎡; ties and unpriced entries go by pitch
}

export interface PriceLike { id: number; category: string; categoryLabel: string; model: string; pitch: string; unit: string; costPrice: number | null; active: boolean }

/* Direct-view categories a fixed screen can be built from. Hologram, transparent
   and poster products are different products, not candidates for a wall. */
const DIRECT_VIEW = /^(hard_smd|gob|cob|soft|smd|outdoor.*|.*_outdoor)$/i;
const OUTDOOR = /outdoor|户外|室外/i;

export function pitchOptions(items: PriceLike[], env: Env): PitchOption[] {
  const firstNum = (s: string) => { const m = /(\d+(?:\.\d+)?)/.exec(s); return m ? Number(m[1]) : null; };
  const pool = items.filter((i) => i.active && i.unit === '㎡' && DIRECT_VIEW.test(i.category)
    && (env === 'outdoor') === OUTDOOR.test(`${i.category} ${i.categoryLabel} ${i.model}`));
  const by = new Map<number, { label: string; n: number; cost: number | null }>();
  for (const i of pool) {
    const p = firstNum(i.pitch);
    if (p === null) continue;
    const cur = by.get(p) ?? { label: /^P/i.test(i.pitch) ? i.pitch : `P${p}`, n: 0, cost: null };
    cur.n += 1;
    if (i.costPrice !== null && (cur.cost === null || i.costPrice < cur.cost)) cur.cost = i.costPrice;
    by.set(p, cur);
  }
  const rows = [...by.entries()].map(([pitch, v]) => ({ pitch, label: v.label, items: v.n, cost: v.cost }));
  /* cheapest first; without a price, a coarser pitch is the cheaper guess */
  const order = [...rows].sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity) || b.pitch - a.pitch);
  return rows.sort((a, b) => a.pitch - b.pitch)
    .map((r) => ({ pitch: r.pitch, label: r.label, items: r.items, rank: order.indexOf(r) }));
}

/* LED-VD-01 (rules.ts): the nearest viewing distance in m must be ≥ the pitch in mm. */
export const meetsVd01 = (pitch: number, viewM: number | null) => viewM === null || pitch <= viewM + 1e-9;

/* Default: a pitch written on the drawing wins; otherwise the cheapest that
   satisfies LED-VD-01. No viewing distance, no default. */
export function defaultPitch(options: PitchOption[], viewM: number | null, drawn: number | null): number | null {
  if (drawn !== null) return drawn;
  if (viewM === null) return null;
  const ok = options.filter((o) => meetsVd01(o.pitch, viewM)).sort((a, b) => a.rank - b.rank);
  return ok[0]?.pitch ?? null;
}

/* ── similar cases (§4.4): area within ±50 %, then pitch, then shape ── */

export interface CaseLike { name: string; client: string | null; widthMm: number | null; heightMm: number | null; sqm: number | null; pitch: number | null; product: string | null; remarks: string | null; status: string }

export const CURVE_WORDS = /curve|curved|arc|弧|曲/i;

export function similarCases<T extends CaseLike>(cases: T[], q: { sqm: number | null; pitch: number | null; curved: boolean }, n = 3): T[] {
  const areaOf = (c: T) => c.sqm ?? (c.widthMm && c.heightMm ? (c.widthMm * c.heightMm) / 1e6 : null);
  const scored = cases.map((c) => {
    const a = areaOf(c);
    if (q.sqm !== null && (a === null || a < q.sqm * 0.5 || a > q.sqm * 1.5)) return null;
    const curved = CURVE_WORDS.test(`${c.name} ${c.product ?? ''} ${c.remarks ?? ''}`);
    let score = 0;
    if (q.curved && curved) score += 3;
    if (!q.curved && !curved) score += 1;
    if (q.pitch !== null && c.pitch !== null) score += Math.max(0, 2 - Math.abs(c.pitch - q.pitch));
    if (q.sqm !== null && a !== null) score += 1 - Math.abs(a - q.sqm) / q.sqm;
    return { c, score };
  }).filter((x): x is { c: T; score: number } => x !== null);
  return scored.sort((a, b) => b.score - a.score).slice(0, n).map((x) => x.c);
}

/* ── module rounding: 05 tiles whole modules, so offer the neighbours ── */

export function snapOptions(v: number, mod: number): number[] {
  if (!(v > 0 && mod > 0)) return [];
  const lo = Math.floor(v / mod) * mod;
  const hi = Math.ceil(v / mod) * mod;
  return lo === hi ? [] : [lo, hi].filter((x) => x >= mod);
}

/* ── the gate and the hand-off (§4.5) ── */

export interface Settled {
  width: number | null;        // as annotated / entered
  height: number | null;       // what 05 lays out (module-rounded when the person chose so)
  tileWidth: number | null;    // what 05 lays out along: the arc length for a curved screen, module-rounded when chosen
  curve: CurveInfo | null;
  view: number | null;
  ctrl: number | null;
  pwr: number | null;
  mountH: number | null;
  maintain: Maintain | null;
  pitch: number | null;
  derived: Partial<Record<'width' | 'height', string>>;   // how a value was derived, e.g. from the ratio
  snap: { w: number[]; h: number[] };                     // whole-module neighbours when not already whole
}

const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/* `suggested` is the kernel's default pitch (defaultPitch); a person's pick wins. */
export function settle(r: JudgeResult, rv: JudgeReview, suggested: number | null = null, mod: [number, number] | null = null): Settled & { errors: string[] } {
  const errors: string[] = [];
  const derived: Settled['derived'] = {};
  const fromPicture = rv.intent !== 'ref';
  let w = fromPicture ? numOrNull(finalOf(r, rv, 'led_opening_w')) : null;
  let h = fromPicture ? numOrNull(finalOf(r, rv, 'led_opening_h')) : null;
  const sw = num(rv.answers.size_w), sh = num(rv.answers.size_h);
  if (sw !== null) w = sw;
  if (sh !== null) h = sh;
  const ratio = parseRatio(String(itemOf(r, 'ratio')?.value ?? ''));
  if (ratio && w !== null && h === null) { h = Math.round(w / ratio); derived.height = `按比例推算（${itemOf(r, 'ratio')!.value}）`; }
  if (ratio && h !== null && w === null) { w = Math.round(h * ratio); derived.width = `按比例推算（${itemOf(r, 'ratio')!.value}）`; }
  const { curve, error } = curveOf(r, rv, w);
  if (error) errors.push(error);
  const answerM = (k: AskAnswerKey) => num(rv.answers[k]);
  const view = answerM('view') ?? numOrNull(finalOf(r, rv, 'led_view_min'));
  const maintain = rv.answers.maint === 'rear' || rv.answers.maint === 'front' ? rv.answers.maint : null;
  const drawn = numOrNull(finalOf(r, rv, 'pitch_hint'));
  /* 05 tiles whole modules (LED-FIT-01): offer the neighbours, apply the one picked */
  let tile = curve ? curve.arc : w;
  const snap = { w: tile !== null && mod ? snapOptions(tile, mod[0]) : [], h: h !== null && mod ? snapOptions(h, mod[1]) : [] };
  const sw2 = num(rv.answers.snapW), sh2 = num(rv.answers.snapH);
  if (tile !== null && sw2 !== null && snap.w.includes(sw2)) { derived.width = `按模组 ${mod![0]} mm 取整：${tile} → ${sw2}`; tile = sw2; snap.w = []; }
  if (h !== null && sh2 !== null && snap.h.includes(sh2)) { derived.height = `按模组 ${mod![1]} mm 取整：${h} → ${sh2}`; h = sh2; snap.h = []; }
  if (snap.w.length) errors.push(`屏宽 ${tile} mm 不是模组 ${mod![0]} mm 的整数倍：请选 ${snap.w.join(' 或 ')}（05 按整模组排箱体）`);
  if (snap.h.length) errors.push(`屏高 ${h} mm 不是模组 ${mod![1]} mm 的整数倍：请选 ${snap.h.join(' 或 ')}`);
  return {
    width: w, height: h, tileWidth: tile, curve, snap,
    view, ctrl: answerM('ctrl') ?? numOrNull(finalOf(r, rv, 'led_ctrl_dist')),
    pwr: answerM('pwr') ?? numOrNull(finalOf(r, rv, 'led_pwr_dist')),
    mountH: mountHOf(r, rv),
    maintain, pitch: rv.pitch ?? suggested ?? drawn, derived, errors,
  };
}

/* 离地高度:表里改过的值优先(人最后动的是它),其次图上读到的,再次「还缺什么」里的回答;
   参考图上读到的不算我们的。0 是合法的(落地屏) */
function mountHOf(r: JudgeResult, rv: JudgeReview): number | null {
  const ans = rv.answers.mountH;
  const answered = ans !== undefined && ans.trim() !== '' && Number(ans) >= 0 ? Number(ans) : null;
  if ('led_mount_h' in rv.values) return numOrNull(rv.values.led_mount_h ?? null) ?? answered;
  if (rv.intent === 'ref') return answered;
  return numOrNull(itemOf(r, 'led_mount_h')?.value ?? null) ?? answered;
}

export interface GateState { ok: boolean; pending: number; reasons: string[] }

export function gate(r: JudgeResult, rv: JudgeReview, suggested: number | null = null, mod: [number, number] | null = null): GateState {
  const reasons: string[] = [];
  const pending = toConfirm(r).filter((k) => !rv.confirmed[k]).length;
  if (pending) reasons.push(`还有 ${pending} 项未确认`);
  if (!rv.intent) reasons.push('请确认这张图的用途');
  else if (rv.intent === 'other') reasons.push('用途选了「只是资料」，不进入方案');
  const s = settle(r, rv, suggested, mod);
  reasons.push(...s.errors);
  if (s.width === null || s.height === null) reasons.push('还没有屏宽和屏高');
  if (s.pitch === null) reasons.push('请选一个点间距');
  /* 选完点间距又改了观看距离:人选的那一个可能已经不满足 LED-VD-01 了(图上写明的只告警) */
  const drawnP = numOrNull(finalOf(r, rv, 'pitch_hint'));
  if (rv.pitch !== null && s.view !== null && !meetsVd01(rv.pitch, s.view) && !(drawnP !== null && Math.abs(drawnP - rv.pitch) < 1e-9)) {
    reasons.push(`所选 P${rv.pitch} 不满足 LED-VD-01（最近观看距离 ${s.view} m），请重选点间距`);
  }
  return { ok: reasons.length === 0, pending, reasons };
}
