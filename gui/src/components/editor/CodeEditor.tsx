import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-markdown';
import './codeEditor.css';
import { t, useLang } from '../../lib/i18n';

/** 扩展名 → Prism 语言（markup/css/clike/javascript 由核心自带） */
const EXT_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', go: 'go', rs: 'rust',
  html: 'markup', htm: 'markup', xml: 'markup', vue: 'markup', svg: 'markup',
  css: 'css', scss: 'css', less: 'css',
  json: 'json', yml: 'yaml', yaml: 'yaml',
  sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', md: 'markdown'
};

const FONT_SIZE = 13;
const LINE_H = 21;
const PAD_T = 10;

function langOf(path: string): string {
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : '';
  return EXT_LANG[ext] || 'clike';
}

interface Props {
  /** 文件路径（用于语言识别与显示） */
  path: string;
  value: string;
  onChange?: (v: string) => void;
  /** Ctrl+S 触发 */
  onSave?: () => void;
  readOnly?: boolean;
  /** 右键菜单回调：附带输入层当前选中文本 */
  onContextMenu?: (e: React.MouseEvent, selection: string) => void;
}

/**
 * 代码编辑器：彩色语法高亮 + 行号 + 当前行高亮 + 任意行/句编辑。
 * 实现方式：唯一滚动容器内叠加「高亮层 pre」与「透明 textarea」，
 * 两者字体度量完全一致，光标与高亮彩色文字逐字符对齐。
 * 附：Ctrl+F 查找/替换（Enter/Shift+Enter 上下切换）、Ctrl+G 跳转行。
 */
