import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canEditKb, identityOf } from '@/lib/permissions';
import { attachFile, createDoc, MAX_FILE } from '@/server/kb';
import { docxToMarkdown, xlsxToMarkdown } from '@/server/docx';

/* REQ-035 导入:上传已有文件生成文档。
   每个文件两条路 ——
   parse  解析为正文:.docx / .xlsx / .md / .txt / .csv
   attach 作为附件:其余一律走这条(.pdf、图片、以及解析失败的)。
   .pdf 没有解析器就老实当附件,不假装能读出正文。 */
const TEXT = /\.(md|markdown|txt|csv|log)$/i;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditKb(identityOf(user))) return NextResponse.json({ error: '仅 总监 / BD / PM 可导入' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: '上传格式不对' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '没有收到文件' }, { status: 400 });
  if (file.size > MAX_FILE) return NextResponse.json({ error: '文件超过 8MB' }, { status: 400 });

  const mode = String(form.get('mode') || 'parse');       // parse | attach
  const category = String(form.get('category') || 'other');
  const title = String(form.get('title') || file.name.replace(/\.[^.]+$/, '')).slice(0, 200);
  const buf = Buffer.from(await file.arrayBuffer());

  let body = '';
  let note = '';
  if (mode === 'parse') {
    try {
      if (/\.docx$/i.test(file.name)) body = docxToMarkdown(buf);
      else if (/\.xlsx$/i.test(file.name)) body = xlsxToMarkdown(buf);
      else if (TEXT.test(file.name)) body = buf.toString('utf8').slice(0, 400_000);
      else note = `「${file.name}」这个格式解析不了正文,已作为附件存入。`;
    } catch (e) {
      note = `「${file.name}」解析失败(${(e as Error).message}),已作为附件存入。`;
      body = '';
    }
  }

  /* 文件名当标题往往很难看(sample、扫描件_final2)。正文第一行要是个一级标题,
     用它更贴切;用户在表单里自己填了标题就以填的为准。 */
  const lines = body.split('\n');
  const hi = lines.findIndex((l) => l.trim());
  const h1 = hi >= 0 && hi < 3 ? /^\s*#\s+(.+)$/.exec(lines[hi])?.[1]?.trim() : undefined;
  let useTitle = title;
  if (!form.get('title') && h1) {
    useTitle = h1;
    /* 标题提上去了就把正文里那一行去掉,否则页面上标题会显示两遍 */
    body = lines.slice(hi + 1).join('\n').replace(/^\n+/, '');
  }

  const doc = createDoc({ title: useTitle, category, body, summary: `导入自 ${file.name}` }, user.name);
  /* 解析不出正文、或用户就选了「作为附件」—— 原件一律留一份,不丢东西 */
  const withFile = (!body || mode === 'attach')
    ? attachFile(doc.id, file.name, file.type || 'application/octet-stream', buf, user.name)
    : doc;
  return NextResponse.json({ doc: withFile, note });
}
