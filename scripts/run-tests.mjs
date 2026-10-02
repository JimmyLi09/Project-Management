/* npm test:跑 src/av/core/__tests__ 下的单元测试。
   Node 20 的 node --test 不认通配符(*.test.ts 要 Node 21+),所以在这里列文件;
   .ts 由 ts-register.mjs 转译(见 ts-loader.mjs),Node 20 / 22 都能跑。 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* AV 计算内核 + 通用库(REQ-044 共用清单合并规则) */
const dirs = [path.join(root, 'src', 'av', 'core', '__tests__'), path.join(root, 'src', 'lib', '__tests__')];
const files = dirs.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort().map((f) => path.join(dir, f)));
const reg = pathToFileURL(path.join(root, 'scripts', 'ts-register.mjs')).href;
const r = spawnSync(process.execPath, ['--import', reg, '--test', ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
