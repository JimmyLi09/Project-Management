import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canManageKbPreviews, identityOf } from '@/lib/permissions';
import { getDb, getKbFile } from '@/server/db';
import { getPreview } from '@/server/kbStore';
import { queuePreview, resumePending, sofficeAvailable } from '@/server/kbPreview';
import { inlineType, previewKind } from '@/lib/kbPreview';

/* REQ-061 附件在线预览。登录用户都能看(和下载一样)。
   GET            → PDF / 4 种图片:原文件 inline;Office:转好的 PDF inline。别的类型不 inline(HTML、SVG 一律不)。
   GET ?info=1    → JSON:这是什么文件、预览状态;文本文件把内容带上(阅读器里纯文本显示)。
   POST           → PD / BD 重试转换(失败的、或想重新转)。 */
const MAX_TEXT = 512 * 1024;
const inline = (body: Buffer, type: string, name: string) => new NextResponse(new Uint8Array(body), {
  headers: {
    'Content-Type': type,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Content-Length': String(body.length),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=300',
  },
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ fid: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { fid } = await params;
  const f = getKbFile(fid);
  if (!f) return NextResponse.json({ error: '附件不存在 / File not found' }, { status: 404 });
  resumePending();
  const kind = previewKind(f.name);
  const size = Math.floor((f.data.length * 3) / 4);
  let pv = kind === 'office' ? getPreview(getDb(), fid) : undefined;
  /* 老附件第一次被打开时再转 */
  if (kind === 'office' && !pv && sofficeAvailable()) { queuePreview(fid); pv = getPreview(getDb(), fid); }

  if (req.nextUrl.searchParams.get('info') === '1') {
    const status = kind === 'pdf' || kind === 'image' || kind === 'text' ? 'ready'
      : kind === 'office' ? (pv?.status === 'ok' ? 'ready' : pv?.status === 'failed' ? 'failed' : pv?.status === 'pending' ? 'pending' : !sofficeAvailable() ? 'nosoffice' : 'pending')
      : 'unsupported';
    const text = kind === 'text' ? Buffer.from(f.data, 'base64').subarray(0, MAX_TEXT).toString('utf8') : undefined;
    return NextResponse.json({ id: fid, name: f.name, size, kind, status, pages: pv?.pages ?? null, error: pv?.status === 'failed' ? pv.error : '', text, truncated: kind === 'text' && size > MAX_TEXT });
  }

  if (kind === 'pdf' || kind === 'image') {
    return inline(Buffer.from(f.data, 'base64'), inlineType(f.name)!, f.name);
  }
  if (kind === 'office' && pv?.status === 'ok' && pv.pdf) {
    return inline(Buffer.from(pv.pdf, 'base64'), 'application/pdf', f.name.replace(/\.[^.]+$/, '') + '.pdf');
  }
  return NextResponse.json({ error: '这种文件不能在线看,请下载查看 / This file type cannot be previewed — download it instead', kind }, { status: 415 });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ fid: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canManageKbPreviews(identityOf(user))) return NextResponse.json({ error: '只有 PD / BD 可以重新生成预览 / Only PD / BD can regenerate previews' }, { status: 403 });
  const { fid } = await params;
  const f = getKbFile(fid);
  if (!f) return NextResponse.json({ error: '附件不存在 / File not found' }, { status: 404 });
  if (previewKind(f.name) !== 'office') return NextResponse.json({ error: '只有 Word / Excel / PPT 需要转换 / Only Word / Excel / PowerPoint files are converted' }, { status: 400 });
  if (!sofficeAvailable()) return NextResponse.json({ error: '服务器还没装预览组件(LibreOffice) / The preview component (LibreOffice) is not installed on the server' }, { status: 409 });
  queuePreview(fid, true);
  return NextResponse.json({ ok: true });
}
