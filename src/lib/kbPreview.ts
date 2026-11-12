/* ===== REQ-061 · 附件在线预览:这是什么文件、能不能直接在浏览器里显示 =====
   按扩展名判断(浏览器给的 MIME 不可靠)。只有 PDF 和 4 种图片可以 inline 返回;
   HTML、SVG 一律不 inline(会在平台的源里跑脚本)。Office 由服务器转成 PDF 再看。 */

export type PreviewKind = 'pdf' | 'image' | 'office' | 'text' | 'none';

const ext = (name: string) => (/\.([a-z0-9]+)$/i.exec(name || '')?.[1] || '').toLowerCase();

/* 可以 inline 返回的类型:扩展名 → 固定的 Content-Type(不用存的 MIME) */
export const INLINE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
export const OFFICE_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
export const TEXT_EXT = ['txt', 'md', 'csv'];

export function previewKind(name: string): PreviewKind {
  const e = ext(name);
  if (e === 'pdf') return 'pdf';
  if (INLINE_TYPES[e]) return 'image';
  if (OFFICE_EXT.includes(e)) return 'office';
  if (TEXT_EXT.includes(e)) return 'text';
  return 'none';
}
export const inlineType = (name: string): string | null => INLINE_TYPES[ext(name)] || null;

/* 列表 / 附件行上的小图标 */
export function fileBadge(name: string, isMap?: boolean): { label: string; color: string } {
  if (isMap) return { label: 'MAP', color: '#15202B' };
  const e = ext(name);
  if (e === 'pdf') return { label: 'PDF', color: '#C0392B' };
  if (INLINE_TYPES[e] || e === 'svg') return { label: 'IMG', color: '#2E7D5B' };
  if (e === 'doc' || e === 'docx') return { label: 'DOC', color: '#2B5797' };
  if (e === 'xls' || e === 'xlsx' || e === 'csv') return { label: 'XLS', color: '#1E7145' };
  if (e === 'ppt' || e === 'pptx') return { label: 'PPT', color: '#C4501A' };
  if (e === 'txt' || e === 'md') return { label: 'TXT', color: '#2C4F7C' };
  if (['zip', 'rar', '7z'].includes(e)) return { label: 'ZIP', color: '#8A8478' };
  return { label: (e || 'FILE').slice(0, 4).toUpperCase(), color: '#8A8478' };
}
export const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
