/* ===== 删除已合并进 main 的远端分支 =====
   用法(在服务器的项目目录,或任何一份本仓库的 git clone 里):
     scripts\delete-merged-branches.bat                          只列出来,不删
     scripts\delete-merged-branches.bat --apply                  删「已合并进 main」的(要输入 YES 确认)
     scripts\delete-merged-branches.bat --apply --with-content-merged
                                                                 连「没合并、但内容都已在 main」的一起删
     --keep 分支1,分支2   这几个不删(main / master 永远不删)
   删之前先 git fetch --prune,按 GitHub 上的最新状态算。删除用的是这份 clone 平时 git push 的账号,要有推送权限。
   三类分支:
     ① 已合并:分支最新的提交已经在 main 里(PR 用 merge 合并的都是这种)—— --apply 时删;
     ② 内容已在 main:提交不在 main 的历史里(比如内容是另一个提交带进 main 的),但它改过的每个文件,
        这个版本都在 main 的历史里出现过 —— 默认只列出来,加 --with-content-merged 才删;
     ③ 没合并:还有 main 里没有的内容 —— 永远不删。
   删了什么写到 data\migrations\branches-deleted-<时间>.md(带每个分支最后的提交号,误删可以用
   git push origin <提交号>:refs/heads/<分支名> 恢复)。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const withContent = args.includes('--with-content-merged');
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] || '' : ''; };
const REMOTE = opt('--remote') || 'origin';
const BASE = opt('--base') || 'main';
const KEEP = new Set(['main', 'master', BASE, ...opt('--keep').split(',').map((s) => s.trim()).filter(Boolean)]);

const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const gitOk = (...a: string[]) => { try { execFileSync('git', a, { stdio: 'ignore' }); return true; } catch { return false; } };

function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

/* 这个分支改过的文件,在 main 的历史里有没有一模一样的版本 */
const blobCache = new Map<string, Set<string>>();
function mainBlobs(file: string): Set<string> {
  let s = blobCache.get(file);
  if (s) return s;
  s = new Set<string>();
  /* --raw 每行 ":旧模式 新模式 旧blob 新blob 状态\t路径",取新 blob */
  const out = git('log', '--format=', '--raw', '--no-abbrev', '-z', `${REMOTE}/${BASE}`, '--', file);
  for (const part of out.split('\0')) {
    const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) /.exec(part.trim());
    if (m && !/^0+$/.test(m[1])) s.add(m[1]);
  }
  blobCache.set(file, s);
  return s;
}
function contentInMain(ref: string): boolean {
  const mb = git('merge-base', ref, `${REMOTE}/${BASE}`).trim();
  const files = git('diff', '--name-only', '-z', mb, ref).split('\0').filter(Boolean);
  if (!files.length) return true;   // 分支上没有任何改动
  return files.every((f) => {
    let blob = '';
    try { blob = git('rev-parse', `${ref}:${f}`).trim(); } catch { /* 分支上删了这个文件 */ }
    if (!blob) return !gitOk('cat-file', '-e', `${REMOTE}/${BASE}:${f}`);   // main 现在也没有这个文件才算
    return mainBlobs(f).has(blob);
  });
}