export default function CodeEditor({ path, value, onChange, onSave, readOnly, onContextMenu }: Props) {
  useLang();
  const viewportRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const gotoInputRef = useRef<HTMLInputElement>(null);
  const scrollTopRef = useRef(0);
  const [caretLine, setCaretLine] = useState(0);

  /** 查找/替换/跳转 */
  const [findOpen, setFindOpen] = useState(false);
  const [replaceVisible, setReplaceVisible] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoText, setGotoText] = useState('');

  const lang = langOf(path);
  const grammar = (Prism.languages as Record<string, Prism.Grammar>)[lang] || Prism.languages.clike;

  const lines = useMemo(() => value.split('\n'), [value]);
  const html = useMemo(() => {
    try {
      return Prism.highlight(value, grammar, lang);
    } catch {
      return value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    }
  }, [value, grammar, lang]);

  /** 所有匹配项（大小写不敏感，字面量匹配）的起始偏移 */
  const matches = useMemo(() => {
    if (!findText) return [];
    const res: number[] = [];
    const hay = value.toLowerCase();
    const needle = findText.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) {
      res.push(i);
      i = hay.indexOf(needle, i + needle.length);
    }
    return res;
  }, [value, findText]);

  /** 查找词或内容变化时重置当前匹配序号 */
  useEffect(() => setMatchIndex(0), [findText, value]);

  /** 全局快捷键：Ctrl+F 查找、Ctrl+G 跳转行、Esc 关闭 */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setGotoOpen(false);
        setFindOpen(true);
        setTimeout(() => findInputRef.current?.select(), 0);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        setFindOpen(false);
        setGotoOpen(true);
        setTimeout(() => gotoInputRef.current?.select(), 0);
      } else if (e.key === 'Escape') {
        setFindOpen(false);
        setGotoOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  /** 行号槽纵向滚动同步（DOM 直写，避免滚动触发整树重渲） */
  const syncScroll = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    scrollTopRef.current = vp.scrollTop;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-vp.scrollTop}px)`;
  };

  /** 重渲染后恢复行号槽滚动位置 */
  useLayoutEffect(syncScroll);

  /** 将指定偏移滚动到可视区域并更新当前行号（end 存在时同时选中区间） */
  const revealOffset = (offset: number, end?: number) => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(offset, end ?? offset);
    const line = ta.value.slice(0, offset).split('\n').length - 1;
    setCaretLine(line);
    const vp = viewportRef.current;
    if (vp) {
      const y = PAD_T + line * LINE_H;
      if (y < vp.scrollTop) vp.scrollTop = Math.max(0, y - LINE_H);
      else if (y + LINE_H * 2 > vp.scrollTop + vp.clientHeight) vp.scrollTop = y + LINE_H * 2 - vp.clientHeight;
    }
  };

  /** 由光标位置计算所在行号，并保证光标行在可视区域内 */
  const trackCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    const line = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
    setCaretLine(line);

    const vp = viewportRef.current;
    if (vp) {
      const y = PAD_T + line * LINE_H;
      if (y < vp.scrollTop) vp.scrollTop = Math.max(0, y - LINE_H);
      else if (y + LINE_H * 2 > vp.scrollTop + vp.clientHeight) vp.scrollTop = y + LINE_H * 2 - vp.clientHeight;
    }
  };

  /** 跳转到第 i 个匹配（循环），并选中之 */
  const gotoMatch = (i: number) => {
    if (!matches.length || !findText) return;
    const n = matches.length;
    const idx = ((i % n) + n) % n;
    setMatchIndex(idx);
    revealOffset(matches[idx], matches[idx] + findText.length);
  };

  /** 替换当前选中的匹配项（execCommand 保留撤销栈），并跳到下一个 */
  const replaceCurrent = () => {
    const ta = taRef.current;
    if (!ta || readOnly || !findText) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const atMatch = matches.some((m) => m === start && start + findText.length === end);
    if (!atMatch) {
      gotoMatch(0);
      return;
    }
    document.execCommand('insertText', false, replaceText);
    setTimeout(() => gotoMatch(matchIndex), 0);
  };

  /** 全部替换（正则转义后大小写不敏感） */
  const replaceAll = () => {
    if (readOnly || !findText) return;
    const re = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    onChange?.(value.replace(re, replaceText));
  };

  /** 跳转到指定行（超界取最后一行），选中整行 */
  const gotoLine = () => {
    const n = parseInt(gotoText, 10);
    if (!isNaN(n) && n >= 1) {
      const line = Math.min(n, lines.length) - 1;
      let offset = 0;
      for (let i = 0; i < line; i++) offset += lines[i].length + 1;
      revealOffset(offset, offset + (lines[line]?.length || 0));
    }
    setGotoOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab → 插入两个空格（execCommand 保留原生撤销栈）
    if (e.key === 'Tab' && !readOnly) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
      return;
    }
    // Ctrl+S 保存
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      onSave?.();
    }
  };

  const currentSelection = (): string => {
    const ta = taRef.current;
    if (!ta) return '';
    return ta.value.slice(ta.selectionStart, ta.selectionEnd);
  };

  return (
    <div className="code-editor">
      {/* 行号槽 */}
      <div className="ce-gutter-wrap">
        <div ref={gutterRef} className="ce-gutter">
          {lines.map((_, i) => (
            <div key={i} className={`ce-ln${i === caretLine ? ' active' : ''}`}>
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* 滚动视口：唯一滚动容器，高亮层与输入层随内容同步滚动 */}
      <div ref={viewportRef} className="ce-viewport" onScroll={syncScroll}>
        <div className="ce-inner">
          {!readOnly && (
            <div className="ce-line-hl" style={{ top: PAD_T + caretLine * LINE_H }} />
          )}
          <pre className="ce-highlight" dangerouslySetInnerHTML={{ __html: html + '\n' }} />
          <textarea
            ref={taRef}
            className="ce-input"
            value={value}
            readOnly={readOnly}
            spellCheck={false}
            wrap="off"
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={onKeyDown}
            onKeyUp={trackCaret}
            onClick={trackCaret}
            onSelect={trackCaret}
            onContextMenu={(e) => onContextMenu?.(e, currentSelection())}
          />
        </div>
      </div>

      {/* 查找/替换条（Ctrl+F） */}
      {findOpen && (
        <div className="ce-findbar">
          <div className="ce-find-row">
            <input
              ref={findInputRef}
              className="ce-find-input"
              placeholder={t('ed.findPh')}
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  gotoMatch(e.shiftKey ? matchIndex - 1 : matchIndex + 1);
                } else if (e.key === 'Escape') {
                  setFindOpen(false);
                }
              }}
            />
            <span className="ce-find-count">
              {findText ? (matches.length ? `${matchIndex + 1}/${matches.length}` : t('ed.noResults')) : ''}
            </span>
            <button className="ce-find-btn" title={`${t('ed.prev')} (Shift+Enter)`} onClick={() => gotoMatch(matchIndex - 1)}>↑</button>
            <button className="ce-find-btn" title={`${t('ed.next')} (Enter)`} onClick={() => gotoMatch(matchIndex + 1)}>↓</button>
            <button
              className="ce-find-btn"
              title={replaceVisible ? t('ed.hideReplace') : t('ed.showReplace')}
              style={replaceVisible ? { color: 'var(--accent)' } : undefined}
              onClick={() => setReplaceVisible((v) => !v)}
            >
              ⇄
            </button>
            <button className="ce-find-btn" title={`${t('win.close')} (Esc)`} onClick={() => setFindOpen(false)}>×</button>
          </div>
          {replaceVisible && (
            <div className="ce-find-row">
              <input
                className="ce-find-input"
                placeholder={t('ed.replaceWith')}
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    replaceCurrent();
                  } else if (e.key === 'Escape') {
                    setFindOpen(false);
                  }
                }}
              />
              <button className="ce-find-btn" disabled={readOnly} title={readOnly ? t('wb.locked') : t('ed.replaceOne')} onClick={replaceCurrent}>
                {t('ed.replace')}
              </button>
              <button className="ce-find-btn" disabled={readOnly} title={readOnly ? t('wb.locked') : t('ed.replaceAllTip')} onClick={replaceAll}>
                {t('ed.replaceAll')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 跳转行（Ctrl+G） */}
      {gotoOpen && (
        <div className="ce-findbar">
          <div className="ce-find-row">
            <input
              ref={gotoInputRef}
              className="ce-find-input"
              placeholder={t('ed.gotoPh', { n: lines.length })}
              value={gotoText}
              onChange={(e) => setGotoText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  gotoLine();
                } else if (e.key === 'Escape') {
                  setGotoOpen(false);
                }
              }}
            />
            <span className="ce-find-count">{t('ed.lines', { n: lines.length })}</span>
            <button className="ce-find-btn" onClick={gotoLine}>{t('ed.goto')}</button>
            <button className="ce-find-btn" title={`${t('win.close')} (Esc)`} onClick={() => setGotoOpen(false)}>×</button>
          </div>
        </div>
      )}
    </div>
  );
}
