import { NextRequest, NextResponse } from 'next/server';
import { identityOf, isFull } from '@/lib/permissions';
import { lastVisionRun } from '@/server/avjudge';
import { getVisionSettings, saveVisionSettings, validateVisionSettings, visionStatus, type VisionSettings } from '@/server/avvision';
import { currentUser } from '@/server/session';

/* 规则设置 › 识别服务 (AV-015 §3) — PD / BD only.
   GET: settings + last run. PUT: save settings. POST { warm? }: 检测状态 —
   service, model, GPU / CPU (warm = load the model first, so the answer is real). */
async function admin() {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  if (!isFull(identityOf(user))) return { error: NextResponse.json({ error: '仅 PD / BD 可管理识别服务' }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const a = await admin();
  if ('error' in a) return a.error;
  return NextResponse.json({ settings: getVisionSettings(), lastRun: lastVisionRun() });
}

export async function PUT(req: NextRequest) {
  const a = await admin();
  if ('error' in a) return a.error;
  const body = (await req.json().catch(() => ({}))) as Partial<VisionSettings>;
  const v = validateVisionSettings(body);
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 });
  return NextResponse.json({ settings: saveVisionSettings(v.settings, a.user.name) });
}

export async function POST(req: NextRequest) {
  const a = await admin();
  if ('error' in a) return a.error;
  const body = (await req.json().catch(() => ({}))) as { warm?: boolean };
  return NextResponse.json({ status: await visionStatus(!!body.warm), lastRun: lastVisionRun() });
}
