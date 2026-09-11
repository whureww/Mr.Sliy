import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t, useLang } from '../../lib/i18n';

const IS_TAURI = '__TAURI_INTERNALS__' in window;

/**
 * 关闭确认对话框：Rust 拦截窗口 CloseRequested 后 emit('close-requested') 触发。
 * 选项：最小化到托盘（后台继续运行）/ 退出程序 / 取消
 */
export default function CloseDialog({ onClose }: { onClose: () => void }) {
  useLang();
  const [busy, setBusy] = useState(false);

  const minimize = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await invoke('minimize_to_tray');
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const exit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await invoke('exit_app');
    } catch {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(38, 37, 35, 0.28)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        animation: 'ctx-fade 0.2s ease'
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: 400,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          boxShadow: '0 16px 48px rgba(38,37,35,.16)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'var(--accent-tint)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              fontWeight: 700
            }}
          >
            ?
          </div>
          <strong style={{ fontSize: 15 }}>{t('close.title')}</strong>
        </div>

        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, margin: 0 }}>
          {t('close.desc')}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <button
            onClick={minimize}
            disabled={busy}
            style={{
              ...btnBase,
              background: 'var(--accent)',
              color: '#FFF'
            }}
          >
            {t('close.minimize')}
          </button>
          <button
            onClick={exit}
            disabled={busy}
            style={{
              ...btnBase,
              background: 'var(--bg-recessed)',
              color: 'var(--danger, #C75450)'
            }}
          >
            {t('close.exit')}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              ...btnBase,
              background: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid var(--border-hairline)'
            }}
          >
            {t('close.back')}
          </button>
        </div>
      </div>
    </div>
  );
}

const btnBase: React.CSSProperties = {
  height: 38,
  borderRadius: 10,
  border: 'none',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'filter 0.2s ease, transform 0.2s ease',
  padding: '0 16px'
};

/** 仅 Tauri 环境渲染（浏览器调试无窗口概念） */
export function CloseDialogGate({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!IS_TAURI || !open) return null;
  return <CloseDialog onClose={onClose} />;
}
