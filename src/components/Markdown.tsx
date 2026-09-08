'use client';

import React from 'react';
import { parseMarkdown, safeHref, type Block, type Inline } from '@/lib/kb';

/* ===== REQ-035: 把知识库正文渲染出来 =====
   解析结果是结构化的块,这里逐个渲染成真实的 React 元素 ——
   全程没有 dangerouslySetInnerHTML,所以正文里写 <script> 只会显示成文字。
   知识库是「有编辑权的人写、全公司同事看」,存 HTML 等于开一个储存型 XSS 的口子,
   这条底线和公式字段不用 eval 是同一个理由。 */
export default function Markdown({ src }: { src: string }) {
  const blocks = React.useMemo(() => parseMarkdown(src), [src]);
  return <div className="md-doc">{blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>;
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case 'h': {
      const size = [0, 22, 18.5, 16, 14.5, 13.5, 13][b.level] || 14;
      const Tag = (`h${Math.min(b.level + 1, 6)}`) as 'h2';
      return <Tag style={{ fontSize: size, fontWeight: 700, color: 'var(--navy900)', margin: b.level <= 2 ? '22px 0 8px' : '16px 0 6px' }}><Inl kids={b.kids} /></Tag>;
    }
    case 'p':
      return <p style={{ fontSize: 13.5, lineHeight: 1.85, margin: '0 0 12px' }}><Inl kids={b.kids} /></p>;
    case 'ul':
      return <ul style={listStyle}>{b.items.map((it, i) => <li key={i} style={liStyle}><Inl kids={it} /></li>)}</ul>;
    case 'ol':
      return <ol style={listStyle}>{b.items.map((it, i) => <li key={i} style={liStyle}><Inl kids={it} /></li>)}</ol>;
    case 'quote':
      return (
        <blockquote style={{ margin: '0 0 12px', padding: '8px 14px', borderLeft: '3px solid var(--bronze)', background: 'var(--hover-bg)', fontSize: 13, color: 'var(--text2)' }}>
          <Inl kids={b.kids} />
        </blockquote>
      );
    case 'code':
      return (
        <pre style={{ margin: '0 0 14px', padding: '12px 14px', background: '#f5f7fa', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12.5, lineHeight: 1.65, overflowX: 'auto' }}>
          <code>{b.v}</code>
        </pre>
      );
    case 'img':
      return (
        <figure style={{ margin: '0 0 14px' }}>
          <img src={b.src} alt={b.alt} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
          {b.alt && <figcaption style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 5 }}>{b.alt}</figcaption>}
        </figure>
      );
    case 'hr':
      return <hr style={{ border: 0, borderTop: '1px solid var(--row-line)', margin: '20px 0' }} />;
    case 'table':
      return (
        /* 宽表格自己横向滚动,不让整页跟着横滚 */
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table className="md-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 360 }}>
            <thead>
              <tr>{b.head.map((c, i) => <th key={i} style={{ ...td, background: '#f0f2f5', fontWeight: 700 }}><Inl kids={c} /></th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>{b.head.map((_, j) => <td key={j} style={td}><Inl kids={r[j] || []} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function Inl({ kids }: { kids: Inline[] }) {
  return (
    <>
      {kids.map((k, i) => {
        if (k.t === 'b') return <b key={i}>{k.v}</b>;
        if (k.t === 'i') return <i key={i}>{k.v}</i>;
        if (k.t === 'code') return <code key={i} style={{ background: '#f0f2f5', padding: '1px 5px', borderRadius: 4, fontSize: '.92em' }}>{k.v}</code>;
        if (k.t === 'link') {
          /* href 已在解析时过滤过,这里再挡一次 —— 两道都在,漏一道也不至于出事 */
          if (!safeHref(k.href)) return <span key={i}>{k.v}</span>;
          return <a key={i} href={k.href} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--info)' }}>{k.v}</a>;
        }
        return <span key={i}>{k.v}</span>;
      })}
    </>
  );
}

const listStyle: React.CSSProperties = { margin: '0 0 12px', paddingLeft: 22, fontSize: 13.5, lineHeight: 1.85 };
const liStyle: React.CSSProperties = { marginBottom: 3 };
const td: React.CSSProperties = { border: '1px solid var(--border)', padding: '7px 10px', fontSize: 12.5, textAlign: 'left', verticalAlign: 'top' };
