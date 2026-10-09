/* ===== REQ-048 · 认出「还在用老流程」的排期 =====
   效果图和动画换了新默认阶段(templates.ts)。已有项目的排期不自动改,而是提示一次「要换成新阶段吗?」
   (沿用 REQ-047 的做法,动画也加上)。

   怎么认:看阶段名是不是某一版出厂模板的原样。不能只看阶段 id —— 从经典排期迁过来的阶段,
   id 是原来阶段行的 id,不是模板的。改过名、加过 / 删过阶段的,说明人动过,不再提示。
   比较前去掉空格、统一全角 / 半角标点,老数据两种写法都有。 */

const LEGACY: Record<string, string[][]> = {
  cgi: [
    /* REQ-047 之前的模板(经典排期) */
    ['信息收集(见信息清单)', '搭建 3D 建筑模型', '出角度草图,客户审阅(含2–3轮)', '灯光/材质渲染草图(含2–3轮)', '合成/调色/配景(含2–3轮)', '导出成品格式,客户签收'],
    /* REQ-040 日历排期的出厂阶段 */
    ['信息收集（见信息清单）', '搭建 3D 建筑模型', '出角度草图，客户审阅（含 2–3 轮）', '灯光 / 材质渲染草图（含 2–3 轮）', '合成 / 调色 / 配景（含 2–3 轮）', '导出成品格式，客户签收'],
    /* REQ-047 的 5 步 */
    ['信息收集：收到模型资料（见信息清单）', '白膜角度小样', '角度 shortlist + AI 效果图，确定角度与大效果（含 1–2 轮）', '带材质、模型的后期图（参考大效果，含 2–3 轮）', '导出成品格式，客户签收'],
  ],
  ani: [
    ['确认flythrough时长/分镜/特效/音乐/字体/航拍/截止日', '确认卖点/时长/情绪板+参考/logo/音乐;与深圳对齐', '搭建 3D 模型', '线框相机路径预览审阅(含2–3轮)', '加树木/人/景观/灯光/材质(含2–3轮)', '静帧确认后出高清动画'],
  ],
};

const norm = (s: string) => s
  .replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[，]/g, ',').replace(/[；]/g, ';').replace(/[：]/g, ':')
  .replace(/\s+/g, '');

/* 这一份排期的阶段是不是某一版老模板的原样(只有 CGI / 动画有新流程) */
export function isLegacyFlow(svc: string, stageNames: readonly string[]): boolean {
  const sets = LEGACY[svc];
  if (!sets || !stageNames.length) return false;
  const got = stageNames.map(norm);
  return sets.some((set) => set.length === got.length && set.every((n, i) => norm(n) === got[i]));
}

export const hasNewFlow = (svc: string) => !!LEGACY[svc];
