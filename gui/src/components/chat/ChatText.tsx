import { ReactNode } from 'react';
import { t, useLang } from '../../lib/i18n';

/** 聊天回复的轻量 Markdown 渲染：围栏代码块 / 行内代码 / 加粗 / 标题 / 列表 / 引用。
 *  不引第三方库；未闭合的 ``` 围栏按"到末尾"处理，兼容流式逐字输出。 */

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.92em',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 4,
  padding: '0 4px'
};

const codeBlockStyle: React.CSSProperties = {
  margin: '6px 0',
  padding: '9px 11px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 8,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.55,
  overflowX: 'auto',
  whiteSpace: 'pre'
};

const quoteStyle: React.CSSProperties = {
  margin: '4px 0',
  padding: '2px 10px',
  borderLeft: '3px solid var(--border-hairline)',
  color: 'var(--text-muted)'
};

const headingSize: Record<number, number> = { 1: 15.5, 2: 14.5, 3: 13.5, 4: 13 };

/** 行内格式：`code` 与 **bold** */
function inline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.charCodeAt(0) === 96) {
      parts.push(
        <code key={`${keyBase}c${i++}`} style={inlineCodeStyle}>
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(<strong key={`${keyBase}b${i++}`}>{tok.slice(2, -2)}</strong>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** 普通文本段：按行归组为段落 / 标题 / 列表 / 引用 */
function parsePlain(src: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = src.split('\n');
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let idx = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    const content = para.join('\n');
    out.push(
      <p key={`${keyBase}t${idx++}`} style={{ margin: '2px 0', whiteSpace: 'pre-wrap' }}>
        {inline(content, `${keyBase}t${idx}`)}
      </p>
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const cur = list;
    const items = cur.items.map((it, j) => (
      <li key={j} style={{ margin: '2px 0' }}>
        {inline(it, `${keyBase}l${idx}i${j}`)}
      </li>
    ));
    out.push(
      cur.ordered ? (
        <ol key={`${keyBase}l${idx++}`} style={{ margin: '4px 0', paddingLeft: 20 }}>
          {items}
        </ol>
      ) : (
        <ul key={`${keyBase}l${idx++}`} style={{ margin: '4px 0', paddingLeft: 20 }}>
          {items}
        </ul>
      )
    );
    list = null;
  };

  for (const line of lines) {
    const t = line.trim();
    const h = /^(#{1,4})\s+(.+)$/.exec(t);
    const ul = /^[-*]\s+(.+)$/.exec(t);
    const ol = /^\d+[.、)]\s+(.+)$/.exec(t);
    const bq = /^>\s?(.*)$/.exec(t);
    if (h) {
      flushPara();
      flushList();
      out.push(
        <div key={`${keyBase}h${idx++}`} style={{ fontWeight: 700, fontSize: headingSize[h[1].length], margin: '8px 0 3px' }}>
          {inline(h[2], `${keyBase}h${idx}`)}
        </div>
      );
    } else if (ul || ol) {
      flushPara();
      if (!list || list.ordered !== !!ol) {
        flushList();
        list = { ordered: !!ol, items: [] };
      }
      list.items.push((ul || ol)![1]);
    } else if (bq) {
      flushPara();
      flushList();
      out.push(
        <blockquote key={`${keyBase}q${idx++}`} style={quoteStyle}>
          {inline(bq[1], `${keyBase}q${idx}`)}
        </blockquote>
      );
    } else if (!t) {
      flushPara();
      flushList();
    } else {
      if (list) flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out;
}

export default function ChatText({ text, streaming }: { text: string; streaming?: boolean }) {
  useLang();
  const nodes: ReactNode[] = [];
  const fence = /```(\w*)[ \t]*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let bi = 0;
  let m: RegExpExecArray | null;

  const pushPlain = (src: string) => {
    if (src.trim()) nodes.push(...parsePlain(src, `s${bi}`));
  };

  while ((m = fence.exec(text)) !== null) {
    pushPlain(text.slice(last, m.index));
    nodes.push(
      <pre key={`k${bi++}`} className="selectable" style={codeBlockStyle}>
        {m[2].replace(/\n$/, '')}
      </pre>
    );
    last = m.index + m[0].length;
  }
  pushPlain(text.slice(last));

  return (
    <div style={{ whiteSpace: 'normal' }}>
      {nodes}
      {streaming && <span className="stream-cursor" title={t('ai.streaming')} />}
    </div>
  );
}
