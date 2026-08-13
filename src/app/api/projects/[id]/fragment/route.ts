import { NextRequest, NextResponse } from 'next/server';
import { appendAudit, getProject, getUserTemplate, saveProjectCAS } from '@/server/db';
import { currentUser } from '@/server/session';
import { canEdit, identityOf } from '@/lib/permissions';
import { applyFragment, matchPackage, extractFragment, type Fragment, type FragmentKind } from '@/server/fragments';

type Params = { params: Promise<{ id: string }> };

/* REQ-012: write a schedule/checklist fragment into one package of this project.
   Source is either another project (sourceId) or a saved template (templateId) —
   both are read server-side, so the client never supplies the payload.
   Body: { pkg, kind: 'schedule'|'checklist', mode: 'replace'|'append',
           sourceId? , templateId? } */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const p = getProject(id);
  if (!p) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  if (!canEdit(identityOf(user), p)) return NextResponse.json({ error: '无编辑权限' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    pkg?: number; kind?: string; mode?: string; sourceId?: string; templateId?: number; baseVersion?: number;
  } | null;
  const kind = String(body?.kind || '') as FragmentKind;
  const mode = (String(body?.mode || 'replace') === 'append' ? 'append' : 'replace') as 'replace' | 'append';
  if (kind !== 'schedule' && kind !== 'checklist') return NextResponse.json({ error: '无效的内容类型' }, { status: 400 });

  const pkgIdx = Number(body?.pkg ?? 0);
  const dest = p.packages[pkgIdx];
  if (!dest) return NextResponse.json({ error: '无效的服务包' }, { status: 400 });

  /* strict optimistic lock, same contract as PATCH /api/projects/:id */
  const expectedVersion = p.version || 0;
  if (typeof body?.baseVersion === 'number' && body.baseVersion !== expectedVersion) {
    return NextResponse.json({ error: '此项目刚被他人修改,已为你刷新,请核对后重新操作。', stale: true }, { status: 409 });
  }

  let frag: Fragment | null = null;
  let label = '';
  if (body?.templateId) {
    const tpl = getUserTemplate(Number(body.templateId));
    if (!tpl) return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    if (tpl.type !== kind) return NextResponse.json({ error: '模板类型不匹配' }, { status: 400 });
    try { frag = JSON.parse(tpl.payload) as Fragment; } catch { return NextResponse.json({ error: '模板内容损坏' }, { status: 400 }); }
    label = `模板「${tpl.name}」`;
  } else if (body?.sourceId) {
    const src = getProject(String(body.sourceId));
    if (!src) return NextResponse.json({ error: '源项目不存在' }, { status: 404 });
    /* 目标包在本项目同类业务里排第几 —— 用它去源项目找对应的那一份 */
    const ordinal = p.packages.filter((x, i) => x.svc === dest.svc && i < pkgIdx).length;
    const srcPkg = matchPackage(src, dest.svc, ordinal);
    if (!srcPkg) return NextResponse.json({ error: '源项目没有可用的服务包' }, { status: 400 });
    frag = extractFragment(srcPkg, kind, src.schedStyle);
    label = `项目「${src.name}」`;
  } else {
    return NextResponse.json({ error: '请指定来源项目或模板' }, { status: 400 });
  }

  applyFragment(dest, kind, frag, mode);
  const now = Date.now();
  const text = `${mode === 'replace' ? '覆盖' : '追加'}导入${kind === 'schedule' ? '排期' : '信息清单'} ← ${label}`;
  p.log = [{ at: now, by: user.name, text }, ...(p.log || [])].slice(0, 200);

  const v = saveProjectCAS(p, expectedVersion);
  if (v == null) return NextResponse.json({ error: '此项目刚被他人修改,已为你刷新,请核对后重新操作。', stale: true }, { status: 409 });
  appendAudit(p.id, [{ at: now, by: user.name, text }]);
  return NextResponse.json({ project: p });
}
