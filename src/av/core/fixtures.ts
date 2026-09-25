/* ===== Calibration fixtures — the nine real projects of §7.3 =====

   `recorded` is what the company's 《All the Project Links 统计表》 holds today;
   `doc` is the "算出" column as printed in §7.3 of the spec. Both are kept
   verbatim so the acceptance tests can show where the system agrees with the
   record, where it corrects it, and where the spec is inconsistent with itself.

   These fixtures also back the in-app 系数校准台: changing a coefficient
   re-runs all nine immediately. */

import type { LedConfig, ScreenType, Size } from './types.ts';

export interface Fixture {
  id: string;
  name: string;
  L: number;
  H: number;
  pitch: number;
  mod?: Size;              // when the product is not the profile's 320×160
  cabLib?: Size[];
  cabinet?: Size;
  screenType?: ScreenType;
  recorded: {
    sqm: number;           // 表内面积 ㎡
    mods: number | null;   // 表内模组数；null = 表内无值
    kw: number;            // 表内功耗 kW
    powerCable: number;    // 表内 Power Cable 根数（含 1 备用）
    dataCable: number;     // 表内数据线根数
  };
  /* §7.3 "算出" column. */
  doc: { powerCable: number; dataCable: number };
  /* §7.3 note: 模组数在表内是手填值，不参与模组口径统计。 */
  modsHandEntered?: boolean;
  /* §7.3's data-cable "算出" figure reproduces on the whole-screen reading for
     every project but these two, where the printed figure matches neither
     reading. See docs/requirements/010-LED方案成本平台-确定性计算内核.md §6. */
  docDataInconsistent?: boolean;
  note?: string;
}

const C600: Size[] = [[600, 337.5], [600, 675], [300, 337.5]];

export const FIXTURES: Fixture[] = [
  { id: '144', name: '144-Chuan Grove', L: 4480, H: 2560, pitch: 2,
    recorded: { sqm: 11.47, mods: 224, kw: 5.73, powerCable: 4, dataCable: 3 },
    doc: { powerCable: 4, dataCable: 6 } },
  { id: '143', name: '143-Royal Plaza', L: 5440, H: 3040, pitch: 2,
    recorded: { sqm: 16.54, mods: 323, kw: 8.27, powerCable: 5, dataCable: 7 },
    doc: { powerCable: 5, dataCable: 8 } },
  { id: '132', name: '132-River Opus', L: 5120, H: 2880, pitch: 2.5,
    recorded: { sqm: 14.75, mods: 288, kw: 7.37, powerCable: 4, dataCable: 4 },
    doc: { powerCable: 4, dataCable: 5 } },
  { id: '148', name: '148-Dairy Farm', L: 5120, H: 2880, pitch: 2.5,
    recorded: { sqm: 14.75, mods: 288, kw: 7.37, powerCable: 4, dataCable: 4 },
    doc: { powerCable: 4, dataCable: 5 } },
  { id: '146', name: '146-OLR', L: 10560, H: 3200, pitch: 1.25,
    recorded: { sqm: 33.79, mods: 660, kw: 16.90, powerCable: 10, dataCable: 39 },
    doc: { powerCable: 8, dataCable: 39 } },
  { id: '147', name: '147-Senja Close', L: 8320, H: 2720, pitch: 1.86,
    recorded: { sqm: 22.63, mods: 442, kw: 11.32, powerCable: 7, dataCable: 13 },
    doc: { powerCable: 6, dataCable: 12 } },
  { id: '128', name: '128-C&K T1', L: 1800, H: 1012.5, pitch: 1.56,
    mod: [300, 168.75], cabLib: C600, cabinet: [600, 337.5],
    recorded: { sqm: 1.82, mods: 36, kw: 0.91, powerCable: 1, dataCable: 2 },
    doc: { powerCable: 2, dataCable: 1 }, docDataInconsistent: true },
  { id: '131', name: '131-Guoco Lentor', L: 3660, H: 2058, pitch: 1.9,
    recorded: { sqm: 7.53, mods: 288, kw: 3.77, powerCable: 3, dataCable: 3 },
    doc: { powerCable: 3, dataCable: 4 }, modsHandEntered: true, note: '改造复用' },
  { id: '021', name: '021-Nafa', L: 10000, H: 7950, pitch: 6.25,
    recorded: { sqm: 79.50, mods: null, kw: 39.75, powerCable: 32, dataCable: 4 },
    doc: { powerCable: 17, dataCable: 5 }, modsHandEntered: true,
    docDataInconsistent: true, note: '全息屏 · 特例，不参与吻合度统计' },
];

export function fixtureConfig(f: Fixture): LedConfig {
  return {
    led_opening_w: f.L,
    led_opening_h: f.H,
    led_screen_type: f.screenType ?? 'in_fixed',
    led_pitch: f.pitch,
    led_cabinet: f.cabinet ?? [640, 480],
    led_mod: f.mod,
    led_cab_lib: f.cabLib,
    led_refresh: 3840,
    led_nits: 800,
    led_install: 'steel',
    led_maintain: 'front',
    led_redundancy: 'sender_1plus1',
    led_ctrl_brand: 'novastar',
    led_power_cable: '3*2.5',
  };
}

/* The whole-screen data-cable reading (total pixels ÷ data_px, ceil). It is NOT
   the normative F8: the per-row reading of §5/§7.2/§6.3 was confirmed as the
   standard on 2026-09-25. It is kept only because §7.3's printed "算出" column
   was produced with it, so the regression report can still compare old records. */
export const wholeScreenRuns = (px: number, dataPx: number) => Math.ceil(px / dataPx);
