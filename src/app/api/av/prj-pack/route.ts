import { NextRequest, NextResponse } from 'next/server';
import { getPrjGroupsPack, PRJ_CONST_LABEL, PRJ_RELEASE_PACK, type PrjConstKey } from '@/av/core/prj/rulepack';
import { canConfirmRules, identityOf } from '@/lib/permissions';
import { latestPrjPack, prjAllConfirmed, prjConfirmState, publishPrjRelease, setPrjConfirm } from '@/server/avdb';
import { currentUser } from '@/server/session';

/* AV-020 §3.7 · 投影常数确认页
   GET  → prj@0.2 的每个常数(值、来源、依据)、谁在什么时候确认的、prj@1.0 发布了没有
   POST { key, confirmed } → PD 确认 / 取消确认一个常数;{ publish: true } → 全部确认后发布 prj@1.0。
   发布以后不能在这里撤回(新项目已经绑 1.0),回退见上线操作单。 */
function state(canConfirm: boolean) {
  const s = prjConfirmState();
  const pack = getPrjGroupsPack(s.pack);
  const constants = (Object.keys(PRJ_CONST_LABEL) as PrjConstKey[]).map((k) => {
    const c = pack.constants[k];
    return { key: k, ...PRJ_CONST_LABEL[k], value: c.value, src: c.src, note: c.note, noteEn: c.noteEn, confirmed: s.confirms[k] ?? null };
  });
  return { pack: s.pack, release: s.release, releasePack: PRJ_RELEASE_PACK, latest: latestPrjPack(), constants, allConfirmed: prjAllConfirmed(s), canConfirm };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json(state(canConfirmRules(identityOf(user))));
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { key?: string; confirmed?: boolean; publish?: boolean; lang?: string };
  const T = (zh: string, en: string) => (body.lang === 'en' ? en : zh);
  if (!canConfirmRules(identityOf(user))) return NextResponse.json({ error: T('只有 PD 可以确认常数、发布规则包', 'Only the PD can confirm constants and publish the rule pack') }, { status: 403 });
  if (prjConfirmState().release) return NextResponse.json({ error: T(`${PRJ_RELEASE_PACK} 已发布，常数不再改确认状态`, `${PRJ_RELEASE_PACK} is published; confirmations are frozen`) }, { status: 400 });
  if (body.publish) {
    if (!prjAllConfirmed(prjConfirmState())) return NextResponse.json({ error: T('还有常数没确认，不能发布', 'Some constants are not confirmed yet') }, { status: 400 });
    publishPrjRelease(user.name);
    console.log(`[AV-020] ${user.name} 发布投影规则包 ${PRJ_RELEASE_PACK}`);
    return NextResponse.json(state(true));
  }
  if (!body.key || !(body.key in PRJ_CONST_LABEL)) return NextResponse.json({ error: T('未知的常数', 'Unknown constant') }, { status: 400 });
  setPrjConfirm(body.key as PrjConstKey, body.confirmed !== false, user.name);
  return NextResponse.json(state(true));
}
