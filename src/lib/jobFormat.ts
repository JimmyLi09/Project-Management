/* ===== REQ-053 · Job Record 格式:硬件 = 登记表,软件 = 4 栏 =====
   每种业务一个格式:
   - 硬件 · 登记表(hw):Job Record 里每份服务包一张登记表卡(字段可改、公式自动算),下面可选加几行 4 栏「额外项目」;
   - 软件 · 4 栏(sw):REQ-049 的 4 栏表,每个业务至少一行。
   默认硬件 = 下面这 9 种(JM 1012 选定),其余都是软件。PD / BD 在「登记表管理」里可以改某个业务的分类,
   改的只是显示方式:pk.record 和 4 栏行两种数据都留着。

   覆盖值存在数据库 meta(job.formats)。服务端由 server/db.ts 注册一个读库的取值函数(带 2 秒缓存),
   浏览器里由 store 注册;都挂在 globalThis 上 —— Next 的不同路由各自打包,模块级变量可能有好几份。 */

export type JobFormat = 'hw' | 'sw';
export type JobFormatMap = Record<string, JobFormat>;

/* REQ-059:3D VR/720 不是硬件(Job Record 里只是一行基础栏)—— 默认改为软件 · 4 栏。不迁移数据:
   原来登记表里的字段在「旧字段(只读)」里照样看得到,原来的「额外项目」行直接成了 4 栏表里的行 */
export const DEFAULT_HW_SVCS = ['led', 'projector', 'tv', 'maxhub', 'lightbox', 'av', 'elv', 'pv'];

const G = globalThis as { __audaxJobFmtServer?: () => JobFormatMap; __audaxJobFmtClient?: () => JobFormatMap };
const current = (): JobFormatMap =>
  ((typeof window === 'undefined' ? G.__audaxJobFmtServer : undefined) || G.__audaxJobFmtClient || (() => ({})))();
export function setServerJobFormatSource(fn: () => JobFormatMap) { G.__audaxJobFmtServer = fn; }
export function setJobFormatSource(fn: () => JobFormatMap) { G.__audaxJobFmtClient = fn; }

/* 这个业务现在是硬件还是软件。ov 不传就用当前生效的覆盖表 */
export function formatOf(svc: string, ov?: JobFormatMap): JobFormat {
  const o = ov || current();
  if (o[svc] === 'hw' || o[svc] === 'sw') return o[svc];
  return DEFAULT_HW_SVCS.includes(svc) ? 'hw' : 'sw';
}
export const isHw = (svc: string, ov?: JobFormatMap) => formatOf(svc, ov) === 'hw';

/* 存库前清洗:只留合法的业务 key 和 hw / sw;和默认一样的不存 */
export function cleanJobFormats(raw: unknown, validSvc: (svc: string) => boolean): JobFormatMap {
  const out: JobFormatMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [svc, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!validSvc(svc) || (v !== 'hw' && v !== 'sw')) continue;
    if (v !== (DEFAULT_HW_SVCS.includes(svc) ? 'hw' : 'sw')) out[svc] = v;
  }
  return out;
}
