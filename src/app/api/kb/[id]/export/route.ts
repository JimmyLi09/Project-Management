import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { allDocs, oneDoc } from '@/server/kb';
import { markdownToDocx } from '@/server/docx';
import { zip } from '@/server/zip';

/* REQ-035 导出:单篇 Word(.docx,真 OOXML,不是改后缀的 HTML),
   或按分类批量导出(打成一个 zip,每篇一个 .docx)。
   PDF 走浏览器打印 —— 界面上有「打印 / 另存 PDF」,版式跟着屏幕走,
   比在服务端拼一份排版更贴近同事看到的样子。
   导出对所有登录用户开放:需求写明只读角色也能导出。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;

  /* id = "cat:<分类>" 时是按分类批量导出 */
  if (id.startsWith('cat:')) {
    const cat = id.slice(4);
    const docs = allDocs().filter((d) => d.category === cat);
    if (!docs.length) return NextResponse.json({ error: '这个分类下没有文档' }, { status: 404 });
    const used = new Set<string>();
    const buf = zip(docs.map((d) => {
      let name = safeName(d.title) + '.docx';
      let n = 2;
      while (used.has(name)) name = `${safeName(d.title)} (${n++}).docx`;
      used.add(name);
      return { name, data: markdownToDocx(d.title, d.body) };
    }));
    return file(buf, `${safeName(cat)}.zip`, 'application/zip');
  }

  const doc = oneDoc(id);
  if (!doc) return NextResponse.json({ error: '文档不存在' }, { status: 404 });
  const fmt = req.nextUrl.searchParams.get('fmt') || 'docx';
  if (fmt === 'md') return file(Buffer.from('﻿' + doc.body, 'utf8'), safeName(doc.title) + '.md', 'text/markdown; charset=utf-8');
  return file(markdownToDocx(doc.title, doc.body), safeName(doc.title) + '.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

const safeName = (s: string) => (s || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);

function file(buf: Buffer, name: string, mime: string) {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Length': String(buf.length),
    },
  });
}
