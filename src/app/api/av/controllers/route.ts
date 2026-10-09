import { NextRequest, NextResponse } from 'next/server';
import { compute } from '@/av/core/compute';
import type { CtrlAdvice, CtrlDevice } from '@/av/core/controller';
import type { LedConfig } from '@/av/core/types';
import { ledAdvice } from '@/server/avctrl';
import { controllerDevices, getInquiry } from '@/server/avdb';
import { denyUnlessVisible, denyAvModule } from '@/server/avguard';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* AV-019 §2.5 · 05「控制与信号源建议」卡。POST { projectId?, cfg, packVersion }
   服务端按同一份参数重算,再按设备库 + 01 的回答选型(和保存方案、技术方案同一套)。
   价格只用来排先后,不发给页面 —— 只告诉它有没有价格(没有 = 待报价)。 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; cfg?: LedConfig; packVersion?: string };
  if (!body.cfg || !body.packVersion) return NextResponse.json({ error: '缺少方案参数' }, { status: 400 });
  let projectId: string | null = null;
  if (body.projectId) {
    const project = getProject(String(body.projectId));
    const denied = denyUnlessVisible(user, project);
    if (denied) return denied;
    projectId = project!.id;
  }
  let r;
  try { r = compute(body.cfg, body.packVersion); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '方案参数无效' }, { status: 400 }); }
  const advice = ledAdvice(projectId, r);
  const strip = (d: CtrlDevice) => { const { price, ...rest } = d; return { ...rest, priced: price != null }; };
  const pick = (p: CtrlAdvice['primary']) => (p ? { ...p, device: strip(p.device) } : null);
  return NextResponse.json({
    advice: advice && {
      ...advice,
      primary: pick(advice.primary),
      alternates: advice.alternates.map((x) => pick(x)!),
      media: advice.media && strip(advice.media),
      pc: advice.pc && strip(advice.pc),
    },
    answers: projectId ? getInquiry(projectId)?.answers ?? {} : {},
    /* 05 手动改选用:设备库里能当控制器 / 播放盒的型号 */
    models: controllerDevices().filter((d) => d.kind === 'player' || d.kind === 'video' || d.kind === 'large').map(strip),
  });
}
