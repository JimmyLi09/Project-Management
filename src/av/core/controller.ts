/* ===== AV-019 §2.5 / §2.6 · F11 控制器与信号源选型 =====
   按设备库(价格库「控制系统」分类)选,不写死型号:
     需求 = 总像素、网口数(= 网线条数)、像素宽 / 高、信号源方式(01 的「主要播放什么」「电脑由谁提供」)。
     候选 = 「独立播放」类(多媒体播放盒)只用于不接电脑;「视频控制器」类用于接电脑 / 摄像机信号。
     在候选里选同时满足「网口 ≥ 网线条数」「总带载 ≥ 总像素」「最大宽 / 高 ≥ 像素宽 / 高」的,
     价格最低优先;都没价格时选带载最小的;都不满足就提示超出单台能力。
   不考虑备份(1002 决定)。纯函数:05、06、技术方案、保存时的汇总都用它。 */

export type CtrlKind = 'player' | 'video' | 'large' | 'media' | 'pc';
export type PlayUse = 'meeting' | 'ads' | 'both' | 'live' | 'unsure';
export type PcBy = 'client' | 'us';

export interface CtrlDevice {
  id?: number;
  model: string;
  brand: string;
  kind: CtrlKind;           // 播放盒 / 视频控制器 / 大型控制器 / 媒体播放器 / 播控电脑
  ports: number;            // 网口数(不含备份口)
  loadPx: number;           // 总带载(像素)
  maxW: number;             // 最大宽(像素)
  maxH: number;             // 最大高(像素)
  inputs: string[];         // 视频输入:HDMI / DVI / SDI / DP
  standalone: boolean;      // 能否独立播放(不接电脑)
  price: number | null;     // 成本价;没有 = 待报价
}

export interface CtrlNeed { px: number; pxW: number; pxH: number; runs: number }
export interface SignalAnswer { use?: PlayUse | null; pc?: PcBy | null }

export interface CtrlCheck { ok: boolean; zh: string; en: string }
export interface CtrlPick { device: CtrlDevice; checks: CtrlCheck[] }

export interface CtrlAdvice {
  use: PlayUse;                       // 实际按哪种场景给建议(「还不确定」按会议 / 演示)
  pending: boolean;                   // 01 还没答或答「还不确定」→ 标「待确认」
  primary: CtrlPick | null;           // 控制器或播放盒
  alternates: CtrlPick[];             // 其他也满足的(最多 3 个)
  media: CtrlDevice | null;           // 需要媒体播放器时(设备库里的那一项)
  needMedia: boolean;
  needPc: boolean;                    // 我们报一台播控电脑
  pc: CtrlDevice | null;
  manual: boolean;                    // 05 里人工改选了型号
  fail: { zh: string; en: string } | null;   // 单台都不满足
  signal: { zh: string; en: string }; // 信号源建议一句话
  reason: { zh: string; en: string }[];     // 为什么
}

export const KIND_LABEL: Record<CtrlKind, [string, string]> = {
  player: ['多媒体播放盒', 'Multimedia player box'],
  video: ['视频控制器（一体机）', 'Video controller (all-in-one)'],
  large: ['大型控制器', 'Large controller'],
  media: ['媒体播放器（HDMI 输出）', 'Media player (HDMI out)'],
  pc: ['播控电脑', 'Playback PC'],
};
export const USE_LABEL: Record<PlayUse, [string, string]> = {
  meeting: ['会议 / 演示（接电脑或笔记本）', 'Meetings / presentations (laptop or PC)'],
  ads: ['广告 / 品牌内容轮播（不接电脑）', 'Ads / brand content loop (no PC)'],
  both: ['两者都有', 'Both'],
  live: ['直播 / 摄像机信号', 'Live / camera feed'],
  unsure: ['还不确定', 'Not sure yet'],
};
export const PC_LABEL: Record<PcBy, [string, string]> = {
  client: ['客户自备', 'Client provides'],
  us: ['我们报一台播控电脑', 'We quote a playback PC'],
};

const wan = (n: number) => `${Math.round(n / 1e4)} 万`;
const mpx = (n: number) => `${(n / 1e6).toFixed(2)} MPx`;

export function checksOf(d: CtrlDevice, n: CtrlNeed): CtrlCheck[] {
  return [
    { ok: d.ports >= n.runs, zh: `网口 ${d.ports} ≥ 网线 ${n.runs} 条`, en: `${d.ports} ports ≥ ${n.runs} runs` },
    { ok: d.loadPx >= n.px, zh: `总带载 ${wan(d.loadPx)} ≥ ${wan(n.px)}像素`, en: `load ${mpx(d.loadPx)} ≥ ${mpx(n.px)}` },
    { ok: d.maxW >= n.pxW && d.maxH >= n.pxH, zh: `最大 ${d.maxW} × ${d.maxH} ≥ ${n.pxW} × ${n.pxH}`, en: `max ${d.maxW} × ${d.maxH} ≥ ${n.pxW} × ${n.pxH}` },
  ].map((c) => (c.ok ? c : { ...c, zh: c.zh.replace('≥', '<'), en: c.en.replace('≥', '<') }));
}
export const fits = (d: CtrlDevice, n: CtrlNeed) => checksOf(d, n).every((c) => c.ok);

