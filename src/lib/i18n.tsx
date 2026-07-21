'use client';

/* ===== Global ZH/EN language switch ===== */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'zh' | 'en';

interface LangStore {
  lang: Lang;
  setLang: (l: Lang) => void;
  /* t('中文', 'English') — pick by current language */
  t: (zh: string, en: string) => string;
}

const Ctx = createContext<LangStore>({ lang: 'zh', setLang: () => {}, t: (zh) => zh });

export const useLang = () => useContext(Ctx);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh');

  useEffect(() => {
    const saved = typeof localStorage !== 'undefined' && localStorage.getItem('audax:lang');
    if (saved === 'en' || saved === 'zh') setLangState(saved);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('audax:lang', l); } catch { /* ignore */ }
  };

  const store = useMemo<LangStore>(() => ({
    lang,
    setLang,
    t: (zh, en) => (lang === 'zh' ? zh : en),
  }), [lang]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
