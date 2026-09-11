import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from './components/common/TopBar';
import StatusBar from './components/common/StatusBar';
import ContextMenuLayer from './components/common/ContextMenuLayer';
import CloseDialog, { CloseDialogGate } from './components/common/CloseDialog';
import Splash from './components/common/Splash';
import UpdateBanner from './components/common/UpdateBanner';
import Workbench from './routes/Workbench';
import DiffReview from './routes/DiffReview';
import Dashboard from './routes/Dashboard';
import Settings from './routes/Settings';
import { AnalysisMode, CheckUpdatePayload, OptimizeResult, checkForUpdate, getUpdateDownloadStatus, loadState, saveState } from './ipc/client';
import { Appearance, applyAppearance, normalizeAppearance } from './lib/appearance';

export type TabKey = 'workbench' | 'diff' | 'dashboard' | 'settings';
/** 主工作区双模式：分析模式（对话+分析过程为主）/ 编辑模式（代码为主+AI 小框） */
export type WorkbenchMode = 'analysis' | 'editor';

export interface DiffPayload {
  filePath: string;
  language: string;
  originalCode: string;
  result: OptimizeResult;
}

export default function App() {
  const [tab, setTab] = useState<TabKey>('workbench');
  const [mode, setMode] = useState<WorkbenchMode>('analysis');
  const [diffPayload, setDiffPayload] = useState<DiffPayload | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('local');
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [closeDialog, setCloseDialog] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<CheckUpdatePayload | null>(null);
  // 启动画面：on(展示) → exit(淡出并显示主窗口) → off(卸载)
  const [splash, setSplash] = useState<'on' | 'exit' | 'off'>('on');
  const splashPhase = useRef<'on' | 'exit' | 'off'>('on');
  const minTimeDone = useRef(false);
  const appReady = useRef(false);

  /** 条件满足(最短展示时长 + 外观已应用)后收场：淡出 splash，同时让主窗口可见 */
  const reveal = useCallback(() => {
    if (!minTimeDone.current || !appReady.current || splashPhase.current !== 'on') return;
    splashPhase.current = 'exit';
    setSplash('exit');
    setTimeout(async () => {
      try {
        if ('__TAURI_INTERNALS__' in window) {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().show();
        }
      } catch { /* 忽略：非 Tauri 环境 */ }
      splashPhase.current = 'off';
      setSplash('off');
    }, 520);
  }, []);

  // Rust 拦截窗口关闭（自绘按钮 / Alt+F4 / 任务栏）后转发到前端，弹关闭确认对话框
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const fn = await listen('close-requested', () => setCloseDialog(true));
      if (cancelled) fn();
      else unlisten = fn;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // 启动时还原持久化的分析模式与外观
  useEffect(() => {
    (async () => {
      try {
        const sRaw = await loadState('settings');
        if (sRaw) {
          const s = JSON.parse(sRaw) as { analysisMode?: AnalysisMode };
          if (s.analysisMode === 'local' || s.analysisMode === 'cloud') setAnalysisMode(s.analysisMode);
        }
      } catch {}
      try {
        const aRaw = await loadState('appearance');
        const app = normalizeAppearance(aRaw ? JSON.parse(aRaw) : null);
        setAppearance(app);
        applyAppearance(app);
      } catch {
        // 读取失败（如存储插件不可用）也应用默认外观，保证 auto 日夜模式始终生效
        const app = normalizeAppearance(null);
        setAppearance(app);
        applyAppearance(app);
      } finally {
        // 外观流程无论成败都算就绪；reveal 内部还有最短展示时长门控
        appReady.current = true;
        reveal();
      }
    })();
  }, []);

  // 启动画面最短展示 1.9s,保证入场动画完整;时长满足后尝试收场
  useEffect(() => {
    const timer = setTimeout(() => {
      minTimeDone.current = true;
      reveal();
    }, 1900);
    return () => clearTimeout(timer);
  }, [reveal]);

  // 兜底:任何环节(状态读取/外观应用)异常挂起时,6s 后强制收场并显示窗口,
  // 避免程序卡死在启动动画(Rust 侧还有 8s 线程兜底,双保险)
  useEffect(() => {
    const timer = setTimeout(() => {
      minTimeDone.current = true;
      appReady.current = true;
      reveal();
    }, 6000);
    return () => clearTimeout(timer);
  }, [reveal]);

  const changeAppearance = (a: Appearance) => {
    setAppearance(a);
    applyAppearance(a);
    saveState('appearance', JSON.stringify(a)).catch(() => {});
  };

  // 启动静默检查更新:上次已下载完成的安装包直接提示安装;否则远程检查,
  // 发现新版本时设置 updateInfo,横幅挂载后自动开始下载
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const st = await getUpdateDownloadStatus().catch(() => null);
      if (cancelled) return;
      if (st?.status === 'done') {
        setUpdateInfo({
          checked: true,
          currentVersion: '',
          latestVersion: st.version || '',
          updateAvailable: true,
          notes: ''
        });
        return;
      }
      const r = await checkForUpdate().catch(() => null);
      if (!cancelled && r?.updateAvailable) setUpdateInfo(r);
    }, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const changeAnalysisMode = (m: AnalysisMode) => {
    setAnalysisMode(m);
    saveState('settings', JSON.stringify({ analysisMode: m })).catch(() => {});
  };

  const openDiff = (payload: DiffPayload) => {
    setDiffPayload(payload);
    setTab('diff');
  };

  const changeMode = (m: WorkbenchMode) => {
    setMode(m);
    setTab('workbench');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar tab={tab} onTabChange={setTab} mode={mode} onModeChange={changeMode} />
      {updateInfo && <UpdateBanner info={updateInfo} onClose={() => setUpdateInfo(null)} />}
      <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
        {tab === 'workbench' && (
          <Workbench mode={mode} onModeChange={setMode} onOpenDiff={openDiff} analysisMode={analysisMode} />
        )}
        {tab === 'diff' && <DiffReview payload={diffPayload} onBack={() => setTab('workbench')} />}
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'settings' && (
          <Settings
            mode={analysisMode}
            onModeChange={changeAnalysisMode}
            appearance={appearance}
            onAppearanceChange={changeAppearance}
            updateInfo={updateInfo}
            onUpdateInfoChange={setUpdateInfo}
          />
        )}
      </div>
      <StatusBar />
      {/* 全局右键菜单层：屏蔽默认菜单，按页面定制菜单项 */}
      <ContextMenuLayer />
      {/* 关闭确认：最小化到托盘（后台运行）/ 退出程序 */}
      <CloseDialogGate open={closeDialog} onClose={() => setCloseDialog(false)} />
      {/* 启动画面：覆盖首帧到服务就绪，淡出后卸载 */}
      {splash !== 'off' && <Splash exiting={splash === 'exit'} />}
    </div>
  );
}
