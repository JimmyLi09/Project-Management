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
  p1.checklist![0].items.forEach((it, i) => { if (i < 4) { it.status = 'confirmed'; it.date = iso(-15); } });
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
  /* REQ-048:效果图现在是 3 个阶段 —— 前两段做完,第三段进行中 */
  p2.packages[0].schedule.forEach((r, i) => { if (i <= 1) r.status = 'done'; });
  p2.packages[0].schedule[2].status = 'wip';
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

/* ===== AV-014 历史案例的示例屏 =====
   演示模式跑在 Vercel 上,那里没有 Python,导入不了统计表 —— 案例库空着的话,
   历史案例这一页排序、筛选、编辑、保修列一样都验不了。用 0929 原型里的示例屏
   预置(原型取自统计表截图 + 几条进行中项目),交付日期与保修期也照原型。

   只有一处不照抄:170-South Beach 的交付日期按「今天往前推」算,让它始终停在
   「N 天后到期」那一档 —— 写死日期的话过几周就滑进「已过保」,预览上就再也
   看不到琥珀色那一档了。

   内网服务器不开演示模式,不会有这批数据。 */
export interface DemoCase {
  sheet: 'ongoing' | 'completed';
  refNo: string | null; year: number | null; name: string; client: string; address: string;
  w: number; h: number; sqm: number; pitch: number; product: string; modules: number | null; kw: number | null;
  pc: string | null; dc: string | null; remarks: string | null;
  handover: string | null; warrantyMonths: number;
}

export const DEMO_CASES: DemoCase[] = [
  { sheet: 'completed', refNo: '066', year: null, name: '8SW Sales Gallery', client: 'Perennial', address: '1.279519, 103.855736', w: 43320, h: 3200, sqm: 138.6, pitch: 2.5, product: 'P2.5', modules: null, kw: 70, pc: '33', dc: '66', remarks: 'P2.5 箱体屏(960*800)定制', handover: '2025-03-18', warrantyMonths: 24 },
  { sheet: 'completed', refNo: '2023-152', year: 2023, name: 'Malaysia TRX Curve Wall LED', client: 'Gucci', address: 'TRX, KL, Malaysia', w: 22114, h: 4846, sqm: 107.2, pitch: 1.86, product: 'P1.86 (320*160mm)', modules: 2170, kw: 60, pc: '13A x 18 sets', dc: '45', remarks: 'P1.86 (640*480mm)箱体屏。定制屏', handover: '2023-11-20', warrantyMonths: 24 },
  { sheet: 'completed', refNo: '066', year: null, name: '8SW Sales Gallery', client: 'Perennial', address: '1.279519, 103.855736', w: 33280, h: 3200, sqm: 106.5, pitch: 2.5, product: 'P2.5', modules: null, kw: 55, pc: '26', dc: '42', remarks: 'P2.5 箱体屏(640*640)', handover: '2025-03-18', warrantyMonths: 24 },
  { sheet: 'completed', refNo: '066', year: null, name: '8SW Sales Gallery', client: 'Perennial', address: '1.279519, 103.855736', w: 20000, h: 4000, sqm: 80, pitch: 2.5, product: 'P2.5', modules: null, kw: 50, pc: '21', dc: '34', remarks: 'P2.5 箱体屏(960*800)定制', handover: '2025-03-18', warrantyMonths: 24 },
  { sheet: 'completed', refNo: '191', year: null, name: 'The M', client: 'WingTai', address: 'Selegie Road Lamp Post 11, opposite Sunshine Plaza, 189652', w: 9600, h: 4800, sqm: 72, pitch: 3, product: 'P3', modules: 1250, kw: null, pc: '13A x 20 sets', dc: '16+4', remarks: 'Wall LED', handover: null, warrantyMonths: 12 },
  { sheet: 'completed', refNo: null, year: 2024, name: '112-Marina View Showflat', client: 'IOI', address: '21 Park St, Singapore 018925', w: 12800, h: 4960, sqm: 63.49, pitch: 2.5, product: 'P2.5 Curve Wall', modules: 1240, kw: 29, pc: '11', dc: '24', remarks: '320*160mm Modules 640*480mm Cabinet', handover: '2024-10-08', warrantyMonths: 12 },
  { sheet: 'completed', refNo: null, year: 2025, name: '170-South Beach LED', client: 'E3 Design Pte Ltd', address: '38 Beach Rd, Singapore 189767', w: 9920, h: 5920, sqm: 58.73, pitch: 2.5, product: 'P2.5 GOB LED Screen', modules: 1147, kw: 26.43, pc: '18', dc: '18', remarks: '320*160mm Modules 640*480mm Cabinet', handover: iso(-345), warrantyMonths: 12 },
  { sheet: 'completed', refNo: null, year: 2024, name: '095-GMC', client: 'Perennials', address: 'Beside Skywaters Residences Sales Gallery', w: 14080, h: 4160, sqm: 58.57, pitch: 2.5, product: 'P2.5 Straight Wall', modules: 1144, kw: 26.36, pc: '23', dc: '27', remarks: '320*160mm Modules 640*480mm Cabinet', handover: '2024-06-15', warrantyMonths: 24 },
  { sheet: 'completed', refNo: null, year: 2025, name: '206-South Beach Outdoor LED', client: 'CBRE', address: '38 Beach Rd, Singapore 189767', w: 7680, h: 6240, sqm: 47.92, pitch: 10, product: 'P10 室外金线模组', modules: 936, kw: 23.96, pc: null, dc: null, remarks: '320*160mm Modules 640*480mm Cabinet', handover: '2025-12-05', warrantyMonths: 24 },
  { sheet: 'completed', refNo: '2022-088', year: 2022, name: 'Dior Pop-up', client: 'Dior', address: 'ION Orchard', w: 4800, h: 2700, sqm: 12.96, pitch: 1.9, product: 'P1.9', modules: 162, kw: 5.8, pc: '3', dc: '4', remarks: 'Rental', handover: '2022-05-01', warrantyMonths: 12 },
  { sheet: 'ongoing', refNo: null, year: 2026, name: '131-Guoco Lentor LED', client: 'GuocoLand', address: 'Lentor Central', w: 5760, h: 2880, sqm: 16.59, pitch: 1.86, product: 'P1.86', modules: 216, kw: 7.5, pc: '4', dc: '5', remarks: null, handover: null, warrantyMonths: 12 },
  { sheet: 'ongoing', refNo: null, year: 2026, name: '021-Nafa LED', client: 'QXY Resources Pte Ltd', address: 'NAFA Campus 3', w: 6400, h: 3600, sqm: 23.04, pitch: 2.5, product: 'P2.5', modules: 288, kw: 10.4, pc: '5', dc: '5', remarks: null, handover: null, warrantyMonths: 12 },
  { sheet: 'ongoing', refNo: null, year: 2026, name: '128-C&K T1 LED', client: 'Charles & Keith Pte Ltd', address: 'Changi Airport T1', w: 3840, h: 2160, sqm: 8.29, pitch: 1.25, product: 'P1.25 COB', modules: null, kw: 3.9, pc: '2', dc: '3', remarks: null, handover: null, warrantyMonths: 12 },
  { sheet: 'ongoing', refNo: null, year: 2026, name: '144-Chuan Grove LED', client: 'Singholding', address: 'Chuan Grove', w: 2560, h: 1440, sqm: 3.69, pitch: 1.56, product: 'P1.56 COB', modules: 48, kw: 1.66, pc: '2', dc: '2', remarks: null, handover: null, warrantyMonths: 12 },
];
