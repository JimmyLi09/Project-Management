import { NextRequest, NextResponse } from 'next/server';
import { createUser, getUserByEmail, getUserById, getUserByUsername, listUsers, resetPassword, setUserAvatar, setUserDisabled, updateUser } from '@/server/db';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import type { Role } from '@/lib/types';

const ROLES: Role[] = ['director', 'bd', 'sales', 'pm', 'member', 'viewer'];

/* All signed-in users may list users (needed for PM assignment pickers). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ users: listUsers() });
}

/* Only PD/BD may create accounts. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) {
    return NextResponse.json({ error: '仅 PD/BD 可管理用户' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  const role = body.role as Role;
  const email = String(body.email || '').trim();
  const position = String(body.position || '').trim();
  if (!username || !password || !name || !ROLES.includes(role)) {
    return NextResponse.json({ error: '请完整填写账号/密码/姓名/角色' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email 格式不正确' }, { status: 400 });
  }
  if (getUserByUsername(username)) {
    return NextResponse.json({ error: '账号已存在' }, { status: 409 });
  }
  if (email && getUserByEmail(email)) {
    return NextResponse.json({ error: '该 Email 已被使用' }, { status: 409 });
  }
  /* names are used for assignment matching — keep them unique */
  if (listUsers().some((u) => u.name === name)) {
    return NextResponse.json({ error: '姓名已存在(指派按姓名匹配,需唯一);可加后缀区分' }, { status: 409 });
  }
  const created = createUser(username, password, name, role, email, position);
  return NextResponse.json({ user: created });
}

/* Edit an existing account (PD/BD). A name change propagates to all project
   ownership and task assignments (matching is by name). */
export async function PATCH(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const target = getUserById(id);
  if (!target) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

  /* C6: avatar upload — you may set your own; PD/BD may set anyone's.
     Guarded before the admin gate so ordinary users can update their photo. */
  if (body.action === 'setAvatar') {
    if (id !== user.id && !canAdmin(identityOf(user))) {
      return NextResponse.json({ error: '只能修改自己的头像' }, { status: 403 });
    }
    const avatar = String(body.avatar || '');
    if (avatar) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(avatar)) return NextResponse.json({ error: '无效的图片数据' }, { status: 400 });
      if (avatar.length > 400_000) return NextResponse.json({ error: '头像过大,请压缩后上传' }, { status: 400 });
    }
    const updated = setUserAvatar(id, avatar);
    return NextResponse.json({ user: updated });
  }

  if (!canAdmin(identityOf(user))) {
    return NextResponse.json({ error: '仅 PD/BD 可管理用户' }, { status: 403 });
  }

  /* PD/BD resets someone's password (forces a change on their next login) */
  if (body.action === 'resetPassword') {
    const pw = String(body.newPassword || '');
    if (pw.length < 6) return NextResponse.json({ error: '新密码至少 6 位' }, { status: 400 });
    resetPassword(id, pw);
    return NextResponse.json({ ok: true });
  }
  /* enable / disable an account (departure). Can't disable yourself or the
     last active PD/BD. */
  if (body.action === 'setDisabled') {
    const disabled = !!body.disabled;
    if (disabled && id === user.id) return NextResponse.json({ error: '不能停用你自己的账号' }, { status: 400 });
    if (disabled && (target.role === 'director' || target.role === 'bd')) {
      const activeAdmins = listUsers().filter((u) => (u.role === 'director' || u.role === 'bd') && !u.disabled && u.id !== id);
      if (activeAdmins.length === 0) return NextResponse.json({ error: '不能停用唯一的 PD/BD 账号' }, { status: 400 });
    }
    setUserDisabled(id, disabled);
    return NextResponse.json({ ok: true });
  }

  const fields: { name?: string; email?: string; position?: string; role?: Role; pointCap?: number } = {};
  if (body.pointCap !== undefined) {
    const cap = Number(body.pointCap);
    if (!Number.isFinite(cap) || cap < 0 || cap > 999) return NextResponse.json({ error: '积分上限应为 0–999(0 表示不限)' }, { status: 400 });
    fields.pointCap = cap;
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: '姓名不能为空' }, { status: 400 });
    if (name !== target.name && listUsers().some((u) => u.name === name)) {
      return NextResponse.json({ error: '姓名已存在(需唯一)' }, { status: 409 });
    }
    fields.name = name;
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Email 格式不正确' }, { status: 400 });
    }
    const dup = email ? getUserByEmail(email) : undefined;
    if (dup && dup.id !== id) return NextResponse.json({ error: '该 Email 已被使用' }, { status: 409 });
    fields.email = email;
  }
  if (body.position !== undefined) fields.position = String(body.position).trim();
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) return NextResponse.json({ error: '角色无效' }, { status: 400 });
    /* don't let an admin strip the last PD/BD's own access by accident */
    if (id === user.id && body.role !== 'director' && body.role !== 'bd') {
      const admins = listUsers().filter((u) => u.role === 'director' || u.role === 'bd');
      if (admins.length <= 1) return NextResponse.json({ error: '不能降级唯一的 PD/BD 账号' }, { status: 400 });
    }
    fields.role = body.role as Role;
  }
  const updated = updateUser(id, fields);
  return NextResponse.json({ user: updated });
}
