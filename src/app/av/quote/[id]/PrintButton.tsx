'use client';

export default function PrintButton() {
  return <button className="no-print btn-navy" onClick={() => window.print()}>打印 / 另存为 PDF</button>;
}
