import { useEffect, useState } from 'react';
import { FileNode } from '../../ipc/client';
import { openContextMenu, copyText } from '../../lib/contextMenu';

export interface Workspace {
  path: string;
  name: string;
  locked?: boolean; // 锁定后：不可删除、会话只读
  archived?: boolean; // 归档：默认隐藏，可展开查看（不可扫描）
  scheduleMinutes?: number; // 定时自动扫描间隔（0/undefined = 关闭）
}

interface Props {
  workspaces: Workspace[];
  activeWs: string | null;
  currentFile: { path: string } | null;
  /** 读取目录（由 Workbench 提供，包装 IPC listDir） */
  loadDir: (path: string) => Promise<FileNode[]>;
  onAdd: (path: string) => Promise<string | null>; // 返回错误信息或 null
  onRemove: (path: string) => void;
  onToggleLock: (path: string) => void;
  onArchive: (path: string) => void;
  onSchedule: (path: string, minutes: number) => void;
  onProjectScan: () => void;
  onSelect: (path: string) => void;
  onOpenFile: (node: FileNode) => void;
}

/** 左侧导航：会话列表（每个目录 = 一个独立对话）+ 新建 + 折叠式文件树 */
export default function WorkspaceNav({
  workspaces,
  activeWs,
  currentFile,
  loadDir,
  onAdd,
  onRemove,
  onToggleLock,
  onArchive,
  onSchedule,
  onProjectScan,
  onSelect,
  onOpenFile
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [dialogErr, setDialogErr] = useState('');
  const [browsing, setBrowsing] = useState(false);
  /** 会话搜索与归档展开 */
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  // 文件树状态：子目录缓存 / 展开集合 / 加载中集合
  const [children, setChildren] = useState<Record<string, FileNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [loadErr, setLoadErr] = useState<Record<string, string>>({});

  /** 切换工作区时重置树并加载根目录 */
  useEffect(() => {
    setChildren({});
    setExpanded(new Set());
    setLoading(new Set());
    setLoadErr({});
    if (activeWs) fetchDir(activeWs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWs]);

  const fetchDir = async (path: string) => {
    setLoading((s) => new Set(s).add(path));
    try {
      const nodes = await loadDir(path);
      setChildren((c) => ({ ...c, [path]: nodes }));
      setLoadErr((e) => {
        const n = { ...e };
        delete n[path];
        return n;
      });
    } catch {
      setLoadErr((e) => ({ ...e, [path]: '无法读取' }));
    } finally {
      setLoading((s) => {
        const n = new Set(s);
        n.delete(path);
        return n;
      });
    }
  };

  const toggle = (node: FileNode) => {
    const isOpen = expanded.has(node.path);
    if (isOpen) {
      setExpanded((s) => {
        const n = new Set(s);
        n.delete(node.path);
        return n;
      });
    } else {
      setExpanded((s) => new Set(s).add(node.path));
      if (!children[node.path]) fetchDir(node.path);
    }
  };

  const browseFolder = async () => {
    setBrowsing(true);
    setDialogErr('');
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === 'string') setDraft(picked);
    } catch {
      setDialogErr('文件夹选择失败（需在应用窗口内使用）');
    } finally {
      setBrowsing(false);
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setDraft('');
    setDialogErr('');
  };

  const confirmAdd = async () => {
    const p = draft.trim();
    if (!p) return;
    setDialogErr('');
    const err = await onAdd(p);
    if (err) setDialogErr(err);
    else closeDialog();
  };

  return (
    <aside className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="muted" style={{ fontSize: 11, letterSpacing: 1.2 }}>WORKSPACE</div>
        <button
          onClick={() => setDialogOpen(true)}
          title="新建工作区（每个目录对应一个独立对话）"
          style={{
            background: 'var(--accent-tint)',
            color: 'var(--accent)',
            fontSize: 12,
            fontWeight: 650,
            padding: '3px 10px',
            borderRadius: 7
          }}
        >
          + 新建
        </button>
      </div>

      {/* 会话搜索 */}
      <div style={{ marginBottom: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索会话…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: '1px solid var(--border-hairline)',
            borderRadius: 8,
            padding: '5px 10px',
            fontSize: 12,
            outline: 'none',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)'
          }}
        />
      </div>

      {/* 项目级扫描入口（作用于当前激活工作区） */}
      <button
        className="btn-ghost"
        disabled={!activeWs}
        title={activeWs ? '聚合检测当前工作区整个项目目录' : '请先选择工作区'}
        onClick={onProjectScan}
        style={{ fontSize: 12.5, marginBottom: 8, width: '100%' }}
      >
        扫描整个项目
      </button>

      {/* 会话列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 12, maxHeight: 200, overflow: 'auto' }}>
        {workspaces.length === 0 && (
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, padding: '4px 6px' }}>
            还没有工作区。点击"新建"添加一个文件夹，它将作为一个独立的分析对话。
          </div>
        )}
        {workspaces
          .filter((ws) => {
            const q = query.trim().toLowerCase();
            const hit = !q || ws.name.toLowerCase().includes(q) || ws.path.toLowerCase().includes(q);
            if (!hit) return false;
            return showArchived || !ws.archived || ws.path === activeWs;
          })
          .map((ws) => {
          const active = ws.path === activeWs;
          return (
            <div
              key={ws.path}
              onClick={() => onSelect(ws.path)}
              onContextMenu={(e) =>
                openContextMenu(e, [
                  { label: '切换到此对话', disabled: active, onClick: () => onSelect(ws.path) },
                  { label: '复制路径', onClick: () => copyText(ws.path) },
                  { separator: true },
                  { label: ws.locked ? '解锁会话' : '锁定会话', onClick: () => onToggleLock(ws.path) },
                  { label: ws.archived ? '取消归档' : '归档会话', onClick: () => onArchive(ws.path) },
                  { separator: true },
                  {
                    label: ws.scheduleMinutes ? `定时扫描：关闭（当前每 ${ws.scheduleMinutes} 分钟）` : '定时扫描：关闭',
                    disabled: !ws.scheduleMinutes,
                    onClick: () => onSchedule(ws.path, 0)
                  },
                  ...[5, 15, 30, 60].map((m) => ({
                    label: `定时扫描：每 ${m} 分钟${ws.scheduleMinutes === m ? ' ✓' : ''}`,
                    onClick: () => onSchedule(ws.path, m)
                  })),
                  { separator: true },
                  {
                    label: '扫描整个项目',
                    disabled: !active,
                    title: !active ? '切换到该会话后可用' : undefined,
                    onClick: () => onProjectScan()
                  },
                  {
                    label: '移除工作区',
                    danger: true,
                    disabled: ws.locked,
                    title: ws.locked ? '会话已锁定，解锁后才能移除' : undefined,
                    onClick: () => onRemove(ws.path)
                  }
                ])
              }
              title={ws.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 13,
                background: active ? 'var(--accent-tint)' : 'transparent',
                color: active ? 'var(--accent)' : 'inherit',
                transition: 'background 0.3s ease'
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0, background: active ? 'var(--accent)' : '#CFCDC7' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: active ? 650 : 400, opacity: ws.archived && !active ? 0.55 : 1 }}>
                {ws.name}
              </span>
              {ws.scheduleMinutes ? (
                <span title={`定时扫描：每 ${ws.scheduleMinutes} 分钟`} style={{ flexShrink: 0, fontSize: 10.5, color: 'var(--accent)' }}>
                  ⏰{ws.scheduleMinutes}
                </span>
              ) : null}
              {ws.archived && (
                <span title="已归档（右键可取消归档）" style={{ flexShrink: 0, fontSize: 10.5, color: 'var(--text-muted)' }}>
                  归档
                </span>
              )}
              {ws.locked && (
                <span
                  title="会话已锁定：不可移除，内容只读"
                  style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
                    <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
                  </svg>
                </span>
              )}
              {!ws.locked && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(ws.path);
                  }}
                title="移除该工作区"
                className="muted"
                style={{
                  background: 'transparent',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: '0 3px',
                  opacity: 0,
                  transition: 'opacity 0.3s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
              >
                ×
              </button>
              )}
            </div>
          );
        })}
        {workspaces.filter((w) => w.archived).length > 0 && (
          <button
            className="muted"
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? '隐藏归档会话' : '显示归档会话'}
            style={{ background: 'transparent', border: 'none', fontSize: 11.5, textAlign: 'left', padding: '6px 8px', cursor: 'pointer' }}
          >
            {showArchived ? '▾' : '▸'} 归档会话（{workspaces.filter((w) => w.archived).length}）
          </button>
        )}
      </div>

      {/* 折叠式文件树 */}
      <div style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: 10, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="mono muted" style={{ fontSize: 11.5, marginBottom: 8, wordBreak: 'break-all' }}>
          {activeWs || '—'}
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {!activeWs && <div className="muted" style={{ fontSize: 12, padding: '4px 6px' }}>选择工作区后浏览文件</div>}
          {activeWs &&
            (children[activeWs] || []).map((n) => (
              <TreeNode
                key={n.path}
                node={n}
                depth={0}
                expanded={expanded}
                childrenMap={children}
                loading={loading}
                loadErr={loadErr}
                currentFile={currentFile}
                onToggle={toggle}
                onOpenFile={onOpenFile}
              />
            ))}
          {activeWs && loading.has(activeWs) && !children[activeWs] && (
            <div className="muted" style={{ fontSize: 12, padding: '4px 8px' }}>加载中…</div>
          )}
          {activeWs && loadErr[activeWs] && (
            <div style={{ color: 'var(--danger)', fontSize: 12, padding: '4px 8px' }}>{loadErr[activeWs]}</div>
          )}
        </div>
      </div>

      {/* 新建工作区弹层 */}
      {dialogOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(38,37,35,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
          onClick={closeDialog}
        >
          <div
            className="card"
            style={{ width: 460, padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <strong style={{ fontSize: 15 }}>新建工作区</strong>
            <div className="muted" style={{ fontSize: 12.5, margin: '6px 0 14px' }}>
              选择一个文件夹，它将作为一个新的独立对话加入列表。
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmAdd()}
                placeholder="D:\projects\my-app"
                style={{
                  flex: 1,
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 13,
                  outline: 'none',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)'
                }}
              />
              <button className="btn-ghost" onClick={browseFolder} disabled={browsing}>
                {browsing ? '打开中…' : '浏览…'}
              </button>
            </div>
            {dialogErr && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 8 }}>{dialogErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="btn-ghost" onClick={closeDialog}>取消</button>
              <button className="btn-primary" onClick={confirmAdd} disabled={!draft.trim()}>
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

/** 折叠树节点：目录点击展开/收起（懒加载子目录），文件点击打开 */
function TreeNode({
  node,
  depth,
  expanded,
  childrenMap,
  loading,
  loadErr,
  currentFile,
  onToggle,
  onOpenFile
}: {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  childrenMap: Record<string, FileNode[]>;
  loading: Set<string>;
  loadErr: Record<string, string>;
  currentFile: { path: string } | null;
  onToggle: (node: FileNode) => void;
  onOpenFile: (node: FileNode) => void;
}) {
  const active = currentFile?.path === node.path;
  const isOpen = expanded.has(node.path);
  const kids = childrenMap[node.path];

  return (
    <>
      <div
        onClick={() => (node.is_dir ? onToggle(node) : onOpenFile(node))}
        onContextMenu={(e) =>
          node.is_dir
            ? openContextMenu(e, [
                { label: isOpen ? '收起目录' : '展开目录', onClick: () => onToggle(node) },
                { label: '复制目录路径', onClick: () => copyText(node.path) }
              ])
            : openContextMenu(e, [
                { label: '打开文件', disabled: active, onClick: () => onOpenFile(node) },
                { label: '复制文件路径', onClick: () => copyText(node.path) },
                { label: '复制文件名', onClick: () => copyText(node.name) }
              ])
        }
        title={node.path}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          paddingLeft: 6 + depth * 14,
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 13,
          background: active ? 'var(--accent-tint)' : 'transparent',
          color: active ? 'var(--accent)' : 'inherit',
          whiteSpace: 'nowrap'
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.background = 'var(--bg-recessed)';
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.background = 'transparent';
        }}
      >
        {node.is_dir ? (
          <span
            style={{
              width: 12,
              display: 'inline-block',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 10,
              transition: 'transform 0.25s ease',
              transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              flexShrink: 0
            }}
          >
            ▶
          </span>
        ) : (
          <span style={{ width: 12, textAlign: 'center', color: '#C4C2BC', fontSize: 12, flexShrink: 0 }}>·</span>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: node.is_dir ? 550 : 400 }}>
          {node.name}
        </span>
      </div>
      {node.is_dir && isOpen && (
        <div>
          {loading.has(node.path) && !kids && (
            <div className="muted" style={{ fontSize: 12, padding: '3px 8px', paddingLeft: 20 + depth * 14 }}>
              加载中…
            </div>
          )}
          {loadErr[node.path] && (
            <div style={{ color: 'var(--danger)', fontSize: 12, padding: '3px 8px', paddingLeft: 20 + depth * 14 }}>
              {loadErr[node.path]}
            </div>
          )}
          {(kids || []).map((k) => (
            <TreeNode
              key={k.path}
              node={k}
              depth={depth + 1}
              expanded={expanded}
              childrenMap={childrenMap}
              loading={loading}
              loadErr={loadErr}
              currentFile={currentFile}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))}
          {kids && kids.length === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: '3px 8px', paddingLeft: 20 + depth * 14 }}>
              空目录
            </div>
          )}
        </div>
      )}
    </>
  );
}
