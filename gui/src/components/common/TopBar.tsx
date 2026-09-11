import { useEffect, useState } from 'react';
import { TabKey, WorkbenchMode } from '../../App';
import { WindowControls } from './WindowControls';

interface Props {
  tab: TabKey;
  onTabChange: (t: TabKey) => void;
  mode: WorkbenchMode;
  onModeChange: (m: WorkbenchMode) => void;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'workbench', label: '主工作区' },
  { key: 'diff', label: '优化对比' },
  { key: 'dashboard', label: '质量概览' },
  { key: 'settings', label: '设置' }
];

const MODES: { key: WorkbenchMode; label: string }[] = [
  { key: 'analysis', label: '分析模式' },
  { key: 'editor', label: '编辑模式' }
];

export default function TopBar({ tab, onTabChange, mode, onModeChange }: Props) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // 同步最大化状态以切换 还原/最大化 图标
    let unlisten: (() => void) | undefined;
    (async () => {
      if (!('__TAURI_INTERNALS__' in window)) return;
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      unlisten = await win.onResized(async () => setMaximized(await win.isMaximized()));
      setMaximized(await win.isMaximized());
    })();
    return () => unlisten?.();
  }, []);

  return (
    <header
      data-tauri-drag-region
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '10px 14px 10px 20px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-hairline)',
        userSelect: 'none'
      }}
    >
      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div style={{ width: 7, height: 7, borderRadius: 2, background: '#FFFFFF' }} />
        </div>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.5 }}>MR·SLIY</span>
      </div>
      <nav data-tauri-drag-region style={{ display: 'flex', gap: 4 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            style={{
              background: tab === t.key ? 'var(--accent-tint)' : 'transparent',
              color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: tab === t.key ? 650 : 400,
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              transition: 'all 0.35s ease'
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div data-tauri-drag-region style={{ flex: 1 }} />
      {/* 双模式切换：分析 / 编辑（仅在主工作区显示） */}
      {tab === 'workbench' && (
        <div
          style={{
            display: 'flex',
            gap: 2,
            background: 'var(--bg-recessed)',
            borderRadius: 10,
            padding: 3
          }}
        >
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => onModeChange(m.key)}
                title={m.key === 'analysis' ? '对话与分析过程为主' : '代码编辑为主，AI 收纳为小框'}
                style={{
                  background: active ? 'var(--bg-card)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: active ? 650 : 400,
                  padding: '5px 14px',
                  borderRadius: 7,
                  boxShadow: active ? 'var(--shadow-lift)' : 'none',
                  fontSize: 13,
                  transition: 'all 0.35s ease'
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      )}
      <WindowControls maximized={maximized} />
    </header>
  );
}
