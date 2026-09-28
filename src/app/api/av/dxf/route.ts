import { NextRequest, NextResponse } from 'next/server';
import { compute } from '@/av/core/compute';
import { assertExportable, buildDrawing } from '@/av/core/drawing';
import type { LedConfig } from '@/av/core/types';
import { canExportLed, identityOf } from '@/lib/permissions';
import { DrawingServiceError, renderDxf } from '@/server/avdrawing';
import { currentUser } from '@/server/session';

/* POST { cfg, packVersion, title } -> the LED layout as a DXF file.
   The server recomputes from the parameters rather than taking a drawing from
   the screen, so the export gate (A6: uncalibrated groups, blocking findings)
   holds for every download. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canExportLed(identityOf(user))) return NextResponse.json({ error: '仅 PM 可导出图纸' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { cfg?: LedConfig; packVersion?: string; title?: string };
  if (!body.cfg || !body.packVersion) return NextResponse.json({ error: '缺少方案参数' }, { status: 400 });

  let result;
  try {
    result = compute(body.cfg, body.packVersion);
    assertExportable(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '方案参数无效' }, { status: 400 });
  }
  const title = String(body.title || '').trim() || 'LED';
  const drawing = buildDrawing(result, { project: title });
  if (!drawing) return NextResponse.json({ error: '排布无解，不能出图' }, { status: 400 });
  try {
    const dxf = await renderDxf(drawing);
    return new NextResponse(new Uint8Array(dxf), {
      headers: { 'Content-Type': 'application/dxf', 'Content-Disposition': 'attachment; filename="led-layout.dxf"' },
    });
  } catch (e) {
    const status = e instanceof DrawingServiceError ? 422 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : '出图失败' }, { status });
  }
}
