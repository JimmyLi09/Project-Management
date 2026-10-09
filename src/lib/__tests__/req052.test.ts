/* REQ-052 · 我的待办只看逾期 + 一周内;联系人角色存键 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../project.ts';
import { myTasks } from '../myTasks.ts';
import { contactRoleLabel, remapContactRoles, roleKeyOf, toLegacyRole, toRoleKey } from '../contactRoles.ts';
import { contactRoleTerm } from '../terms.ts';
import type { Project } from '../types.ts';

const TODAY = new Date(2026, 9, 9);   // 10-09
const iso = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function proj(name: string, ends: string[], extra: Partial<Project> = {}): Project {
  const p = newProject({ name, client: 'Roxy', services: ['cgi'], start: '2026-09-01', owners: ['张三'] } as any);
  const rows = p.packages[0].schedule;
  rows.length = ends.length ? Math.max(1, rows.length) : rows.length;
  ends.forEach((e, i) => { rows[i] = { ...rows[i], s: '2026-09-01', e, status: 'todo', assignee: '' }; });
  rows.length = ends.length;
  return Object.assign(p, extra);
}

test('REQ-052 · 今天 10-09:只出现逾期和 10-16 及以前到期的;一周以后的不显示', () => {
  const p = proj('A', [iso(10, 1), iso(10, 9), iso(10, 16), iso(10, 17), iso(11, 30)]);
  const items = myTasks([p], { name: '张三', role: 'pm' }, TODAY);
  assert.deepEqual(items.map((x) => [x.d.end.getDate(), x.group]), [[1, 'overdue'], [9, 'week'], [16, 'week']]);
  assert.equal(items[0].overdueDays, 8, '逾期 8 天');
});

test('REQ-052 · 已归档、售前项目的任务不算;已完成的不算;成员只看指派给自己的', () => {
  const live = proj('live', [iso(10, 10)]);
  const archived = proj('arch', [iso(10, 10)], { archived: true });
  const presale = proj('pre', [iso(10, 10)], { owners: [] });
  const done = proj('done', [iso(10, 10), iso(10, 11)]);
  done.packages[0].schedule[0].status = 'done';
  const all = myTasks([live, archived, presale, done], { name: 'pd', role: 'director' }, TODAY);
  assert.deepEqual(all.map((x) => x.p.name), ['live', 'done']);
  assert.equal(all.length, 2, '侧栏数字和列表用的就是这个长度');
  live.packages[0].schedule[0].assignee = '小李';
  assert.equal(myTasks([live], { name: '小李', role: 'member' }, TODAY).length, 1);
  assert.equal(myTasks([live], { name: '小王', role: 'member' }, TODAY).length, 0);
  assert.equal(myTasks([live], { name: 'v', role: 'viewer' }, TODAY).length, 0);
});

test('REQ-052 · 联系人角色:旧标签 → 键;「客户」显示「发展商 / Developer」;两种总包是同一个', () => {
  assert.equal(roleKeyOf('客户 Client'), 'developer');
  assert.equal(roleKeyOf('总包 Main-con'), 'maincon');
  assert.equal(roleKeyOf('总包 Main Con'), 'maincon');
  assert.equal(roleKeyOf('Main Contractor'), 'maincon', '新建项目里手填英文名也认');
  assert.equal(roleKeyOf('总包'), 'maincon');
  assert.equal(roleKeyOf('灯光顾问'), '灯光顾问', '手填的原样');
  assert.equal(contactRoleTerm('developer', 'zh'), '发展商');
  assert.equal(contactRoleTerm('developer', 'en'), 'Developer');
  assert.equal(contactRoleTerm('客户 Client', 'zh'), '发展商', '还没迁移的旧数据也显示新名字');
  assert.equal(contactRoleTerm('总包 Main Con', 'en'), 'Main contractor');
  assert.equal(contactRoleTerm('灯光顾问 Lighting', 'en'), 'Lighting', '手填的中英混写照旧拆开');
  assert.equal(contactRoleLabel('maincon', 'zh'), '总包');
});

test('REQ-052 · 上线迁移只换认得的旧标签;回退反过来', () => {
  const cs = [{ role: '客户 Client' }, { role: '总包 Main-con' }, { role: '总包 Main Con' }, { role: '灯光顾问' }, { role: '' }];
  const ch = remapContactRoles(cs, toRoleKey);
  assert.deepEqual(cs.map((c) => c.role), ['developer', 'maincon', 'maincon', '灯光顾问', '']);
  assert.equal(ch.length, 3);
  remapContactRoles(cs, toLegacyRole);
  assert.deepEqual(cs.map((c) => c.role), ['客户 Client', '总包 Main-con', '总包 Main-con', '灯光顾问', ''], '回退后两种总包统一成旧版本认的一种');
  /* 新建项目直接存键 */
  const p = newProject({ name: 'N', client: 'Dev Co', services: ['cgi'], start: '', mainContractor: 'MC Co', companies: [{ role: '建筑师', company: 'Arch', person: '', phone: '', email: '' }] } as any);
  assert.deepEqual(p.contacts!.map((c) => c.role), ['developer', 'maincon', 'architect']);
});
