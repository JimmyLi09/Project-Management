/* ===== Service catalogue, lifecycle, difficulty & production templates =====
   Ported verbatim from the validated prototype v9 (real Audax production data). */

import type { Stage } from './types';

export const SVC: Record<string, { label: string; en: string; color: string; tpl?: boolean }> = {
  cgi: { label: 'CGI 静帧', en: 'CGI', color: '#2C7A7B', tpl: true },
  ani: { label: '动画', en: 'Animation', color: '#6B4E9E', tpl: true },
  scale: { label: '沙盘模型', en: 'Scale Model', color: '#3F7A4E', tpl: true },
  website: { label: '网站', en: 'Website', color: '#3767A6' },
  vrar: { label: '3D VR/720', en: '3D VR / 720', color: '#8E44AD', tpl: true },
  matterport: { label: 'Matterport', en: 'Matterport', color: '#1F8A70' },
  led: { label: 'LED', en: 'LED', color: '#C0392B', tpl: true },
  projector: { label: '投影', en: 'Projector', color: '#B9770E', tpl: true },
  tv: { label: 'TV', en: 'TV', color: '#2C3E50' },
  saleskit: { label: 'Sales Kit', en: 'Sales Kit', color: '#2E86AB', tpl: true },
  unitmodel: { label: '单元模型', en: 'Unit Model', color: '#2E7D6B', tpl: true },
  drone: { label: '无人机', en: 'Drone', color: '#566573' },
  maxhub: { label: 'MAXHUB', en: 'MAXHUB', color: '#117A65' },
  lightbox: { label: '灯箱', en: 'Lightbox', color: '#CA9A2C' },
  av: { label: 'AV', en: 'AV', color: '#6C3483' },
  brochure: { label: '宣传册', en: 'Brochure', color: '#A04000' },
  video: { label: '视频拍摄', en: 'Video Shooting', color: '#884EA0' },
  interior: { label: '室内设计', en: 'Interior Design', color: '#B7950B' },
  renovation: { label: '翻新', en: 'Renovation', color: '#7E5109' },
  others: { label: '其他', en: 'Others', color: '#7F8C8D' },
};
export const svcColor = (k: string) => SVC[k]?.color || '#7F8C8D';
export const svcLabel = (k: string) => SVC[k]?.label || k;
export const svcName = (k: string, lang: 'zh' | 'en') =>
  lang === 'en' ? SVC[k]?.en || k : SVC[k]?.label || k;

export const STAGES: [Stage, string, string][] = [
  ['presales', '售前', 'Presales'],
  ['handover', '交接PM', 'Handover to PM'],
  ['progress', '进行中', 'In progress'],
  ['complete', '完成', 'Complete'],
  ['invoice', '开票/收尾', 'Invoice / VO'],
];
export const stageIdx = (s: string) => Math.max(0, STAGES.findIndex((x) => x[0] === s));
export const stageColor = (s: string) =>
  ({ presales: '#8E7CC3', handover: '#D98A2B', progress: '#2C6E8F', complete: '#3F7A4E', invoice: '#16293B' }[s] || '#888');

export const DIFF: Record<string, [string, number]> = {
  easy: ['简单 Easy', 1],
  medium: ['中等 Medium', 2],
  hard: ['较难 Hard', 3],
  complex: ['复杂 Complex', 5],
};
export const diffPoints = (d: string) => (DIFF[d] ? DIFF[d][1] : 1);

/* Template row: [no, phase, task, taskEn, owner, weeks, typical, gate, freeze] */
export type TplScheduleRow = [string, string, string, string, string, number, string, string, boolean];
/* Template checklist group: [group, groupEn, color, items[[zh,en]]] */
export type TplChecklistGroup = [string, string, string, [string, string][]];
export interface Template {
  schedule: TplScheduleRow[];
  checklist: TplChecklistGroup[];
}

