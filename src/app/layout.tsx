import type { Metadata } from 'next';
/* 字体本地打包(@fontsource,版本锁定;woff2 由 Next 打进 /_next/static/media,不连外网)。
   字重和以前从 Google Fonts 引的一样:Inter 400 / 500 / 600 / 700,Noto Sans SC 400 / 500 / 700。
   中文字体按 unicode-range 分片,浏览器只下载页面上用到的那几片。 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-sans-sc/700.css';
import './globals.css';
import { LangProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Audax · 项目协作台 Project Platform',
  description: 'Audax Project Collaboration Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
