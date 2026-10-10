import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/* 上线时一次性迁移是串着跑的(server/db.ts getDb):044 合并清单时用的 migrate() 会顺手补日历、补 Job Record
   默认行。以前 044 先跑、把这些兜底结果存进库,048 / 049 就以为「已经有了」而跳过 —— 没备份、没报告、
   旧登记表字段也没转成行。这里拿一份 REQ-044 之前的老库,从头到尾跑一遍真实的启动迁移。 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audax-chain-'));
process.env.AUDAX_DATA_DIR = dir;
process.env.AUDAX_NO_BACKUP = '1';
/* db.ts 里只有 maybeSeedDemo 用 require(Next 打包时有;这里按 ES 模块跑没有)—— 老库不灌演示数据 */
(globalThis as { require?: unknown }).require = (id: string) => {
  if (id === './demo') return { shouldSeedDemo: () => false, seedDemo: () => undefined };
  throw new Error(`unexpected require ${id}`);
};

const row = (no: string, task: string, weeks: number) =>
  ({ no, phase: '', task, taskEn: task, owner: 'Audax', assignee: '', weeks, typical: '', gate: '', freeze: false, status: 'todo', note: '', s: '', e: '' });
const items = (...names: string[]) => names.map((zh) => ({ zh, en: zh, status: 'pending', date: '', remark: '' }));
const legacy = {
  id: 'old1', name: '老项目 CGI+沙盘', client: 'C', start: '2026-09-07', delivery: '', services: ['cgi', 'scale'], difficulty: 'normal',
  packages: [
    { svc: 'cgi', schedule: [row('1', '建模', 1), row('2', '渲染', 2)], checklist: [{ group: '资料', groupEn: 'Docs', color: '', items: items('平面图', '立面图') }],
      record: { remarks: '夜景两张', cgiViews: '6' } },
    { svc: 'scale', schedule: [row('1', '打样', 2)], checklist: [{ group: '资料', groupEn: 'Docs', color: '', items: items('平面图', '材料表') }],
      record: { scaleRatio: '1:100' } },
  ],
  log: [],
};
{
  const d = new Database(path.join(dir, 'audax.db'));
  d.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
  d.prepare('INSERT INTO projects (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)').run(legacy.id, JSON.stringify(legacy), 1, 1);
  d.close();
}

test('上线迁移链:REQ-044 之前的老库,048 / 049 / 044 / 050 都真的跑了、各有备份和报告', async () => {
  const { getDb } = await import('../../server/db.ts');
  const d = getDb();
  const meta = (k: string) => {
    const r = d.prepare('SELECT value FROM meta WHERE key = ?').get(k) as { value: string } | undefined;
    return r ? JSON.parse(r.value) : null;
  };
  const m048 = meta('mig.req048.schedule'), m049 = meta('mig.req049.jobRecord'), m050 = meta('mig.req050.checklist');
  assert.equal(m048?.fromRows, 2, '两份业务都用阶段行生成了日历');
  assert.equal(m049?.projects, 1);
  assert.equal(m049?.rows, 3, '三个旧字段转成三行');
  assert.equal(m050?.problems, 0);
  for (const b of [m048.backup, m049.backup, m050.backup]) assert.ok(b && fs.existsSync(b), `备份在:${b}`);
  const reports = fs.readdirSync(path.join(dir, 'migrations'));
  for (const pre of ['044-', '048-', '049-', '050-']) assert.ok(reports.some((f) => f.startsWith(pre)), `${pre} 报告`);

  const o = JSON.parse((d.prepare('SELECT data FROM projects WHERE id = ?').get('old1') as { data: string }).data);
  assert.ok(Array.isArray(o.checklist), '清单合成了一张');
  assert.ok(o.packages.every((pk: any) => pk.mig048?.kind === 'fromRows' && pk.calendar?.stages.length));
  assert.equal(o.packages[0].calendar.stages.length, 2);
  assert.equal(o.mig049?.rows, 3);
  const job = o.jobRecord.map((r: any) => [r.svc, r.qty, r.note]);
  assert.deepEqual(job.filter((r: any) => r[0] === 'cgi').map((r: any) => r[1] || r[2]).sort(), ['6', '夜景两张']);
  assert.deepEqual(job.filter((r: any) => r[0] === 'scale').map((r: any) => r[1]), ['1:100']);
  assert.deepEqual(o.packages[0].record, { remarks: '夜景两张', cgiViews: '6' }, '原来的字段一个没动');
  /* 048 的备份是升级前的原样(044 还没动过清单) */
  const pre = new Database(m048.backup, { readonly: true });
  const old = JSON.parse((pre.prepare('SELECT data FROM projects WHERE id = ?').get('old1') as { data: string }).data);
  pre.close();
  assert.ok(!Array.isArray(old.checklist) && !old.jobRecord && !old.packages[0].calendar);
});
