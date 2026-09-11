import { useEffect, useState } from 'react';
import { t, useLang } from '../../lib/i18n';

const IS_TAURI = '__TAURI_INTERNALS__' in window;

interface Props {
  maximized: boolean;
}

/**
 * 自绘窗口控制按钮：最小化 / 最大化(还原) / 关闭
 * 细线 SVG，hover 语义色；非 Tauri 环境（浏览器调试）不渲染
 */
export function WindowControls({ maximized }: Props) {
  useLang();
  const [win, setWin] = useState<{
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
  } | null>(null);

  useEffect(() => {
    if (!IS_TAURI) return;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      setWin(getCurrentWindow());
    })();
  }, []);

  if (!IS_TAURI || !win) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <ControlButton onClick={() => win.minimize()} label={t('win.minimize')}>
        <svg width="11" height="11" viewBox="0 0 11 11">
          <line x1="0.5" y1="5.5" x2="10.5" y2="5.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </ControlButton>
      <ControlButton onClick={() => win.toggleMaximize()} label={maximized ? t('win.restore') : t('win.maximize')}>
        {maximized ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="0.5" y="3.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
            <path d="M3 3.5 V0.5 H10.5 V8 H7.5" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="0.5" y="0.5" width="10" height="10" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </ControlButton>
      <ControlButton onClick={() => win.close()} label={t('win.close')} danger>
        <svg width="11" height="11" viewBox="0 0 11 11">
          <line x1="0.5" y1="0.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1" />
          <line x1="10.5" y1="0.5" x2="0.5" y2="10.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </ControlButton>
    </div>
  );
}

function ControlButton({
  children,
  onClick,
  label,
  danger
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? '#C75450' : 'var(--bg-recessed)';
        e.currentTarget.style.color = danger ? '#FFFFFF' : 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-muted)';
      }}
      style={{
        width: 34,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        color: 'var(--text-muted)',
        borderRadius: 6,
        padding: 0,
        transition: 'background 0.3s ease, color 0.3s ease'
      }}
    >
      {children}
    </button>
  );
}