export const GENERIC: Template = {
  schedule: [
    ['1', '信息', '信息收集 / 需求确认', 'Info & brief', 'PM', 1, '—', ' ', false],
    ['2', '制作', '制作 / 执行', 'Production', 'Team', 2, '—', ' ', false],
    ['3', '审阅', '客户审阅(含修改)', 'Client review (with revisions)', 'PM / Client', 1, '—', ' ', false],
    ['4', '交付', '交付 / 签收', 'Delivery & sign-off', 'PM', 1, '—', '★ 交付前核对需求', true],
  ],
  checklist: [
    ['需求信息', 'Required Info', '#2C6E8F', [['需求 / 规格', 'Requirements / spec'], ['素材 / 参考', 'Assets / reference'], ['截止日', 'Deadline']]],
  ],
};

export const TPL: Record<string, Template> = {
  cgi: {
    schedule: [
      ['0', '信息 Info', '信息收集(见信息清单)', 'Collect all info — clock starts when complete', 'Client / All', 0, '—', '★ 排期从此起算 Schedule starts here', true],
      ['1', '建模', '搭建 3D 建筑模型', 'Build 3D architectural model', 'Audax', 2, '1–2 周', ' ', false],
      ['2', '角度', '出角度草图,客户审阅(含2–3轮)', 'Angle drafts (incl. 2–3 rounds)', 'Audax / Client', 4, '3–4 周', '★ 冻结①:出细节前先锁角度 Lock angles', true],
      ['3', '灯光材质', '灯光/材质渲染草图(含2–3轮)', 'Lighting & material draft (2–3 rounds)', 'Audax / Client', 3, '2–3 周', '★ 冻结②:全渲染前发「公司政策」邮件', true],
      ['4', '后期', '合成/调色/配景(含2–3轮)', 'Compositing, grading, entourage', 'Audax', 3, '2–3 周', '此后不接受重建模/大改', false],
      ['5', '交付', '导出成品格式,客户签收', 'Final export + sign-off', 'Audax / PM', 1, '—', '★ 对照信息清单逐项 QC', true],
    ],
    checklist: [
      ['建筑方 · 外观', 'From Architect (Exterior)', '#D98A2B', [
        ['Siteplan / google map', '建周边建筑'],
        ['最终 CAD + 3D 模型', '至少 WP approval'],
        ['立面材料分区 + 色号 + 参考', 'Façade demarcation + colour code'],
        ['建筑灯光信息 + 参考', 'Building lighting info + ref'],
        ['Key plan 标注单元号', 'unit number labels'],
        ['会所/健身房室内材料 + 家具', 'Clubhouse & gym indoor material'],
      ]],
      ['景观方 · 外观', 'From Landscape (Exterior)', '#3F7A4E', [
        ['景观平面(材料/种植/家具)', 'Landscape plan'],
        ['种植布局(灌木/乔木)+ 参考', 'Planting layout + ref'],
        ['景观材料(色/尺寸/排布)+ 参考', 'Landscape material + ref'],
        ['灯光布局 + 灯具 + 参考', 'Lighting layout + ref'],
        ['户外家具/健身/儿童设施 + 参考', 'Outdoor furniture + ref'],
        ['场地竖向(详细标高)', 'Site levelling'],
        ['详图(泳池/凉亭/景观区)', 'Details drawing'],
        ['彩色总平 标注设施名', 'Colour site plan'],
      ]],
      ['建筑方 · 室内/单元', 'From Architect (Interior/Unit)', '#B26A2E', [
        ['选定单元平面 + 3D 模型', 'Unit floor plan & 3d model'],
        ['木作立面', 'Elevation for carpentry'],
        ['地墙砖排布 + 参考', 'Tiles arrangement + ref'],
        ['天花平面含标高(空调/风口)', 'Ceiling plans (AC & vent)'],
        ['洁具/给排水配置表', 'Sanitary & plumbing schedule'],
        ['电位/开关立面 + 参考', 'Electrical points + ref'],
        ['衣柜详图(厨房/卧室)', 'Wardrobe detail'],
        ['主卫及全部卫浴详图', 'Bathroom details'],
        ['单元材料 + 参考', 'Unit material + ref'],
      ]],
      ['ID 方 · 室内', 'From ID (Interior)', '#6B4E9E', [
        ['设计概念/方案提报', 'Design concept / proposal'],
        ['家具布局 + 软装参考', 'Furniture layout + images'],
      ]],
    ],
  },
  ani: {
    schedule: [
      ['0', '需求', '确认flythrough时长/分镜/特效/音乐/字体/航拍/截止日', 'Confirm flythrough, storyboard, media, music, font, drone, deadline', 'Client / Sales', 0, '—', '★ 视角数=工作量;排期从此起算', true],
      ['1', '分镜', '确认卖点/时长/情绪板+参考/logo/音乐;与深圳对齐', 'Confirm selling point, mood+ref, logo, music; align SZ', 'Audax / SZ / Client', 1, '1 周', '备注:不建议加人物', false],
      ['2', '建模', '搭建 3D 模型', 'Build 3D model', 'Audax / SZ', 2, '1–2 周', ' ', false],
      ['3', '相机路径', '线框相机路径预览审阅(含2–3轮)', 'Camera-path preview (2–3 rounds)', 'Audax / SZ / Client', 3, '2–3 周', '★ 路径改动影响全部下游,确认后冻结', true],
      ['4', '配景', '加树木/人/景观/灯光/材质(含2–3轮)', 'Entourage (2–3 rounds)', 'Audax / SZ', 4, '3–4 周', ' ', false],
      ['5', '最终高清', '静帧确认后出高清动画', 'Hi-res animation after still-frame confirm', 'Audax / SZ', 1, '1 周+', '★ 后期后不接受大改模型/角度', true],
    ],
    checklist: [
      ['建筑方', 'From Architect', '#D98A2B', [
        ['确认 3D 模型 & CAD', 'Confirmed 3d model & cad'],
        ['建筑材料 + 色号', 'Material + colour code'],
        ['衣柜/厨房/卫浴详图', 'Wardrobe, kitchen & bathroom'],
      ]],
      ['景观方', 'From Landscape', '#3F7A4E', [
        ['景观图 + 详图', 'Landscape drawing & detail'],
        ['景观材料', 'Material of landscape'],
        ['家具与设备', 'Furniture & equipment'],
      ]],
      ['ID 方', 'From ID Designer', '#6B4E9E', [
        ['单元平面 + 设计布局', 'Unit plan & layout'],
        ['家具设计', 'Furniture design'],
      ]],
      ['销售/需求', 'From Sales / Brief', '#2C6E8F', [
        ['确认视角数量(外观/室内)', 'Number of views'],
        ['最终截止日', 'Final deadline'],
      ]],
    ],
  },
  scale: {
    schedule: [
      ['0', '信息', '建筑方提供mock-up所需景观+建筑信息', 'Architect provides landscape + arch info', 'Architect', 1, '1 周', '★ 排期从确认信息起算', true],
      ['1', '打样', 'mock-up模型+材料样板(1st/2nd;立面色号待定)', 'Mock-up + material sample', 'Audax / Client', 2, '1–2 周', '★ 材料/处理/灯光在此定案', true],
      ['2', '底座', '确认底座尺寸/边界/维修口;出1:1模板', 'Base size/boundary; 1:1 template', 'Audax / Client', 1, '≤1 周', ' ', false],
      ['3', '主体结构', '楼板确认后主体结构制作', 'Main structure fab', 'Audax / SZ', 3, '2–3 周', '★ 立面色号最终确认才进立面', true],
      ['4', '立面', '切割/喷涂 建筑立面+裙楼', 'Cutting/spraying elevation & podium', 'Audax / SZ', 4, '4 周', ' ', false],
      ['5', '景观', '地形/硬景/软景/细节', 'Terrain, hardscape, softscape', 'Audax / SZ', 3, '3 周', ' ', false],
      ['6', '工厂验看', '工厂验看/审阅', 'Factory visiting & review', 'PM / Client', 0.5, '2–3 天', ' ', false],
      ['7', '检查修改', '拍照/现场检查+修改', 'Photo/inspection + modification', 'Audax', 1, '≈5 天', ' ', false],
      ['8', '运输', '打包+运输', 'Packing & shipping', 'Audax / Sales', 2, '1–2 周', '★ 海外:装箱前客户签收+备足余料', true],
      ['9', '安装移交', '现场安装+补漆+移交', 'Onsite install & handover', 'Audax', 2, '1–2 周', '注意各国插座', false],
    ],
    checklist: [
      ['场地/市场/需求', 'Site / Marketing / Requirements', '#2C6E8F', [
        ['比例 Scale', '1:150 / 1:1000'],
        ['模型类型', 'study/marketing/location'],
        ['是否需 App 控制', 'lighting/AR'],
        ['特殊要求', 'water/smoke/mechanism'],
        ['场地边界', 'Site boundary'],
        ['标题牌', 'logos, north arrow, scale'],
        ['模型台信息', 'base dim, access panel, power'],
        ['周边地标/道路名', 'landmark / road name'],
        ['单元命名/灯光逻辑/UI配色', 'if app'],
        ['Mock-up 部位决定', 'inform client first'],
      ]],
      ['建筑方', 'From Architect', '#D98A2B', [
        ['CAD vs SKP 以哪个为准', 'Info accuracy'],
        ['最终 CAD + SKP + 平面/立面/屋顶', 'Final drawings'],
        ['立面:色号/玻璃/门窗框/分区', 'Façade full spec'],
        ['门窗表', 'Window & door schedule'],
        ['阳台地面铺贴 + 参考', 'Balcony floor finish'],
        ['单元号(可最后)', 'Unit number'],
        ['内墙结构 / 颜色', 'Internal wall'],
        ['玻璃样板色', 'Glass sample colour'],
        ['售楼处门尺寸', 'Sales gallery door size'],
      ]],
      ['景观方', 'From Landscape (consultant)', '#3F7A4E', [
        ['种植布局 + 参考', 'Planting layout + ref'],
        ['景观材料(全规格)', 'Landscape material spec'],
        ['灯光布局 + 参考', 'Lighting plan + ref'],
        ['其他软装(家具/设备)', 'Other furnishing'],
        ['泳池/水景细节', 'Pool & water feature'],
        ['场地竖向', 'Site levelling'],
        ['彩色总平(可最后)', 'Colour site plan'],
      ]],
    ],
  },
  led: {
    schedule: [
      ['0', '需求 Info', '地址/联系人;屏幕尺寸类型(P3/P2.5);是否含铁架/电脑/音响;与ID及施工方确认LED/DB Box/电脑位置及时间节点', 'Requirements: address, contact, screen size/type, scope; fix positions & time nodes', 'Client / Main Con', 1, '—', '★ 排期从需求确认起算', true],
      ['1', '绘图确认', '定电源/电线/网线/音响规格数量,出线路图给Main con与电工;出铁架图,客户签字', 'Specs + circuit & frame drawing, client sign', 'Audax / Client', 1, '1 周', '★ 冻结:铁架图客户签字后方可下单', true],
      ['2', '下单发货', '业务部下单;海运约2-3周,需提前', 'Order; sea freight ~2-3 wk, order early', 'Sales / Audax', 3, '2-3 周', '提前下单以免误期', false],
      ['3', '安装铁架', '按现场进度安排铁架承包商进场', 'Contractor installs metal frame', 'Contractor', 0.5, '1-2 天', ' ', false],
      ['4', '布线', '施工方/电工跑电线/网线/音响线', 'Power/network/speaker cabling', 'Contractor / Elec', 0.5, '—', ' ', false],
      ['5', '检查线路', '现场检查铁架与线路,预留修改时间', 'Onsite check of frame & cabling', 'Audax / PM', 0.5, '—', ' ', false],
      ['6', '装屏+设备+测试', '装屏幕面板+电脑/音响,通电测试', 'Install panels + PC/speaker, power-on testing', 'Audax / SZ', 1, '1 周', '★ 测试须现场通电', true],
      ['7', '交接培训', '做用户手册,交接并培训开关机及常见问题', 'Handover + manual + training', 'Audax / PM', 0.5, '—', '★ 交接签收', true],
    ],
    checklist: [
      ['客户 / Main Con', 'From Client / Main Con', '#D98A2B', [
        ['项目地址 + 开发商/Main Con 联系人', 'Address + developer/Main Con contact'],
        ['屏幕尺寸与类型(P3/P2.5等)', 'Screen size & type'],
        ['是否含铁架/电脑/音响', 'Scope: frame/PC/speaker'],
        ['Showflat 图纸', 'Showflat drawings'],
        ['LED/DB Box/电脑 放置位置', 'LED/DB box/PC placement'],
        ['时间节点(装架/装屏/开盘)', 'Time nodes'],
      ]],
      ['现场 / 电工', 'From Site / Electrician', '#3F7A4E', [
        ['电源规格与位置', 'Power spec & location'],
        ['电线/网线/HDMI 布线', 'Power/network/HDMI cabling'],
        ['音响线', 'Speaker cabling'],
      ]],
      ['业务', 'From Sales', '#2C6E8F', [
        ['下单确认', 'Order confirmation'],
        ['发货 / 海运安排', 'Shipping / sea freight'],
      ]],
    ],
  },
  projector: {
    schedule: [
      ['0', '需求 Info', '地址/联系人;投屏尺寸/投影机型号;是否含电脑/音响/播放盒/无线投屏/雷达/融合/中控;现场进度与时间节点', 'Requirements incl. model, extras, blending, central control, time nodes', 'Client / Main Con', 1, '—', '★ 排期从需求确认起算', true],
      ['1', '绘图确认', '定投影位置,电源/网线/HDMI/音响规格数量,出图给Main con与电工', 'Position + specs + drawing', 'Audax / Client', 1, '1 周', '★ 冻结:图纸现场确认', true],
      ['2', '下单发货', '下单;发货安排', 'Order & shipping', 'Sales / Audax', 2, '—', ' ', false],
      ['3', '安装支架', '按投影机类型定支架(吊架/壁挂)并安装', 'Install bracket per projector type', 'Contractor', 0.5, '1-2 天', ' ', false],
      ['4', '布线检查', '跑电/网/HDMI/音响线并现场检查', 'Cabling + onsite check', 'Contractor / Elec', 0.5, '—', ' ', false],
      ['5', '装投影/电脑/音响', '安装投影机、电脑、音响', 'Install projector/PC/speaker', 'Audax / SZ', 1, '1 周', ' ', false],
      ['6', '测试调试', '测试与调试(含融合调试),现场通电', 'Testing & adjusting (incl. blending)', 'Audax / SZ', 1, '1 周', '★ 测试须现场通电', true],
      ['7', '交接培训', '拍照做用户手册,交接培训', 'Handover + manual + training', 'Audax / PM', 0.5, '—', '★ 交接签收', true],
    ],
    checklist: [
      ['客户 / Main Con', 'From Client / Main Con', '#D98A2B', [
        ['地址 + 联系人', 'Address + contact'],
        ['投屏尺寸要求', 'Projection size'],
        ['投影机型号', 'Projector model'],
        ['电脑/音响/播放盒/无线投屏/雷达', 'PC/speaker/box/wireless/radar'],
        ['是否融合 / 中控', 'Blending / central control'],
        ['时间节点', 'Time nodes'],
      ]],
      ['现场 / 电工', 'From Site / Electrician', '#3F7A4E', [
        ['电源/网线/HDMI/音响 规格数量', 'Power/network/HDMI/speaker specs'],
        ['布线', 'Cabling'],
      ]],
      ['业务', 'From Sales', '#2C6E8F', [
        ['下单', 'Order'],
        ['安装人员签证/机票(如国内安装)', 'Installer visa/flights if from China'],
      ]],
    ],
  },
  vrar: {
    schedule: [
      ['0', '需求 Info', '是否跟showflat风格/ID或我方提案/日间或夜间/是否航拍;顾问数量与截止日', 'Confirm styling, proposer, day/night, drone; consultants & deadline', 'Client / Sales', 1, '—', '★ 排期从确认信息起算', true],
      ['1', '建模', '按单元平面/天花图搭建 3D', 'Build 3D from unit plan/RCP', 'Audax', 2, '1-2 周', ' ', false],
      ['2', '材质', '套用材料表与立面材质', 'Apply material schedule & façade', 'Audax / Client', 2, '1-2 周', '★ 全渲染前确认材质', true],
      ['3', '灯光情绪', '按日/夜设定灯光与情绪', 'Lighting & mood (day/night)', 'Audax / Client', 2, '1-2 周', '★ 情绪确认', true],
      ['4', '渲染360', '渲染360全景(含2-3轮)', 'Render 360 panoramas (2-3 rounds)', 'Audax', 2, '2-3 周', ' ', false],
      ['5', '拼接交互', '拼接全景+搭建交互漫游', 'Stitch + interactive tour', 'Audax', 1, '1 周', ' ', false],
      ['6', '交付', '部署/交付,客户签收', 'Deploy / delivery + sign-off', 'Audax / PM', 0.5, '—', '★ 对照信息清单 QC', true],
    ],
    checklist: [
      ['建筑 / ID', 'From Architect / ID', '#D98A2B', [
        ['单元户型平面图', 'Unit type floor plan'],
        ['天花反射图(墙高/假天花)', 'Reflected ceiling plan'],
        ['非ID木作与固定件', 'Non-ID carpentry & fixtures'],
        ['材料表(饰面/铺贴方向)', 'Material schedule'],
        ['立面信息 Façade', 'Façade information'],
        ['ID处理 / FF&E 表', 'ID treatment / FF&E'],
        ['立面图 Elevations', 'Elevational drawings'],
      ]],
      ['需求 / 市场', 'Requirements', '#2C6E8F', [
        ['是否跟 showflat 风格', 'Follow showflat styling'],
        ['风格由 ID 或我方提案', 'Styling proposer'],
        ['日间 / 夜间设定', 'Day / night setting'],
        ['是否航拍(我方拍需申请license)', 'Drone footage (license if we shoot)'],
      ]],
    ],
  },
  saleskit: {
    schedule: [
      ['0', 'Briefing', '需求简报:确认交互方式与范围,与IT确认可实现性', 'Briefing: interaction scope & IT feasibility', 'Client / Sales', 1, '—', '★ 排期从Briefing确认起算', true],
      ['1', 'UI 设计草案', '依brochure风格/色/字体出UI草案', 'UI draft from brochure style', 'Audax / Client', 2, '1-2 周', '★ UI风格确认', true],
      ['2', '内容整合', '整合logo/字体、定位图、总平、立面、户型、360/720、图库、公司/免责信息', 'Integrate logo, maps, plans, 360/720, gallery, info', 'Audax', 2, '—', ' ', false],
      ['3', '交互开发', '与IT开发交互(动画/点击高亮/展开菜单)', 'Interactive build with IT', 'Audax / IT', 3, '2-3 周', '★ 交互定案', true],
      ['4', '测试', '在设备/MAXHUB上测试', 'Testing on device / MAXHUB', 'Audax', 1, '1 周', ' ', false],
      ['5', '交付部署', '部署到设备,客户签收', 'Deploy on device + sign-off', 'Audax / PM', 0.5, '—', '★ 客户签收', true],
    ],
    checklist: [
      ['整体 Overall', 'Overall', '#6B4E9E', [
        ['Logo 与字体', 'Logo & fonts'],
        ['宣传册(风格参考)', 'Brochure (style reference)'],
      ]],
      ['定位 Location', 'Location', '#2C6E8F', [
        ['定位地图工作文件', 'Location map working file'],
        ['航拍图带标注', 'Drone shot with labels'],
      ]],
      ['总平 Site Plan', 'Site Plan', '#3F7A4E', [
        ['总平工作文件', 'Site plan working file'],
        ['外观透视 / 720', 'Exterior perspectives / 720'],
      ]],
      ['户型 Floor Plan', 'Floor Plan', '#D98A2B', [
        ['立面表工作文件', 'Elevation chart working file'],
        ['户型平面', 'Floor plans'],
        ['360 单元', '360 units'],
        ['720 VR', '720 VR'],
      ]],
      ['图库 / 其他', 'Gallery / Others', '#B26A2E', [
        ['额外透视 / 视频', 'Additional perspectives / videos'],
        ['项目信息', 'Project info'],
        ['公司信息 + 免责声明', 'Company info + disclaimer'],
      ]],
    ],
  },
  unitmodel: {
    schedule: [
      ['0', '信息 Info', '收集室内信息(户型/天花/立面/材料/ID)', 'Collect interior info', 'Architect / ID', 1, '1 周', '★ 排期从确认信息起算', true],
      ['1', '打样', '按信息做材料板+不同色调选样;做局部模型审立面/窗/木作', 'Material board + tonality + partial model review', 'Audax / Client', 2, '1-2 周', '★ 材料/色调在此定案', true],
      ['2', '底座台', '确认模型台尺寸(按台面尺寸核对)', 'Confirm model stand table size', 'Audax / Client', 1, '≤1 周', ' ', false],
      ['3', '主体制作', '实际制作(mock-up确认后6-8周,不含运输);每阶段发进度照,切料前告知用料', 'Actual production (6-8 wk from mock-up)', 'Audax / SZ', 4, '4 周', ' ', false],
      ['4', '内饰细节', 'ID处理/FF&E/软装细节', 'ID treatment & FF&E detailing', 'Audax / SZ', 2, '2 周', ' ', false],
      ['5', '检查修改', '拍照/检查+修改', 'Photo/inspect + modification', 'Audax', 1, '≈5 天', ' ', false],
      ['6', '运输', '装箱前客户签收;备余料;核对运输单据', 'Sign-off before packing; excess material; docs', 'Audax / Sales', 2, '1-2 周', '★ 海外:装箱前签收', true],
      ['7', '安装移交', '现场安装(易损件/插座)+移交', 'Onsite install + handover', 'Audax', 1, '1-2 周', '注意各国插座', false],
    ],
    checklist: [
      ['建筑 / ID', 'From Architect / ID', '#D98A2B', [
        ['单元户型平面', 'Unit type floor plan'],
        ['天花反射图(墙高/假天花)', 'Reflected ceiling plan'],
        ['非ID木作与固定件(衣柜/台盆/洁具)', 'Non-ID carpentry & fixtures'],
        ['材料表(饰面/颜色/纹理/铺贴)', 'Material schedule'],
        ['ID处理 / FF&E 表', 'ID treatment / FF&E'],
        ['立面图', 'Elevational drawings'],
        ['玻璃色 / 墙色', 'Glass / wall colour'],
        ['室内材料分区', 'Interior material demarcation'],
      ]],
      ['需求', 'Requirements', '#2C6E8F', [
        ['比例 Scale(1:25/1:150等)', 'Scale'],
        ['灯光色调', 'Lighting tone'],
        ['仅FFE 或 FFE+ID处理', 'FFE only or FFE+ID'],
        ['模型台 Model stand table', 'Model stand table'],
      ]],
    ],
  },
};
