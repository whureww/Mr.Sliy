import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { useEditorFontSize } from '../../lib/editorPrefs';

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

/** 默认 13px 字号对应 21px 行高；字号缩放时行高等比取整，保证行号/高亮层对齐 */
const BASE_FONT = 13;
const BASE_LINE_H = 21;
const PAD_T = 10;

function langOf(path: string): string {
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : '';
  return EXT_LANG[ext] || 'clike';
}

/** 括号/引号自动配对表（quote 类在词中输入不自动补全） */
const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = new Set([')', ']', '}', '"', "'", '`']);
const QUOTES = new Set(['"', "'", '`']);
const INDENT_UNIT = '  ';

/** 对外暴露的编辑器命令（问题卡片跳转行等） */
export interface CodeEditorApi {
  /** 跳转到指定行（1-based，超界取最后一行），选中整行并滚动到可视区 */
  revealLine(line: number): void;
}

interface Props {
  /** 文件路径（用于语言识别与显示） */
  path: string;
  value: string;
  onChange?: (v: string) => void;
  /** Ctrl+S 触发 */
  onSave?: () => void;
  readOnly?: boolean;
  /** 行内 Diff：需要高亮标记的行号（1-based，绝对行号） */
  highlightLines?: number[];
  /** 右键菜单回调：附带输入层当前选中文本 */
  onContextMenu?: (e: React.MouseEvent, selection: string) => void;
}

/**
 * 代码编辑器：彩色语法高亮 + 行号 + 当前行高亮 + 任意行/句编辑。
 * 实现方式：唯一滚动容器内叠加「高亮层 pre」与「透明 textarea」，
 * 两者字体度量完全一致，光标与高亮彩色文字逐字符对齐。
 * 附：Ctrl+F 查找/替换（Enter/Shift+Enter 上下切换）、Ctrl+G 跳转行、
 * 括号/引号自动配对与跳过、Enter 自动缩进、成对退格删除、字号跟随设置。
 */
const CodeEditor = forwardRef<CodeEditorApi, Props>(function CodeEditor(
  { path, value, onChange, onSave, readOnly, highlightLines, onContextMenu },
  ref
) {
  useLang();
  const fontSize = useEditorFontSize();
  const lineH = Math.round((fontSize * BASE_LINE_H) / BASE_FONT);
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
      const y = PAD_T + line * lineH;
      if (y < vp.scrollTop) vp.scrollTop = Math.max(0, y - lineH);
      else if (y + lineH * 2 > vp.scrollTop + vp.clientHeight) vp.scrollTop = y + lineH * 2 - vp.clientHeight;
    }
  };

  /** 跳转到指定行（1-based，超界取最后一行），选中整行并滚动到可视区 */
  const revealLine = (lineNo: number) => {
    const n = Math.max(1, Math.min(lineNo, lines.length));
    let offset = 0;
    for (let i = 0; i < n - 1; i++) offset += lines[i].length + 1;
    revealOffset(offset, offset + (lines[n - 1]?.length || 0));
  };

  /** 对外暴露命令 */
  useImperativeHandle(ref, () => ({ revealLine }));

  /** 由光标位置计算所在行号，并保证光标行在可视区域内 */
  const trackCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    const line = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
    setCaretLine(line);

    const vp = viewportRef.current;
    if (vp) {
      const y = PAD_T + line * lineH;
      if (y < vp.scrollTop) vp.scrollTop = Math.max(0, y - lineH);
      else if (y + lineH * 2 > vp.scrollTop + vp.clientHeight) vp.scrollTop = y + lineH * 2 - vp.clientHeight;
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
      revealLine(n);
    }
    setGotoOpen(false);
  };

  /** 当前行前导空白（自动缩进用） */
  const lineIndent = (content: string, caret: number): string => {
    const ls = content.lastIndexOf('\n', caret - 1) + 1;
    const m = content.slice(ls, caret).match(/^[ \t]*/);
    return m ? m[0] : '';
  };

  /** 括号/引号自动配对、跳过与成对删除，Enter 自动缩进（execCommand 保留原生撤销栈） */
  const handleAutoPairs = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const ta = taRef.current;
    if (!ta || readOnly || e.ctrlKey || e.metaKey || e.altKey) return false;
    const content = ta.value;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const nextChar = content[start] || '';

    // Enter 自动缩进：继承当前行前导空白；{[ ( 后多缩一级；夹在成对括号间时补出中间行
    if (e.key === 'Enter') {
      if ((e.nativeEvent as KeyboardEvent).isComposing) return false;
      e.preventDefault();
      const indent = lineIndent(content, start);
      const prevChar = content[start - 1] || '';
      const inPair = PAIRS[prevChar] && PAIRS[prevChar] === nextChar;
      if (inPair) {
        document.execCommand('insertText', false, `\n${indent}${INDENT_UNIT}\n${indent}`);
        const mid = start + 1 + indent.length + INDENT_UNIT.length;
        ta.setSelectionRange(mid, mid);
      } else {
        const extra = PAIRS[prevChar] ? INDENT_UNIT : '';
        document.execCommand('insertText', false, `\n${indent}${extra}`);
      }
      trackCaret();
      return true;
    }

    // 成对退格：空选区且光标夹在配对字符之间 → 一次删两个
    if (e.key === 'Backspace') {
      if (start !== end || start === 0) return false;
      const prevChar = content[start - 1];
      if (PAIRS[prevChar] && PAIRS[prevChar] === nextChar) {
        e.preventDefault();
        ta.setSelectionRange(start - 1, start + 1);
        document.execCommand('delete');
        trackCaret();
        return true;
      }
      return false;
    }

    // 输入长度为 1 的可打印字符才参与配对
    if (e.key.length !== 1) return false;
    const ch = e.key;

    // 跳过同名闭合符：nextChar 已是闭合符 → 只移动光标
    if (CLOSERS.has(ch) && nextChar === ch && start === end) {
      e.preventDefault();
      ta.setSelectionRange(start + 1, start + 1);
      trackCaret();
      return true;
    }

    const closer = PAIRS[ch];
    if (!closer) return false;

    // 引号在紧邻词字符时不自动补全（避免把 "in" 打成 ""in）
    if (QUOTES.has(ch) && start === end && /\w/.test(nextChar)) return false;

    e.preventDefault();
    if (start !== end) {
      // 有选区：用配对符包裹选区
      const sel = content.slice(start, end);
      document.execCommand('insertText', false, ch + sel + closer);
      ta.setSelectionRange(start + 1, start + 1 + sel.length);
    } else {
      document.execCommand('insertText', false, ch + closer);
      ta.setSelectionRange(start + 1, start + 1);
    }
    trackCaret();
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 括号补全/自动缩进/成对删除
    if (handleAutoPairs(e)) return;
    // Tab → 插入两个空格（execCommand 保留原生撤销栈）
    if (e.key === 'Tab' && !readOnly) {
      e.preventDefault();
      document.execCommand('insertText', false, INDENT_UNIT);
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
    <div
      className="code-editor"
      style={{ '--ce-size': `${fontSize}px`, '--ce-lh': `${lineH}px` } as React.CSSProperties}
    >
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
          {/* 行内 Diff 标记：AI 修改涉及的行（绿条 + 淡绿底） */}
          {(highlightLines || []).map((ln) => (
            <div key={`m${ln}`} className="ce-line-mark" style={{ top: PAD_T + (ln - 1) * lineH }} />
          ))}
          {!readOnly && (
            <div className="ce-line-hl" style={{ top: PAD_T + caretLine * lineH }} />
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
});

export default CodeEditor;
