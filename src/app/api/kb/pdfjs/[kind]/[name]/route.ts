import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { currentUser } from '@/server/session';

/* REQ-061 阅读器里 pdf.js 要用的字符映射表(cmaps,中日韩文字没嵌字体的 PDF 要用)和标准字体。
   服务器在局域网,不走外网 CDN:直接从项目自带的 node_modules/pdfjs-dist 里读。
   只认这两个目录、只认简单文件名(不带路径),登录后才能拿。 */
const KINDS = new Set(['cmaps', 'standard_fonts']);
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; name: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { kind, name } = await params;
  if (!KINDS.has(kind) || !NAME.test(name) || name.includes('..')) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const file = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', kind, name);
  let buf: Buffer;
  try { buf = fs.readFileSync(file); } catch { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
