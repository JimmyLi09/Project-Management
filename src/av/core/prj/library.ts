/* ===== Projection · projector and lens library (AV-020 §3.5) =====
   First batch entered from the spec sheets JM sent on 2026-10-06. Prices are
   not here: they come with the equipment list and live in the price library
   (PR3); until then 06 shows「待报价」. The engine takes the library as an
   argument, so a library edited in the price library replaces this seed. */

export interface PrjLens {
  code: string;
  name: string;        // 中文名
  nameEn: string;
  throwMin: number;    // throw ratio = throw distance ÷ image width
  throwMax: number;
  ust?: boolean;       // ultra-short-throw: sits just above the image, no lens shift
}

export interface PrjProjector {
  code: string;
  name: string;
  lumens: number;
  resW: number;
  resH: number;
  watts: number;       // spec-sheet power draw
  kg: number;
  db: number;          // fan noise, normal mode
  shiftUp: number;     // vertical lens shift, fraction of image height
  shiftDown: number;
  lenses: PrjLens[];   // first one is the standard lens
  note?: string;
}

export type PrjLibrary = Record<string, PrjProjector>;

const SEEMILE_LENSES: PrjLens[] = [
  { code: 'std', name: '标配 1.07–1.7', nameEn: 'Standard 1.07–1.7', throwMin: 1.07, throwMax: 1.7 },
  { code: 'z057', name: '选配 0.57–1.0', nameEn: 'Optional 0.57–1.0', throwMin: 0.57, throwMax: 1.0 },
  { code: 'f046', name: '选配短焦 0.46', nameEn: 'Optional short throw 0.46', throwMin: 0.46, throwMax: 0.46 },
];

export const PRJ_LIBRARY_SEED: PrjLibrary = {
  GMZ501C: {
    code: 'GMZ501C', name: 'Panasonic PT-GMZ501C', lumens: 5000, resW: 1920, resH: 1200, watts: 385, kg: 11, db: 41,
    shiftUp: 0, shiftDown: 0,
    lenses: [{ code: 'std', name: '超短焦固定 0.235', nameEn: 'Fixed ultra-short throw 0.235', throwMin: 0.235, throwMax: 0.235, ust: true }],
  },
  BHZ611C: {
    code: 'BHZ611C', name: 'Panasonic PT-BHZ611C', lumens: 6200, resW: 1920, resH: 1200, watts: 370, kg: 6.9, db: 36,
    shiftUp: 0.44, shiftDown: 0,
    lenses: [{ code: 'std', name: '标配 1.09–1.77', nameEn: 'Standard 1.09–1.77', throwMin: 1.09, throwMax: 1.77 }],
    note: '中心亮度 6600 lm；水平位移 ±20%',
  },
  PU800: {
    code: 'PU800', name: 'Seemile SML-PU800', lumens: 8000, resW: 1920, resH: 1200, watts: 530, kg: 14, db: 38,
    shiftUp: 0.5, shiftDown: 0.5, lenses: SEEMILE_LENSES, note: '水平位移 ±10%；选配镜头型号待设备清单',
  },
  PU900: {
    code: 'PU900', name: 'Seemile SML-PU900', lumens: 9000, resW: 1920, resH: 1200, watts: 580, kg: 14, db: 38,
    shiftUp: 0.5, shiftDown: 0.5, lenses: SEEMILE_LENSES, note: '水平位移 ±10%；选配镜头型号待设备清单',
  },
};

export const lensOf = (p: PrjProjector, code: string): PrjLens => p.lenses.find((l) => l.code === code) ?? p.lenses[0];
