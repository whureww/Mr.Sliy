import { useEffect, useState } from 'react';
import { CheckUpdatePayload, openExternal } from '../../ipc/client';

const DISMISS_KEY = 'update-banner-dismissed';

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) || '';
  } catch {
    return '';
  }
}

/** 顶部更新提示条：发现新版本时显示，可按版本关闭（同一版本不再打扰） */
export default function UpdateBanner({ info, onClose }: { info: CheckUpdatePayload; onClose: () => void }) {
  const [visible, setVisible] = useState(true);
  const dismissedVersion = readDismissed();

  useEffect(() => {
    setVisible(true);
  }, [info.latestVersion]);

  if (!info.updateAvailable || !info.latestVersion) return null;
  if (dismissedVersion === info.latestVersion) return null;
  if (!visible) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 16px',
        background: 'var(--accent-tint)',
        borderBottom: '1px solid var(--border-hairline)',
        fontSize: 12.5
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--accent)',
          background: 'var(--bg-card)',
          borderRadius: 6,
          padding: '2px 8px',
          flexShrink: 0
        }}
      >
        新版本
      </span>
      <span style={{ fontWeight: 650, color: 'var(--accent)' }}>v{info.latestVersion}</span>
      <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {info.notes ? info.notes.slice(0, 80) : '发现可用更新，建议升级以获得最新功能与修复。'}
      </span>
      {info.url && (
        <button
          className="btn-primary"
          style={{ fontSize: 12, padding: '4px 12px', flexShrink: 0 }}
          onClick={() => openExternal(info.url!).catch(() => {})}
        >
          前往下载
        </button>
      )}
      <button
        className="btn-ghost"
        title="关闭（本版本不再提示）"
        aria-label="关闭更新提示"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, info.latestVersion!);
          } catch {}
          setVisible(false);
          onClose();
        }}
        style={{ width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
