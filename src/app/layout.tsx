import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Audax · 项目协作台',
  description: 'Audax Project Collaboration Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
