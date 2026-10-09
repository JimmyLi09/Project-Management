import { NextRequest, NextResponse } from 'next/server';
import { compute } from '@/av/core/compute';
import { assertExportable, buildDrawing } from '@/av/core/drawing';
import { proposalDoc } from '@/av/core/proposal';
import type { LedConfig } from '@/av/core/types';
import { canExportLed, identityOf } from '@/lib/permissions';
import { DrawingServiceError, renderFile } from '@/server/avdrawing';
import { currentUser } from '@/server/session';
import { ledAdvice } from '@/server/avctrl';
import { getProject } from '@/server/db';
import { denyUnlessVisible, denyAvModule } from '@/server/avguard';

/* POST { kind: 'dxf' | 'proposal', cfg, packVersion, title, client?, lang? } -> the
   LED layout as DXF, or the technical proposal as Word in Chinese or English. The server recomputes from
   the parameters rather than taking anything from the screen, so the export
   gate (A6: uncalibrated groups, blocking findings) holds for every download. */
const KINDS = {
  dxf: { module: 'avdrawing.dxf', ext: 'dxf', type: 'application/dxf', file: 'led-layout.dxf' },
  proposal: {
    module: 'avdrawing.proposal', ext: 'docx', file: 'led-proposal.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
} as const;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  if (!canExportLed(identityOf(user))) return NextResponse.json({ error: '仅 PM 可导出图纸与方案书' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { kind?: string; cfg?: LedConfig; packVersion?: string; title?: string; client?: string; lang?: string; projectId?: string };
  const kind = body.kind === 'proposal' || body.kind === 'dxf' ? KINDS[body.kind] : null;
  if (!kind) return NextResponse.json({ error: '未知的导出类型' }, { status: 400 });
  if (!body.cfg || !body.packVersion) return NextResponse.json({ error: '缺少方案参数' }, { status: 400 });

  let result;
  try {
    result = compute(body.cfg, body.packVersion);
    assertExportable(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '方案参数无效' }, { status: 400 });
  }
  /* AV-019:技术方案「控制与信号源」按这个项目 01 的回答 + 设备库选型;没给项目(试算)就按「待确认」 */
  let projectId: string | null = null;
  if (body.projectId) {
    const project = getProject(String(body.projectId));
    const denied = denyUnlessVisible(user, project);
    if (denied) return denied;
    projectId = project!.id;
  }
  const lang = body.lang === 'en' ? 'en' : 'zh';
  const title = String(body.title || '').trim() || (kind.ext === 'dxf' ? 'LED' : lang === 'en' ? 'Untitled project' : '未命名项目');
  const payload = kind.ext === 'dxf'
    ? buildDrawing(result, { project: title })
    : proposalDoc(result, {
      title, client: String(body.client || '').trim(), lang,
      date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' }),
      ctrl: ledAdvice(projectId, result),
    });
  if (!payload) return NextResponse.json({ error: '排布无解，不能导出' }, { status: 400 });
  try {
    const bytes = await renderFile(kind.module, payload, kind.ext);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { 'Content-Type': kind.type, 'Content-Disposition': `attachment; filename="${kind.file}"` },
    });
  } catch (e) {
    const status = e instanceof DrawingServiceError ? 422 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : '导出失败' }, { status });
  }
}
