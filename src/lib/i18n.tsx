'use client';

/* ===== Global ZH/EN language switch ===== */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'zh' | 'en';

interface LangStore {
  lang: Lang;
  setLang: (l: Lang) => void;
  /* t('中文', 'English') — pick by current language */
  t: (zh: string, en: string) => string;
  /* REQ-041 双语并排:排期任务 / 清单信息项 / 模板卡片这些**内容**,主语言
     下面还压一行另一种语言的小字。中文模式下默认开着(对着客户给的中文图纸
     干活时两边都看得见好核对),英文模式下默认收起来 —— 给客户看的时候
     下面挂一行中文不像话。两边都能用开关改,改过之后记住用户的选择。 */
  dual: boolean;
  setDual: (v: boolean) => void;
  /* 用户有没有自己动过这个开关(没动就跟着语言走) */
  dualPinned: boolean;
}

const Ctx = createContext<LangStore>({
  lang: 'zh', setLang: () => {}, t: (zh) => zh,
  dual: true, setDual: () => {}, dualPinned: false,
});

export const useLang = () => useContext(Ctx);

/* 没有用户选择时的默认值:中文并排、英文不并排 */
const defaultDual = (lang: Lang) => lang === 'zh';

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh');
  /* null = 用户没动过开关,跟着语言走 */
  const [dualPref, setDualPref] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('audax:lang');
      if (saved === 'en' || saved === 'zh') setLangState(saved);
      const d = localStorage.getItem('audax:dual');
      if (d === '1' || d === '0') setDualPref(d === '1');
    } catch { /* 隐私模式 / 禁用存储:全部按默认走 */ }
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('audax:lang', l); } catch { /* ignore */ }
  };

  const setDual = (v: boolean) => {
    setDualPref(v);
    try { localStorage.setItem('audax:dual', v ? '1' : '0'); } catch { /* ignore */ }
  };

  const store = useMemo<LangStore>(() => ({
    lang,
    setLang,
    t: (zh, en) => (lang === 'zh' ? zh : en),
    dual: dualPref ?? defaultDual(lang),
    setDual,
    dualPinned: dualPref !== null,
  }), [lang, dualPref]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