/* 价格最低优先;没价格的排在有价格的后面,彼此按带载从小到大 */
function rank(a: CtrlDevice, b: CtrlDevice) {
  if (a.price != null && b.price != null) return a.price - b.price || a.loadPx - b.loadPx;
  if (a.price != null) return -1;
  if (b.price != null) return 1;
  return a.loadPx - b.loadPx || a.ports - b.ports || a.model.localeCompare(b.model);
}

export function advise(devices: CtrlDevice[], need: CtrlNeed, ans: SignalAnswer, manualModel?: string | null): CtrlAdvice {
  const pending = !ans.use || ans.use === 'unsure';
  const use: PlayUse = pending ? 'meeting' : ans.use!;
  const players = devices.filter((d) => d.kind === 'player');
  const ctrls = devices.filter((d) => d.kind === 'video' || d.kind === 'large');
  const fitOf = (list: CtrlDevice[]) => list.filter((d) => fits(d, need)).sort(rank);
  const pickOf = (d: CtrlDevice): CtrlPick => ({ device: d, checks: checksOf(d, need) });
  const reason: CtrlAdvice['reason'] = [];

  let pool: CtrlDevice[];
  let needMedia = false;
  if (use === 'ads' || use === 'both') {
    /* 不接电脑:屏不大时用播放盒;「两者都有」要播放盒带 HDMI 输入,会议时切到电脑 */
    const okPlayers = fitOf(players.filter((d) => d.standalone && (use === 'ads' || d.inputs.some((x) => /HDMI/i.test(x)))));
    if (okPlayers.length) {
      pool = okPlayers;
      reason.push(use === 'ads'
        ? { zh: '不接电脑：多媒体播放盒自带存储，可 Wi-Fi / 4G 远程更新内容', en: 'No PC: the player box has its own storage and updates over Wi-Fi / 4G' }
        : { zh: '播放盒带 HDMI 输入：平时自己轮播，开会时切到电脑', en: 'Player box with HDMI input: loops content, switches to the PC for meetings' });
    } else {
      pool = fitOf(ctrls);
      needMedia = true;
      const best = players.filter((d) => d.standalone).sort((a, b) => b.loadPx - a.loadPx)[0];
      reason.push({
        zh: `播放盒能力不够（${best ? `最大的 ${best.model} 只有 ${wan(best.loadPx)}带载、${best.ports} 个网口` : '设备库里没有播放盒'}）→ 视频控制器 + 媒体播放器（HDMI 输出）`,
        en: `No player box is big enough (${best ? `the largest, ${best.model}, has ${mpx(best.loadPx)} and ${best.ports} ports` : 'none in the library'}) → video controller + media player (HDMI out)`,
      });
    }
  } else if (use === 'live') {
    pool = fitOf(ctrls.filter((d) => d.inputs.some((x) => /SDI/i.test(x))));
    reason.push({ zh: '摄像机信号：视频控制器带 SDI 输入', en: 'Camera feed: video controller with SDI input' });
  } else {
    pool = fitOf(ctrls);
    reason.push({ zh: '接电脑（HDMI）：用视频控制器', en: 'PC over HDMI: video controller' });
  }

  const needPc = (use === 'meeting' || use === 'both') && ans.pc === 'us';
  const manualDev = manualModel ? devices.find((d) => d.model === manualModel && (d.kind === 'player' || d.kind === 'video' || d.kind === 'large')) : undefined;
  const primaryDev = manualDev ?? pool[0];
  if (manualDev && manualDev.kind === 'player') needMedia = false;
  if (manualDev && manualDev.kind !== 'player' && (use === 'ads' || use === 'both') && !pool.includes(manualDev)) needMedia = !manualDev.standalone;
  const fail = !primaryDev
    ? { zh: '超出单台能力，需多台拼接或大型控制器（设备库里没有一台同时满足网口、带载、宽高）', en: 'Beyond a single unit — several units or a large controller are needed (no device meets ports, load and size together)' }
    : null;
  const mediaDev = needMedia ? devices.filter((d) => d.kind === 'media').sort(rank)[0] ?? null : null;
  const pcDev = needPc ? devices.filter((d) => d.kind === 'pc').sort(rank)[0] ?? null : null;

  const signal = (() => {
    switch (use) {
      case 'meeting': return { zh: `接电脑（HDMI）；${ans.pc === 'us' ? '报一台播控电脑' : ans.pc === 'client' ? '电脑客户自备' : '电脑由谁提供待定'}`, en: `PC over HDMI; ${ans.pc === 'us' ? 'we quote a playback PC' : ans.pc === 'client' ? 'client provides the PC' : 'who provides the PC is open'}` };
      case 'ads': return needMedia ? { zh: '不用电脑：媒体播放器（HDMI 输出）接视频控制器', en: 'No PC: media player (HDMI out) into the video controller' } : { zh: '不用电脑：多媒体播放盒独立播放', en: 'No PC: player box plays on its own' };
      case 'both': return needMedia
        ? { zh: `媒体播放器 + 电脑都接视频控制器，会议时切到电脑${needPc ? '；报一台播控电脑' : ''}`, en: `Media player and PC both into the video controller; switch to the PC for meetings${needPc ? '; we quote a playback PC' : ''}` }
        : { zh: `播放盒轮播，会议时切到电脑（HDMI）${needPc ? '；报一台播控电脑' : ''}`, en: `Player box loops content; switch to the PC (HDMI) for meetings${needPc ? '; we quote a playback PC' : ''}` };
      case 'live': return { zh: '摄像机信号走 SDI 进视频控制器', en: 'Camera feed over SDI into the video controller' };
      default: return { zh: '', en: '' };
    }
  })();
  if (pending) reason.unshift({ zh: '01「这块屏主要播放什么」还没定：先按会议 / 演示给建议，待确认', en: '01 "What will the screen mainly play" is open: advice assumes meetings / presentations — to be confirmed' });
  if (manualDev) reason.push({ zh: `人工选择 ${manualDev.model}${fits(manualDev, need) ? '' : '（不满足下面标 ✕ 的条件）'}`, en: `${manualDev.model} chosen by hand${fits(manualDev, need) ? '' : ' (fails the ✕ checks below)'}` });

  return {
    use, pending,
    primary: primaryDev ? pickOf(primaryDev) : null,
    alternates: pool.filter((d) => d !== primaryDev).slice(0, 3).map(pickOf),
    media: mediaDev, needMedia,
    needPc, pc: pcDev,
    manual: !!manualDev,
    fail,
    signal,
    reason,
  };
}

