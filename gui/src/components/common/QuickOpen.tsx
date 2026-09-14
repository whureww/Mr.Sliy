import { useEffect, useMemo, useRef, useState } from 'react';
import { FileNode } from '../../ipc/client';
import { fuzzyScore } from '../../lib/fuzzyMatch';
import { t, useLang } from '../../lib/i18n';

/** 快速打开的文件条目 */
export interface QuickOpenItem {
  path: string;
  name: string;
}

interface Props {
  open: boolean;
  /** 递归收集工作区文件（由 Workbench 提供：listDir 递归遍历，跳过重目录） */
  collectFiles: (root: string) => Promise<QuickOpenItem[]>;
  workspacePath: string | null;
  onClose: () => void;
  onPick: (item: QuickOpenItem) => void;
}

/** Ctrl+P 快速打开：模糊匹配文件名，↑↓ 选择、Enter 打开、Esc 关闭 */
export default function QuickOpen({ open, collectFiles, workspacePath, onClose, onPick }: Props) {
  useLang();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<QuickOpenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /** 打开时收集文件列表并聚焦 */
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setItems([]);
    setTimeout(() => inputRef.current?.focus(), 0);
    if (!workspacePath) return;
    let cancelled = false;
    setLoading(true);
    collectFiles(workspacePath)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspacePath]);

  /** 模糊过滤 + 排序（上限 50 条） */
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, 50);
    const scored: { item: QuickOpenItem; score: number }[] = [];
    for (const it of items) {
      const s = fuzzyScore(q, it.name) ?? fuzzyScore(q, it.path.replace(/\\/g, '/').split('/').slice(-3).join('/'));
      if (s !== null) scored.push({ item: it, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 50).map((x) => x.item);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);

  /** 键盘导航 */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = filtered[active];
      if (it) {
        onPick(it);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  /** 全局 Esc 关闭：无工作区时输入框 disabled 无法聚焦，必须在浮层上监听 */
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  /** 选中项滚入可视区 */
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(38,37,35,0.28)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 90,
        zIndex: 150
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card" style={{ width: 520, padding: 10, overflow: 'hidden' }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={workspacePath ? t('qo.ph') : t('qo.noWs')}
          disabled={!workspacePath}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: '1px solid var(--border-hairline)',
            borderRadius: 8,
            padding: '9px 12px',
            fontSize: 13.5,
            outline: 'none',
            background: 'var(--bg-recessed)',
            color: 'var(--text-primary)'
          }}
        />
        <div ref={listRef} style={{ marginTop: 8, maxHeight: 340, overflow: 'auto' }}>
          {!workspacePath && <div className="muted" style={{ fontSize: 12.5, padding: '6px 8px' }}>{t('qo.noWs')}</div>}
          {workspacePath && loading && <div className="muted" style={{ fontSize: 12.5, padding: '6px 8px' }}>{t('nav.loading')}</div>}
          {workspacePath && !loading && filtered.length === 0 && query.trim() && (
            <div className="muted" style={{ fontSize: 12.5, padding: '6px 8px' }}>{t('qo.noHit')}</div>
          )}
          {filtered.map((it, i) => (
            <div
              key={it.path}
              onClick={() => {
                onPick(it);
                onClose();
              }}
              onMouseEnter={() => setActive(i)}
              title={it.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 9px',
                borderRadius: 7,
                fontSize: 12.5,
                cursor: 'pointer',
                background: i === active ? 'var(--accent-tint)' : 'transparent',
                color: i === active ? 'var(--accent)' : 'inherit'
              }}
            >
              <span style={{ fontWeight: 550, flexShrink: 0 }}>{it.name}</span>
              <span className="muted mono" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.path}
              </span>
            </div>
          ))}
        </div>
        <div className="muted" style={{ display: 'flex', gap: 12, fontSize: 11, padding: '6px 4px 2px', borderTop: '1px solid var(--border-hairline)' }}>
          <span>↑↓ {t('qo.nav')}</span>
          <span>↵ {t('qo.open')}</span>
          <span>Esc {t('qo.close')}</span>
        </div>
      </div>
    </div>
  );
}

/** 递归收集工作区下的文件（跳过依赖/构建目录），供快速打开 */
export async function walkWorkspaceFiles(root: string, loadDir: (p: string) => Promise<FileNode[]>): Promise<QuickOpenItem[]> {
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv', '.next', 'coverage', '.idea', '.vscode', 'obj', 'bin']);
  const out: QuickOpenItem[] = [];
  let visits = 0;
  const walk = async (dir: string) => {
    if (out.length >= 1200 || visits >= 100) return;
    visits++;
    let nodes: FileNode[];
    try {
      nodes = await loadDir(dir);
    } catch {
      return;
    }
    for (const n of nodes) {
      if (n.is_dir) {
        if (!skip.has(n.name.toLowerCase())) await walk(n.path);
      } else {
        out.push({ path: n.path, name: n.name });
        if (out.length >= 1200) return;
      }
    }
  };
  await walk(root);
  return out;
}
