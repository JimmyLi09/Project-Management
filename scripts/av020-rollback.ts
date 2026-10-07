/* ===== AV-020 回退:把用到 prj@0.2 的投影项目改回 prj@0.1-draft =====
   什么时候用:AV-020 上线后要把**代码**退回旧版本、又不想用更新前的快照覆盖数据库
   (那样会丢掉上线之后所有的修改)。旧版本不认识规则包 prj@0.2,也读不懂按融合组
   存的投影方案:上线后新建的投影项目、点过「升级到 prj@0.2」的项目,退回去以后
   05 一打开就报错。

   做什么:
     1. 先把 data\audax.db 在线备份到 data\backups\pre-av020-rollback-<时间>.db;
     2. av_inquiry.packs.projector = prj@0.2 的改回 prj@0.1-draft;
     3. 投影方案版本(av_config)里 pack_version = prj@0.2 的,改记 prj@0.1-draft,
        方案参数换成单画面(第一个融合组展开后的宽 × 高、可用投射距离);存下来的
        汇总数(06 用的台数等)不动;
     4. 投影草稿(av_config_draft / av_config_draft_u)里按融合组存的,同样换成单画面;
     5. 改了哪些、**原来的融合组方案**都写到 data\migrations\av020-rollback-<时间>.json,
        以后重新上线 AV-020 时可以对照着在 05 里重新填回去。不删任何东西。

   第 3 部分(设备库、06 模板、prj@1.0)另外会留下:
     6. 用 prj@1.0 的立项记录和方案版本 —— 和 prj@0.2 一样处理(1.0 的常数和 0.2 相同);
     7. 价格库「投影」里投影机 / 镜头 / 投影配套条目的规格(spec)清空 —— 旧代码的价格库页认不出这种规格,
        会打不开;条目和价格都保留;
     8. 删掉 av_setting 里的 prj.confirm、prj.release(常数确认和 1.0 的发布记录)。

   --part3:只退第 3 部分(代码退回第 2 部分):prj@1.0 改记 prj@0.2(融合组方案不动),再做 7、8;
            不动 prj@0.2 的项目。

   用法:先 pm2 stop audax(别让网站同时写库),再跑 scripts\av020-rollback.bat(或加 --part3),然后退代码、启动。
   加 --dry-run 只看会改哪些,不写库。 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { demotePrjV02, isGroupsConfig } from '../src/av/core/prj/groups.ts';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const part3 = process.argv.slice(2).includes('--part3');
/* 全部回退:0.2 和 1.0 都退到 0.1-draft;只退第 3 部分:1.0 退到 0.2 */
const FROMS = part3 ? ['prj@1.0'] : ['prj@0.2', 'prj@1.0'];
const TO = part3 ? 'prj@0.2' : 'prj@0.1-draft';
const FROM = FROMS.join(' / ');
const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const DATA = process.env.AUDAX_DATA_DIR || path.join(process.cwd(), 'data');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const DB = args.find((a) => !a.startsWith('--')) || path.join(DATA, 'audax.db');

