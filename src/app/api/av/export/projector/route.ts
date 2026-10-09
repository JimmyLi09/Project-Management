import { NextRequest, NextResponse } from 'next/server';
import { computePrjGroups, isGroupsConfig, type PrjGroupsConfig } from '@/av/core/prj/groups';
import { prjProposalDoc } from '@/av/core/prj/proposal';
import { isGroupsPack } from '@/av/core/prj/rulepack';
import { buildPrjDxf } from '@/av/core/prj/views';
import { canExportLed, identityOf } from '@/lib/permissions';
import { DrawingServiceError, renderFile } from '@/server/avdrawing';
import { currentUser } from '@/server/session';
import { denyAvModule } from '@/server/avguard';
import { prjLibrary } from '@/server/avdb';

/* AV-020 §3.4:POST { kind: 'dxf' | 'proposal', cfg, packVersion, title?, client?, lang? } -> 投影的
   DXF(平面 / 立面 / 剖面分图层)或技术方案 Word(中 / 英)。和 LED 一样由服务端按参数重算,
   有红项就不出文件;常数没确认完时照样出,文件上标「部分常数待校准」(§3.7)。 */
const KINDS = {
  dxf: { module: 'avdrawing.dxf', ext: 'dxf', type: 'application/dxf', file: 'projection.dxf' },
  proposal: {
    module: 'avdrawing.proposal', ext: 'docx', file: 'projection-proposal.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
} as const;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { kind?: string; cfg?: PrjGroupsConfig; packVersion?: string; title?: string; client?: string; lang?: string };
  const lang = body.lang === 'en' ? 'en' : 'zh';
  const T = (zh: string, en: string) => (lang === 'en' ? en : zh);
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: T('未登录', 'Not signed in') }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  if (!canExportLed(identityOf(user))) return NextResponse.json({ error: T('仅 PM 可导出图纸与方案书', 'Only PMs can export drawings and proposals') }, { status: 403 });
  const kind = body.kind === 'proposal' || body.kind === 'dxf' ? KINDS[body.kind] : null;
  if (!kind) return NextResponse.json({ error: T('未知的导出类型', 'Unknown export type') }, { status: 400 });
  if (!isGroupsConfig(body.cfg) || !isGroupsPack(body.packVersion)) {
    return NextResponse.json({ error: T('缺少方案参数，或规则包不支持导出（prj@0.1-draft 请先升级）', 'Missing inputs, or the rule pack cannot export (upgrade prj@0.1-draft first)') }, { status: 400 });
  }
  let result;
  try {
    result = computePrjGroups(body.cfg, body.packVersion!, prjLibrary());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : T('方案参数无效', 'Invalid inputs') }, { status: 400 });
  }
  const reds = result.findings.filter((f) => f.severity === 'block');
  if (!result.ok || !result.exportable) {
    const why = reds.map((f) => `${f.code} ${lang === 'en' ? f.messageEn ?? f.message : f.message}`).join('\n');
    return NextResponse.json({ error: `${T('有红项，不能导出正式文件：', 'Red findings — cannot export:')}\n${why}` }, { status: 400 });
  }
  const title = String(body.title || '').trim() || T('未命名项目', 'Untitled project');
  const payload = kind.ext === 'dxf'
    ? buildPrjDxf(result, { project: title, lang })
    : prjProposalDoc(result, {
      title, client: String(body.client || '').trim(), lang,
      date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' }),
    });
  if (!payload) return NextResponse.json({ error: T('无法出图', 'Nothing to export') }, { status: 400 });
  try {
    const bytes = await renderFile(kind.module, payload, kind.ext);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { 'Content-Type': kind.type, 'Content-Disposition': `attachment; filename="${kind.file}"` },
    });
  } catch (e) {
    const status = e instanceof DrawingServiceError ? 422 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : T('导出失败', 'Export failed') }, { status });
  }
}
