/* ===== REQ-052 §2.2 · 联系人角色存「键」,显示时再翻译 =====
   以前存的是中英混写的标签(「客户 Client」「总包 Main-con」「总包 Main Con」…),
   同一个角色有两种写法,筛选里就出现两个「总包」。现在统一存键;
   「客户」改名为「发展商 / Developer」。手填的「其他」角色仍存原文。 */

export type ContactRoleKey = 'developer' | 'maincon' | 'architect' | 'landscape' | 'interior' | 'creative';

export const CONTACT_ROLES: { key: ContactRoleKey; zh: string; en: string }[] = [
  { key: 'developer', zh: '发展商', en: 'Developer' },
  { key: 'maincon', zh: '总包', en: 'Main contractor' },
  { key: 'architect', zh: '建筑师', en: 'Architect' },
  { key: 'landscape', zh: '景观', en: 'Landscape' },
  { key: 'interior', zh: '室内', en: 'Interior' },
  { key: 'creative', zh: '创意', en: 'Creative' },
];
const BY_KEY = new Map(CONTACT_ROLES.map((r) => [r.key as string, r]));

/* 旧数据里存过的写法 → 键(上线时一次性改;回退脚本反过来) */
export const LEGACY_ROLE: Record<string, ContactRoleKey> = {
  '客户 Client': 'developer',
  '总包 Main-con': 'maincon',
  '总包 Main Con': 'maincon',
  '建筑师 Architect': 'architect',
  '景观 Landscape': 'landscape',
  '室内 Interior': 'interior',
  '创意 Creative': 'creative',
};
/* 回退用:每个键还原成旧版本认得的那一种写法 */
export const ROLE_TO_LEGACY: Record<ContactRoleKey, string> = {
  developer: '客户 Client', maincon: '总包 Main-con', architect: '建筑师 Architect',
  landscape: '景观 Landscape', interior: '室内 Interior', creative: '创意 Creative',
};

/* 显示用的双语名(1010 确认:两种界面语言都显示「Developer / 发展商」) */
export const roleBilingual = (r: { zh: string; en: string }) => `${r.en} / ${r.zh}`;

/* 认得的写法(键、旧标签、中文名、英文名、双语名,不分大小写)→ 键;认不出的(手填)原样返回 */
export function roleKeyOf(v: string | undefined | null): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (BY_KEY.has(s)) return s;
  if (LEGACY_ROLE[s]) return LEGACY_ROLE[s];
  const low = s.toLowerCase().replace(/\s*\/\s*/g, ' / ');
  for (const r of CONTACT_ROLES) {
    const names = [r.zh, r.en, roleBilingual(r), `${r.zh} / ${r.en}`].map((x) => x.toLowerCase());
    if (names.includes(low)) return r.key;
  }
  if (low === '客户' || low === 'client' || low === 'main con' || low === 'main-con' || low === 'maincon') return low.startsWith('main') ? 'maincon' : 'developer';
  return s;
}

export const isRoleKey = (v: string): v is ContactRoleKey => BY_KEY.has(v);

/* 显示:键 / 旧标签 → 双语名「Developer / 发展商」(1010 确认:中英界面都这样显示,CSV 也是);
   手填的原样。lang 留着给以后单独显示一种语言时用 */
export function contactRoleLabel(v: string, _lang?: 'zh' | 'en'): string {
  const k = roleKeyOf(v);
  const r = BY_KEY.get(k);
  return r ? roleBilingual(r) : v;
}

/* 是不是发展商(原「客户」)那一条 */
export const isDeveloperRole = (v: string | undefined | null) => roleKeyOf(v) === 'developer';

/* 上线迁移 / 回退共用:把一个项目的联系人角色换一遍,返回改了哪些 */
export function remapContactRoles(contacts: { role?: string }[] | undefined, map: (role: string) => string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const c of contacts || []) {
    const from = String(c.role ?? '');
    const to = map(from);
    if (to !== from) { c.role = to; out.push({ from, to }); }
  }
  return out;
}
/* 上线:只换认得的旧标签(手填的「其他」不动) */
export const toRoleKey = (r: string) => LEGACY_ROLE[r.trim()] ?? r;
/* 回退:键 → 旧版本认得的标签 */
export const toLegacyRole = (r: string) => (isRoleKey(r) ? ROLE_TO_LEGACY[r] : r);