const parse = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  const d = new Database(DB, dry ? { readonly: true } : {});
  const has = (t: string) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const inq = has('av_inquiry') ? (d.prepare('SELECT project_id, packs FROM av_inquiry').all() as { project_id: string; packs: string }[])
    .filter((r) => FROMS.includes((parse(r.packs) as { projector?: string } | null)?.projector ?? '')) : [];
  const cfgs = has('av_config') ? (d.prepare(`SELECT id, project_id, cfg FROM av_config WHERE line = 'projector' AND pack_version IN (${FROMS.map(() => '?').join(', ')})`).all(...FROMS) as { id: number; project_id: string; cfg: string }[]) : [];
  /* 只退第 3 部分时方案形状不变,草稿不用动 */
  const drafts = !part3 && has('av_config_draft') ? (d.prepare("SELECT project_id, cfg FROM av_config_draft WHERE line = 'projector'").all() as { project_id: string; cfg: string }[])
    .filter((r) => isGroupsConfig(parse(r.cfg))) : [];
  const draftsU = !part3 && has('av_config_draft_u') ? (d.prepare("SELECT project_id, user_id, cfg FROM av_config_draft_u WHERE line = 'projector'").all() as { project_id: string; user_id: number; cfg: string }[])
    .filter((r) => isGroupsConfig(parse(r.cfg))) : [];
  const specs = has('av_price_item') ? (d.prepare("SELECT id, model, spec FROM av_price_item WHERE line = 'projector' AND spec <> ''").all() as { id: number; model: string; spec: string }[])
    .filter((r) => ['projector', 'lens', 'part'].includes(String((parse(r.spec) as { kind?: string } | null)?.kind))) : [];
  const settings = has('av_setting') ? (d.prepare("SELECT key, value FROM av_setting WHERE key IN ('prj.confirm', 'prj.release')").all() as { key: string; value: string }[]) : [];
  console.log(`立项记录 ${FROM} → ${TO}:${inq.length} 个项目`);
  console.log(`投影方案版本 ${FROM} → ${TO}${part3 ? '' : '(换成单画面)'}:${cfgs.length} 个版本`);
  if (!part3) console.log(`投影草稿换成单画面:${drafts.length + draftsU.length} 份`);
  console.log(`价格库投影设备规格清空(条目和价格保留):${specs.length} 条`);
  console.log(`常数确认 / 1.0 发布记录删除:${settings.map((x) => x.key).join('、') || '无'}`);
  if (dry) { console.log('(--dry-run:没有写库)'); d.close(); return; }

  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-av020-rollback-${stamp}.db`);
  await d.backup(backup);
  const demote = (s: string) => {
    const c = parse(s);
    return JSON.stringify(isGroupsConfig(c) ? demotePrjV02(c) : c);
  };
  /* each list is empty when its table does not exist, so only prepare what will run */
  d.transaction(() => {
    if (inq.length) {
      const upd = d.prepare('UPDATE av_inquiry SET packs = ? WHERE project_id = ?');
      for (const r of inq) upd.run(JSON.stringify({ ...(parse(r.packs) as object), projector: TO }), r.project_id);
    }
    if (cfgs.length) {
      const upd = d.prepare('UPDATE av_config SET pack_version = ?, cfg = ? WHERE id = ?');
      for (const c of cfgs) upd.run(TO, part3 ? c.cfg : demote(c.cfg), c.id);
    }
    if (specs.length) {
      const upd = d.prepare("UPDATE av_price_item SET spec = '' WHERE id = ?");
      for (const r of specs) upd.run(r.id);
    }
    if (settings.length) d.prepare("DELETE FROM av_setting WHERE key IN ('prj.confirm', 'prj.release')").run();
    if (drafts.length) {
      const upd = d.prepare("UPDATE av_config_draft SET cfg = ? WHERE project_id = ? AND line = 'projector'");
      for (const r of drafts) upd.run(demote(r.cfg), r.project_id);
    }
    if (draftsU.length) {
      const upd = d.prepare("UPDATE av_config_draft_u SET cfg = ? WHERE project_id = ? AND user_id = ? AND line = 'projector'");
      for (const r of draftsU) upd.run(demote(r.cfg), r.project_id, r.user_id);
    }
  })();
  d.close();
  const mdir = path.join(DATA, 'migrations');
  fs.mkdirSync(mdir, { recursive: true });
  const log = path.join(mdir, `av020-rollback-${stamp}.json`);
  fs.writeFileSync(log, JSON.stringify({
    at: now.toISOString(), from: FROMS, to: TO, part3, inquiries: inq.map((r) => r.project_id),
    specs: specs.map((r) => ({ id: r.id, model: r.model, original: parse(r.spec) })), settings: settings.map((x) => ({ key: x.key, original: parse(x.value) })),
    configs: cfgs.map((c) => ({ id: c.id, project: c.project_id, original: parse(c.cfg) })),
    drafts: [...drafts.map((r) => ({ project: r.project_id, original: parse(r.cfg) })), ...draftsU.map((r) => ({ project: r.project_id, user: r.user_id, original: parse(r.cfg) }))],
  }, null, 2));
  console.log('');
  console.log(`改之前的数据库备份:${backup}`);
  console.log(`改了哪些(含原来的融合组方案):${log}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
