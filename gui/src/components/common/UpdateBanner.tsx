import { useEffect, useRef, useState } from 'react';
import {
  CheckUpdatePayload,
  DownloadState,
  getUpdateDownloadStatus,
  startUpdateDownload,
  installUpdate,
  openExternal
} from '../../ipc/client';

const DISMISS_KEY = 'update-banner-dismissed';

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) || '';
  } catch {
    return '';
  }
}

function fmtMB(n?: number): string {
  if (!n || n <= 0) return '0';
  return (n / 1024 / 1024).toFixed(1);
}

/**
 * 顶部更新提示条：发现新版本时显示。
 * 有安装包直链(info.download)时自动开始下载并显示进度;完成后一键启动安装器并退出应用。
 * 同一版本关闭后不再提示;下载中不可关闭(后台继续,重开或重启后由状态恢复)。
 */
export default function UpdateBanner({ info, onClose }: { info: CheckUpdatePayload; onClose: () => void }) {
  const [visible, setVisible] = useState(true);
  const [dl, setDl] = useState<DownloadState | null>(null);
  const [installing, setInstalling] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 挂载/新版本时恢复下载状态;未开始且有直链则自动开始下载
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const st = await getUpdateDownloadStatus().catch(() => null);
      if (cancelled || !st) return;
      if (st.status === 'downloading' || st.status === 'done') {
        setDl(st);
        return;
      }
      // idle / error:有直链则(重新)开始下载
      if (info.download && info.latestVersion) {
        const s = await startUpdateDownload(info.download, info.latestVersion).catch(() => null);
        if (!cancelled && s) setDl(s);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [info.latestVersion, info.download]);

  // 下载中轮询进度,终态停止
  useEffect(() => {
    if (dl?.status !== 'downloading') return;
    const timer = setInterval(async () => {
      const st = await getUpdateDownloadStatus().catch(() => null);
      if (st && aliveRef.current) setDl(st);
    }, 800);
    return () => clearInterval(timer);
  }, [dl?.status]);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, info.latestVersion || '');
    } catch {}
    setVisible(false);
    onClose();
  };

  const install = async () => {
    if (!dl?.filePath) return;
    setInstalling(true);
    try {
      await installUpdate(dl.filePath);
      // 成功时应用会退出,正常不会执行到这里
    } catch (e) {
      setInstalling(false);
      setDl({ ...dl, status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };

  if (!info.updateAvailable || !info.latestVersion) return null;
  if (dismissedVersion(info.latestVersion)) return null;
  if (!visible) return null;

  const phase: 'idle' | 'downloading' | 'done' | 'error' = dl?.status || 'idle';
  const percent = phase === 'done' ? 100 : dl?.percent || 0;
  const sizeText =
    dl?.total ? `${fmtMB(dl.received)} / ${fmtMB(dl.total)} MB` : dl?.received ? `${fmtMB(dl.received)} MB` : '';

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
      <span style={{ fontWeight: 650, color: 'var(--accent)', flexShrink: 0 }}>v{info.latestVersion}</span>

      {phase === 'downloading' && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span
            style={{
              flex: 1,
              maxWidth: 260,
              height: 5,
              borderRadius: 3,
              background: 'var(--border-hairline)',
              overflow: 'hidden'
            }}
          >
            <span
              style={{
                display: 'block',
                width: `${percent}%`,
                height: '100%',
                borderRadius: 3,
                background: 'var(--accent)',
                transition: 'width .3s ease'
              }}
            />
          </span>
          <span className="muted" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            正在下载更新 {sizeText && `${sizeText} · `}
            {percent}%
          </span>
        </span>
      )}

      {phase === 'done' && (
        <span className="muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          更新包下载完成{dl?.version ? `（v${dl.version}）` : ''},安装将关闭当前应用。
        </span>
      )}

      {phase === 'error' && (
        <span className="muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          下载失败:{dl?.error || '未知原因'}
        </span>
      )}

      {(phase === 'idle' || !info.download) && (
        <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {info.notes ? info.notes.slice(0, 80) : '发现可用更新,建议升级以获得最新功能与修复。'}
        </span>
      )}

      {phase === 'done' && (
        <button
          className="btn-primary"
          style={{ fontSize: 12, padding: '4px 12px', flexShrink: 0 }}
          disabled={installing}
          onClick={install}
        >
          {installing ? '正在启动安装器…' : '安装更新'}
        </button>
      )}

      {phase === 'error' && info.download && (
        <button
          className="btn-primary"
          style={{ fontSize: 12, padding: '4px 12px', flexShrink: 0 }}
          onClick={async () => {
            const s = await startUpdateDownload(info.download!, info.latestVersion!).catch(() => null);
            if (s) setDl(s);
          }}
        >
          重试
        </button>
      )}

      {phase === 'idle' && info.url && (
        <button
          className="btn-primary"
          style={{ fontSize: 12, padding: '4px 12px', flexShrink: 0 }}
          onClick={() => openExternal(info.url!).catch(() => {})}
        >
          前往下载
        </button>
      )}

      {/* 下载中不允许关闭,避免完成提示丢失 */}
      {phase !== 'downloading' && (
        <button
          className="btn-ghost"
          title="关闭(本版本不再提示)"
          aria-label="关闭更新提示"
          onClick={dismiss}
          style={{ width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );

  function dismissedVersion(v: string): boolean {
    return readDismissed() === v;
  }
}