/* 首批诺瓦数据(2026-10 按官网规格书录入,上线前请再核一次)。价格留空 = 待报价 */
export const NOVASTAR_SEED: (Omit<CtrlDevice, 'price'> & { note: string })[] = [
  { model: 'TB30', brand: 'NovaStar', kind: 'player', ports: 1, loadPx: 650_000, maxW: 4096, maxH: 4096, inputs: [], standalone: true, note: '另 1 个网口为备份口' },
  { model: 'TB40', brand: 'NovaStar', kind: 'player', ports: 2, loadPx: 1_300_000, maxW: 4096, maxH: 4096, inputs: ['HDMI 1.3'], standalone: true, note: '' },
  { model: 'TB50', brand: 'NovaStar', kind: 'player', ports: 2, loadPx: 1_300_000, maxW: 4096, maxH: 4096, inputs: ['HDMI 1.3'], standalone: true, note: '' },
  { model: 'TB60', brand: 'NovaStar', kind: 'player', ports: 4, loadPx: 2_300_000, maxW: 4096, maxH: 4096, inputs: ['HDMI 1.4'], standalone: true, note: '' },
  { model: 'VX400', brand: 'NovaStar', kind: 'video', ports: 4, loadPx: 2_600_000, maxW: 10240, maxH: 8192, inputs: ['HDMI × 2', 'DVI', '3G-SDI'], standalone: false, note: '' },
  { model: 'VX600', brand: 'NovaStar', kind: 'video', ports: 6, loadPx: 3_900_000, maxW: 10240, maxH: 8192, inputs: ['HDMI × 2', 'DVI', '3G-SDI'], standalone: false, note: '' },
  { model: 'VX1000', brand: 'NovaStar', kind: 'video', ports: 10, loadPx: 6_500_000, maxW: 10240, maxH: 8192, inputs: ['4K 输入'], standalone: false, note: '文档只写「含 4K 输入」，其他输入口上线前对照规格书补' },
  { model: 'MX40 Pro', brand: 'NovaStar', kind: 'large', ports: 20, loadPx: 8_800_000, maxW: 10240, maxH: 10240, inputs: ['HDMI 2.0 × 3', 'DP 1.2', '12G-SDI'], standalone: false, note: 'COEX 系列；规格书只写最大宽 10240，高按 10240 计' },
  { model: '媒体播放器（HDMI 输出）', brand: '', kind: 'media', ports: 0, loadPx: 0, maxW: 0, maxH: 0, inputs: [], standalone: true, note: '广告轮播、控制器前端用' },
  { model: '播控电脑', brand: '', kind: 'pc', ports: 0, loadPx: 0, maxW: 0, maxH: 0, inputs: [], standalone: false, note: '会议 / 演示时由我们报' },
];
