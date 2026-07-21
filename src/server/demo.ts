/* ===== Demo data for test deployments =====
   Seeded when the database has no projects and AUDAX_DEMO=1 (or on Vercel,
   where the /tmp database is ephemeral and would otherwise start empty). */

import type Database from 'better-sqlite3';
import { newProject } from '@/lib/project';
import type { Project } from '@/lib/types';
import { hashPassword } from './db';

const day = 86400000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

export function shouldSeedDemo(): boolean {
  return process.env.AUDAX_DEMO === '1' || !!process.env.VERCEL;
}

export function seedDemo(d: Database.Database) {
  const users: [string, string, string, string][] = [
    ['zhangsan', 'audax123', '张三', 'pm'],
    ['priya', 'audax123', 'Priya Nair', 'pm'],
    ['kevin', 'audax123', 'Kevin Lee', 'member'],
    ['viewer', 'audax123', '只读 Viewer', 'viewer'],
  ];
  const insUser = d.prepare('INSERT OR IGNORE INTO users (username, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?)');
  users.forEach(([u, pw, n, r]) => insUser.run(u, hashPassword(pw), n, r, Date.now()));

  const insProj = d.prepare('INSERT INTO projects (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)');
  const put = (p: Project) => insProj.run(p.id, JSON.stringify(p), p.created, Date.now());
  const log = (p: Project, by: string, text: string) => p.log.unshift({ at: Date.now(), by, text });

  /* 1 — mid-production, on track */
  const p1 = newProject({
    name: 'Dunearn Road Condo', client: 'XYZ Developer', services: ['cgi', 'ani'],
    owners: ['张三'], difficulty: 'hard', start: iso(-21), delivery: iso(120), buffer: 7,
    architect: 'ADDP Architects', landscape: 'Tinderbox',
  });
  p1.packages[0].schedule[0].status = 'done';
  p1.packages[0].schedule[1].status = 'done';
  p1.packages[0].schedule[2].status = 'wip';
  p1.packages[0].schedule[2].assignee = 'Kevin Lee';
  p1.packages[0].checklist[0].items.forEach((it, i) => { if (i < 4) { it.status = 'confirmed'; it.date = iso(-15); } });
  p1.update.done = '完成建模与两轮角度草图';
  p1.update.nextNodes = '锁定角度,进入灯光材质';
  p1.update.needDirector = 'Confirm final angle set — for print production';
  p1.update.by = '张三'; p1.update.at = Date.now() - 2 * day;
  log(p1, '张三', '搭建 3D 建筑模型: wip→done');
  log(p1, '总监 PD', '创建项目');
  put(p1);

  /* 2 — client review, healthy */
  const p2 = newProject({
    name: 'The Continuum', client: 'Hoi Hup Realty', services: ['cgi', 'saleskit'],
    owners: ['Priya Nair'], difficulty: 'medium', start: iso(-50), delivery: iso(22), buffer: 3,
  });
  p2.packages[0].schedule.forEach((r, i) => { if (i <= 2) r.status = 'done'; });
  p2.packages[0].schedule[3].status = 'wip';
  p2.packages[1].schedule[0].status = 'done';
  p2.packages[1].schedule[1].status = 'wip';
  p2.packages[1].schedule[1].assignee = 'Kevin Lee';
  p2.update.done = '灯光材质第二轮已发客户';
  p2.update.clientPending = '客户确认修订范围 sign-off';
  p2.update.by = 'Priya Nair'; p2.update.at = Date.now() - 1 * day;
  put(p2);

  /* 3 — overdue + blocked + awaiting decision */
  const p3 = newProject({
    name: 'Lentor Mansion', client: 'GuocoLand', services: ['scale', 'led'],
    owners: ['张三'], difficulty: 'complex', start: iso(-90), delivery: iso(1), buffer: 0,
    mainContractor: 'Qingjian',
  });
  p3.packages[0].schedule.forEach((r, i) => { if (i <= 5) r.status = 'done'; });
  p3.packages[0].schedule[6].status = 'block';
  p3.packages[0].schedule[6].note = '客户工厂验看时间未定';
  p3.update.risks = '立面色号确认延误,工厂排产受影响';
  p3.update.needDirector = 'Approve 2-day extension — revision over buffer';
  p3.update.by = '张三'; p3.update.at = Date.now() - 3 * day;
  log(p3, '张三', '工厂验看/审阅: wip→block');
  put(p3);

  /* 4 — just started */
  const p4 = newProject({
    name: 'Watten House', client: 'UOL Group', services: ['ani'],
    owners: ['Priya Nair'], difficulty: 'hard', start: iso(-3), delivery: iso(56), buffer: 5,
  });
  p4.packages[0].schedule[0].status = 'wip';
  put(p4);
}