async function main() {
  try { git('rev-parse', '--show-toplevel'); } catch {
    console.error('这里不是 git 仓库。请在服务器的项目目录(或本仓库的任何一份 git clone)里运行 scripts\\delete-merged-branches.bat。');
    process.exit(1);
  }
  console.log(`取 GitHub 上的最新状态:git fetch --prune ${REMOTE} …`);
  try { git('fetch', '--prune', REMOTE); } catch (e) {
    console.error('git fetch 失败:', (e as { stderr?: string }).stderr || (e as Error).message);
    process.exit(1);
  }
  if (!gitOk('rev-parse', '--verify', `${REMOTE}/${BASE}`)) { console.error(`找不到 ${REMOTE}/${BASE}`); process.exit(1); }

  const rows = git('for-each-ref', '--format=%(refname:short)|%(objectname:short)|%(committerdate:short)', `refs/remotes/${REMOTE}`)
    .split('\n').filter(Boolean).map((l) => { const [ref, sha, date] = l.split('|'); return { ref, name: ref.slice(REMOTE.length + 1), sha, date }; })
    .filter((r) => r.name && r.name !== 'HEAD' && r.ref !== REMOTE);

  const merged: typeof rows = [], content: typeof rows = [], open: (typeof rows[number] & { ahead: number })[] = [], kept: typeof rows = [];
  for (const r of rows) {
    if (KEEP.has(r.name)) { kept.push(r); continue; }
    if (gitOk('merge-base', '--is-ancestor', r.ref, `${REMOTE}/${BASE}`)) { merged.push(r); continue; }
    if (contentInMain(r.ref)) { content.push(r); continue; }
    open.push({ ...r, ahead: Number(git('rev-list', '--count', `${REMOTE}/${BASE}..${r.ref}`).trim()) });
  }

  const line = (r: { name: string; sha: string; date: string }) => `  ${r.name.padEnd(48)} ${r.sha}  ${r.date}`;
  console.log('');
  console.log(`① 已合并进 ${BASE}(${merged.length} 个)${apply ? ' —— 删' : ''}:`);
  merged.forEach((r) => console.log(line(r)));
  console.log('');
  console.log(`② 没合并、但改过的内容都已在 ${BASE}(${content.length} 个)${apply && withContent ? ' —— 删' : ' —— 默认不删,加 --with-content-merged 才删'}:`);
  content.forEach((r) => console.log(line(r)));
  console.log('');
  console.log(`③ 还有 ${BASE} 里没有的内容(${open.length} 个)—— 不删:`);
  open.forEach((r) => console.log(`${line(r)}  (多 ${r.ahead} 个提交)`));
  console.log('');
  console.log(`保留不动:${kept.map((r) => r.name).join('、') || '无'}`);

  const del = [...merged, ...(withContent ? content : [])];
  if (!apply) {
    console.log('');
    console.log('这是预览,没有删任何分支。');
    console.log(`确认要删 ① 的 ${merged.length} 个:scripts\\delete-merged-branches.bat --apply`);
    if (content.length) console.log(`连 ② 的 ${content.length} 个一起删:scripts\\delete-merged-branches.bat --apply --with-content-merged`);
    return;
  }
  if (!del.length) { console.log('\n没有要删的分支。'); return; }
  const a = await ask(`\n要删除 GitHub 上的这 ${del.length} 个分支。确认请输入 YES(大写)后回车:`);
  if (a !== 'YES') { console.log('没有输入 YES,什么都没删。'); return; }

  const done: typeof rows = [], failed: { r: (typeof rows)[number]; err: string }[] = [];
  for (let i = 0; i < del.length; i += 20) {
    const batch = del.slice(i, i + 20);
    try {
      execFileSync('git', ['push', REMOTE, '--delete', ...batch.map((r) => r.name)], { stdio: ['ignore', 'pipe', 'pipe'] });
      done.push(...batch);
    } catch {
      /* 一批失败就逐个再试,看清是哪个删不掉 */
      for (const r of batch) {
        try { execFileSync('git', ['push', REMOTE, '--delete', r.name], { stdio: ['ignore', 'pipe', 'pipe'] }); done.push(r); }
        catch (e) { failed.push({ r, err: String((e as { stderr?: Buffer }).stderr || (e as Error).message).trim().split('\n').pop() || '' }); }
      }
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const t = new Date();
  const stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
  const dir = path.join(process.cwd(), 'data', 'migrations');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `branches-deleted-${stamp}.md`);
  fs.writeFileSync(file, [
    '# 删除已合并的远端分支 · 记录', '', `- 时间:${t.toLocaleString('zh-CN')}`, `- 远端:${REMOTE},基准分支:${BASE}`, '',
    `## 删掉的(${done.length} 个)`, '', '| 分支 | 最后的提交 | 日期 | 类别 |', '|---|---|---|---|',
    ...done.map((r) => `| ${r.name} | ${r.sha} | ${r.date} | ${merged.includes(r) ? '已合并' : '内容已在 ' + BASE} |`), '',
    failed.length ? `## 没删掉的(${failed.length} 个)\n\n` + failed.map((x) => `- ${x.r.name}:${x.err}`).join('\n') + '\n' : '',
    '误删了要恢复:`git push ' + REMOTE + ' <最后的提交>:refs/heads/<分支名>`(在这份 clone 里执行)。', '',
  ].join('\n'), 'utf8');
  console.log('');
  console.log(`已删除 ${done.length} 个分支${failed.length ? `,${failed.length} 个没删掉(见记录)` : ''}。`);
  console.log(`记录:${file}`);
  if (failed.length) process.exitCode = 1;
}
main().catch((e) => { console.error('出错了:', e?.message || e); process.exit(1); });
