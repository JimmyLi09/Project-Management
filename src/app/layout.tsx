import type { Metadata } from 'next';
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
