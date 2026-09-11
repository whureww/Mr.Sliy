import { useCallback, useEffect, useState } from 'react';
import {
  AnalysisMode,
  CheckUpdatePayload,
  DownloadState,
  LlmKeyInfo,
  LlmProvidersPayload,
  McpStatus,
  MemoryItem,
  UpdateRecord,
  APP_VERSION,
  activateLlmProvider,
  addCustomProvider,
  addMemory,
  checkForUpdate,
  clearMemories,
  deleteLlmProvider,
  deleteMemory,
  getLlmKeys,
  getLlmProviders,
  getMcpStatus,
  getMemories,
  getUpdateRecords,
  getUpdateDownloadStatus,
  getUpdateSource,
  installUpdate,
  openExternal,
  saveLlmProvider,
  saveUpdateSource,
  startUpdateDownload
} from '../ipc/client';
import { MODE_CHANGE_EVENT, SCALES, THEMES, Appearance, ThemeMode, isDarkMode, paletteOf, themeOf } from '../lib/appearance';
import { Lang, setLang, t, useLang } from '../lib/i18n';

interface Props {
  mode: AnalysisMode;
  onModeChange: (m: AnalysisMode) => void;
  appearance: Appearance | null;
  onAppearanceChange: (a: Appearance) => void;
  updateInfo: CheckUpdatePayload | null;
  onUpdateInfoChange: (info: CheckUpdatePayload | null) => void;
}

/** 提供商展示名 */
const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot (Kimi)'
};

/** 含中文文案的提供商名走 i18n（品牌名两种语言一致的无需翻译） */
const PROVIDER_NAME_KEYS: Record<string, string> = {
  zhipu: 'provider.name.zhipu',
  tongyi: 'provider.name.tongyi',
  ollama: 'provider.name.ollama'
};

/** 提供商是否需要 API Key（Ollama 本地服务无需 Key） */
const NEEDS_KEY: Record<string, boolean> = { ollama: false };

const providerLabel = (name: string) =>
  PROVIDER_NAME_KEYS[name] ? t(PROVIDER_NAME_KEYS[name])
    : PROVIDER_LABEL[name] || (name.startsWith('custom-') ? t('provider.customTag', { name: name.slice(7) }) : name);

const MODES: { key: AnalysisMode; badgeKey: string; titleKey: string; descKey: string }[] = [
  { key: 'local', badgeKey: 'mode.badge.local', titleKey: 'mode.local.title', descKey: 'mode.local.desc' },
  { key: 'cloud', badgeKey: 'mode.badge.cloud', titleKey: 'mode.cloud.title', descKey: 'mode.cloud.desc' }
];

const LANGS: { key: Lang; name: string }[] = [
  { key: 'zh', name: '简体中文' },
  { key: 'en', name: 'English' }
];

/** 更新记录状态徽章颜色（底色用 color-mix 混合卡片背景，日/夜模式均适配） */
const UPDATE_STATUS_STYLE: Record<string, { color: string; mixKey: 'success' | 'danger' | 'warning' }> = {
  success: { color: 'var(--success-text)', mixKey: 'success' },
  completed: { color: 'var(--success-text)', mixKey: 'success' },
  failed: { color: 'var(--danger-text)', mixKey: 'danger' },
  pending: { color: 'var(--warning-text)', mixKey: 'warning' },
  running: { color: 'var(--warning-text)', mixKey: 'warning' }
};

/** 折叠箭头按钮（旋转指示展开方向） */
function CollapseToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      className="btn-ghost"
      style={{ fontSize: 12, padding: '4px 11px', flexShrink: 0, fontFamily: 'var(--font-mono)' }}
      onClick={onClick}
      title={open ? t('common.collapse') : t('common.expand')}
    >
      {open ? '▾' : '▸'}
    </button>
  );
}

export default function Settings({ mode, onModeChange, appearance, onAppearanceChange, updateInfo, onUpdateInfoChange }: Props) {
  const lang = useLang();
  // auto 日夜跨越阈值时强制刷新（主题预览色跟随实际生效变体）
  const [, setModeTick] = useState(0);
  useEffect(() => {
    const bump = () => setModeTick((n) => n + 1);
    window.addEventListener(MODE_CHANGE_EVENT, bump);
    return () => window.removeEventListener(MODE_CHANGE_EVENT, bump);
  }, []);
  const dark = appearance ? isDarkMode(appearance) : false;
  const [payload, setPayload] = useState<LlmProvidersPayload | null>(null);
  const [keys, setKeys] = useState<LlmKeyInfo[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [draftModel, setDraftModel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // 自定义提供商表单
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  // 记忆库
  const [memories, setMemories] = useState<MemoryItem[] | null>(null);
  const [memDraft, setMemDraft] = useState('');
  // 更新记录
  const [updates, setUpdates] = useState<UpdateRecord[] | null>(null);
  // 检查更新
  const [sourceUrl, setSourceUrl] = useState('');
  const [currentVersion, setCurrentVersion] = useState('');
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'done'>('idle');
  const [checkResult, setCheckResult] = useState<CheckUpdatePayload | null>(null);
  // 安装包下载状态(与顶部横幅共享后端状态)
  const [dlState, setDlState] = useState<DownloadState | null>(null);
  const [installing, setInstalling] = useState(false);
  // 高级选项:自定义更新源清单(默认收起,零配置使用 GitHub Releases)
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 折叠区:主题网格 / 大模型提供商列表 / 更新记录(默认收起,减少页面长度)
  const [themeOpen, setThemeOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);

  const [mcp, setMcp] = useState<McpStatus | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const refresh = useCallback(async (retried?: boolean) => {
    try {
      const [p, k] = await Promise.all([getLlmProviders(), getLlmKeys()]);
      setPayload(p);
      setKeys(k);
    } catch {
      setNotice({ ok: false, text: t('toast.llmFail') });
      // sidecar 启动较慢时自动重试一次
      if (!retried) setTimeout(() => refresh(true), 3000);
    }
  }, []);

  const refreshMemories = useCallback(async () => {
    try {
      setMemories(await getMemories());
    } catch {
      setMemories([]);
    }
  }, []);

  const refreshUpdates = useCallback(async () => {
    try {
      setUpdates(await getUpdateRecords(20));
    } catch {
      setUpdates(null);
    }
  }, []);

  const refreshMcp = useCallback(async () => {
    try {
      setMcp(await getMcpStatus());
    } catch {
      setMcp(null);
    }
  }, []);

  const refreshSource = useCallback(async () => {
    try {
      const s = await getUpdateSource();
      setSourceUrl(s.url);
      setCurrentVersion(s.currentVersion);
    } catch {
      /* 忽略：保持输入为空 */
    }
  }, []);

  const doCheckUpdate = useCallback(async () => {
    setCheckState('checking');
    try {
      const r = await checkForUpdate();
      setCheckResult(r);
      setCheckState('done');
      // 与顶部提示条共享状态：手动检查发现新版本时同步刷新横幅
      if (r.updateAvailable) onUpdateInfoChange(r);
    } catch (e) {
      setCheckResult({ checked: false, currentVersion: '', reason: (e as Error).message });
      setCheckState('done');
    }
  }, [onUpdateInfoChange]);

  // 进入设置页时恢复安装包下载状态;下载中每 800ms 轮询进度
  useEffect(() => {
    getUpdateDownloadStatus().then(setDlState).catch(() => {});
  }, []);
  useEffect(() => {
    if (dlState?.status !== 'downloading') return;
    const timer = setInterval(() => {
      getUpdateDownloadStatus().then(setDlState).catch(() => {});
    }, 800);
    return () => clearInterval(timer);
  }, [dlState?.status]);

  const beginDownload = async (url: string, version: string, digest?: string) => {
    const s = await startUpdateDownload(url, version, digest).catch((e) => ({ status: 'error', error: (e as Error).message }) as DownloadState);
    setDlState(s);
  };

  const installNow = async () => {
    if (!dlState?.filePath) return;
    setInstalling(true);
    try {
      await installUpdate(dlState.filePath);
    } catch (e) {
      setInstalling(false);
      setDlState({ ...dlState, status: 'error', error: (e as Error).message });
    }
  };

  const submitSource = async () => {
    try {
      const saved = await saveUpdateSource(sourceUrl.trim());
      setSourceUrl(saved);
      flash(true, t('toast.sourceSaved'));
    } catch (e) {
      flash(false, (e as Error).message);
    }
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
  };

  useEffect(() => {
    refresh();
    refreshMemories();
    refreshUpdates();
    refreshMcp();
    // 语言切换时同步刷新提示文案场景（数据本身与语言无关，仅初始化一次）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    setTimeout(() => setNotice(null), 3200);
  };

  const openEditor = (name: string) => {
    const saved = keys.find((k) => k.provider === name);
    setEditing(name);
    setDraftKey('');
    setDraftUrl(saved?.apiUrl || '');
    setDraftModel(saved?.model || '');
  };

  const saveProvider = async (name: string) => {
    if (NEEDS_KEY[name] !== false && !draftKey.trim()) {
      flash(false, t('toast.needKey'));
      return;
    }
    setBusy(name);
    try {
      await saveLlmProvider(name, { apiKey: draftKey.trim() || 'local-service', apiUrl: draftUrl.trim(), model: draftModel.trim() });
      flash(true, t('toast.saved', { name: providerLabel(name) }));
      setEditing(null);
      await refresh();
    } catch (e) {
      flash(false, t('toast.saveFail', { msg: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const activate = async (name: string) => {
    setBusy(name);
    try {
      await activateLlmProvider(name);
      flash(true, t('toast.activated', { name: providerLabel(name) }));
      await refresh();
    } catch (e) {
      flash(false, t('toast.activateFail', { msg: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const removeProvider = async (name: string) => {
    setBusy(name);
    try {
      await deleteLlmProvider(name);
      flash(true, t('toast.deleted'));
      await refresh();
    } catch (e) {
      flash(false, t('toast.deleteFail', { msg: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const submitCustom = async () => {
    if (!customName.trim()) {
      flash(false, t('toast.needName'));
      return;
    }
    if (!customUrl.trim()) {
      flash(false, t('toast.needUrl'));
      return;
    }
    setBusy('custom');
    try {
      await addCustomProvider({ name: customName.trim(), apiKey: customKey.trim(), apiUrl: customUrl.trim(), model: customModel.trim() });
      flash(true, t('toast.customAdded', { name: customName.trim() }));
      setCustomOpen(false);
      setCustomName('');
      setCustomKey('');
      setCustomUrl('');
      setCustomModel('');
      await refresh();
    } catch (e) {
      flash(false, t('toast.addFail', { msg: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const submitMemory = async () => {
    const text = memDraft.trim();
    if (!text) return;
    try {
      await addMemory(text);
      setMemDraft('');
      flash(true, t('toast.memoryAdded'));
      await refreshMemories();
    } catch (e) {
      flash(false, t('toast.memFail', { msg: (e as Error).message }));
    }
  };

  const removeMemory = async (id: string) => {
    try {
      await deleteMemory(id);
      flash(true, t('toast.memoryDeleted'));
      await refreshMemories();
    } catch (e) {
      flash(false, t('toast.memFail', { msg: (e as Error).message }));
    }
  };

  const clearAllMemories = async () => {
    try {
      await clearMemories();
      flash(true, t('toast.memoryCleared'));
      await refreshMemories();
    } catch (e) {
      flash(false, t('toast.memFail', { msg: (e as Error).message }));
    }
  };

  const keyOf = (name: string) => keys.find((k) => k.provider === name);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'auto', padding: '4px 2px 16px' }}>
      {notice && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 13,
            background: notice.ok ? 'color-mix(in srgb, var(--success) 10%, var(--bg-card))' : 'color-mix(in srgb, var(--danger) 10%, var(--bg-card))',
            color: notice.ok ? 'var(--success)' : 'var(--danger)',
            border: `1px solid ${notice.ok ? 'color-mix(in srgb, var(--success) 24%, var(--bg-card))' : 'color-mix(in srgb, var(--danger) 24%, var(--bg-card))'}`
          }}
        >
          {notice.text}
        </div>
      )}

      {/* 分析模式 */}
      <section className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 4 }}>{t('settings.mode.title')}</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>{t('settings.mode.desc')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => onModeChange(m.key)}
                style={{
                  textAlign: 'left',
                  padding: 14,
                  borderRadius: 12,
                  border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-hairline)'}`,
                  background: active ? 'var(--accent-tint)' : 'var(--bg-card)',
                  boxShadow: active ? 'var(--shadow-lift)' : 'none',
                  transition: 'all 0.35s ease'
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 4 }}>
                  {t(m.badgeKey)} {t(m.titleKey)}
                  {active && <span style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 8 }}>{t('common.inUse')}</span>}
                </div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.65, whiteSpace: 'normal' }}>{t(m.descKey)}</div>
              </button>
            );
          })}
        </div>
        {mode === 'cloud' && payload && !payload.active && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--warning)' }}>
            {t('mode.noProvider')}
          </div>
        )}
      </section>

      {/* 大模型提供商 */}
      <section className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 650, fontSize: 14, flexShrink: 0 }}>{t('settings.llm.title')}</div>
          {providersOpen && <div className="muted" style={{ fontSize: 12 }}>{t('settings.llm.hint')}</div>}
          {!providersOpen && payload && (
            <span className="muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {payload.active
                ? t('llm.activeSummary', { name: providerLabel(payload.active) })
                : t('llm.count', { n: payload.providers.length })}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="btn-ghost"
            style={{ fontSize: 12, padding: '5px 12px' }}
            onClick={() => { setProvidersOpen(true); setCustomOpen((v) => !v); }}
            title={t('llm.custom.tip')}
          >
            {t('llm.custom')}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => refresh()}>{t('llm.refresh')}</button>
          <CollapseToggle open={providersOpen} onClick={() => setProvidersOpen((v) => !v)} />
        </div>

        {providersOpen && (
        <>
        {customOpen && (
          <div style={{ marginTop: 12, padding: 14, border: '1px dashed var(--border-hairline)', borderRadius: 12, background: 'var(--bg-recessed)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 650 }}>{t('llm.custom.title')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label={t('field.name')}>
                <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={t('field.name.ph')} style={inputStyle} />
              </Field>
              <Field label={t('field.url')}>
                <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://api.example.com/v1" style={inputStyle} />
              </Field>
              <Field label={t('field.key')}>
                <input value={customKey} onChange={(e) => setCustomKey(e.target.value)} placeholder="sk-..." type="password" style={inputStyle} />
              </Field>
              <Field label={t('field.model')}>
                <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder={t('field.model.ph')} style={inputStyle} />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ fontSize: 12.5 }} disabled={busy === 'custom'} onClick={submitCustom}>
                {busy === 'custom' ? t('provider.saving') : t('common.add')}
              </button>
              <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setCustomOpen(false)}>{t('common.cancel')}</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {(payload?.providers || []).map((p) => {
            const saved = keyOf(p.name);
            const isActive = payload?.active === p.name;
            const isEditing = editing === p.name;
            return (
              <div key={p.name} style={{ border: '1px solid var(--border-hairline)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: isActive ? 'var(--accent-tint)' : 'var(--bg-card)' }}>
                  <span
                    title={p.available ? t('provider.available') : t('provider.unavailable')}
                    style={{ width: 9, height: 9, borderRadius: '50%', background: p.available ? 'var(--success)' : '#D8D6D0', flexShrink: 0 }}
                  />
                  <strong style={{ fontSize: 13 }}>{providerLabel(p.name)}</strong>
                  {isActive && (
                    <span style={{ fontSize: 11, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 999, padding: '1px 9px' }}>
                      {t('provider.active')}
                    </span>
                  )}
                  {saved?.hasKey && <span className="muted mono" style={{ fontSize: 11 }}>{saved.maskedKey}</span>}
                  {saved?.model && <span className="muted" style={{ fontSize: 11 }}>{saved.model}</span>}
                  <div style={{ flex: 1 }} />
                  <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 11px' }} onClick={() => (isEditing ? setEditing(null) : openEditor(p.name))}>
                    {isEditing ? t('provider.collapse') : saved?.hasKey ? t('provider.edit') : t('provider.config')}
                  </button>
                  {!isActive && (
                    <button
                      className="btn-primary"
                      style={{ fontSize: 12, padding: '4px 12px' }}
                      disabled={!p.available || busy === p.name}
                      onClick={() => activate(p.name)}
                      title={p.available ? t('provider.activate') : t('provider.unavailable')}
                    >
                      {busy === p.name ? t('provider.activating') : t('provider.activate')}
                    </button>
                  )}
                  {saved?.hasKey && (
                    <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 11px', color: 'var(--danger)' }} onClick={() => removeProvider(p.name)}>
                      {t('provider.delete')}
                    </button>
                  )}
                </div>
                {isEditing && (
                  <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-hairline)', background: 'var(--bg-recessed)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {NEEDS_KEY[p.name] !== false && (
                      <Field label={t('provider.keyRequired')}>
                        <input
                          value={draftKey}
                          onChange={(e) => setDraftKey(e.target.value)}
                          placeholder={saved?.hasKey ? t('provider.keySavedPh', { masked: saved.maskedKey }) : t('provider.keyPh')}
                          type="password"
                          style={inputStyle}
                        />
                      </Field>
                    )}
                    <Field label={t('field.urlOptional')}>
                      <input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder={t('field.urlOptionalPh')} style={inputStyle} />
                    </Field>
                    <Field label={t('field.model')}>
                      <input value={draftModel} onChange={(e) => setDraftModel(e.target.value)} placeholder={t('field.modelOptionalPh')} style={inputStyle} />
                    </Field>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button className="btn-primary" style={{ fontSize: 12.5 }} disabled={busy === p.name} onClick={() => saveProvider(p.name)}>
                        {busy === p.name ? t('provider.saving') : t('provider.save')}
                      </button>
                      <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!payload && <div className="muted" style={{ fontSize: 13 }}>{t('common.loading')}</div>}
        </div>
        </>
        )}
      </section>

      {/* 记忆库：跨会话记忆管理 */}
      <section className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontWeight: 650, fontSize: 14 }}>{t('settings.memory.title')}</div>
          <div className="muted" style={{ fontSize: 12, flex: 1 }}>{t('settings.memory.desc')}</div>
          {(memories?.length || 0) > 0 && (
            <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 12px', color: 'var(--danger)' }} onClick={clearAllMemories}>
              {t('memory.clear')}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            value={memDraft}
            onChange={(e) => setMemDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitMemory()}
            placeholder={t('memory.addPh')}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button className="btn-primary" style={{ fontSize: 12.5 }} disabled={!memDraft.trim()} onClick={submitMemory}>
            {t('common.add')}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {memories === null && <div className="muted" style={{ fontSize: 13 }}>{t('common.loading')}</div>}
          {memories?.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>{t('memory.empty')}</div>}
          {memories?.map((m) => (
            <div
              key={m.id}
              className="selectable"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-recessed)', borderRadius: 9, fontSize: 12.5 }}
            >
              <span style={{ flex: 1, lineHeight: 1.6 }}>{m.text}</span>
              {m.createdAt && <span className="muted mono" style={{ fontSize: 10.5, flexShrink: 0 }}>{String(m.createdAt).slice(0, 16).replace('T', ' ')}</span>}
              <button
                className="btn-ghost"
                style={{ fontSize: 11.5, padding: '2px 8px', flexShrink: 0 }}
                title={t('provider.delete')}
                onClick={() => removeMemory(m.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 检查更新：自动对比 GitHub Releases 版本 */}
      <section className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 4 }}>{t('update.card.title')}</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          {t('update.card.curVer', { ver: checkResult?.currentVersion || currentVersion || updateInfo?.currentVersion || '' })} ({t('update.card.desc')})
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-primary" style={{ fontSize: 12.5 }} disabled={checkState === 'checking'} onClick={doCheckUpdate}>
            {checkState === 'checking' ? t('update.card.checking') : t('update.card.check')}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? t('update.card.advancedOn') : t('update.card.advanced')}
          </button>
        </div>

        {showAdvanced && (
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
              {t('update.card.advDesc')}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder={t('update.card.advPh')}
                style={{ flex: 1, border: '1px solid var(--border-hairline)', borderRadius: 9, padding: '7px 11px', fontSize: 12.5, outline: 'none', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
              />
              <button className="btn-ghost" style={{ fontSize: 12.5, flexShrink: 0 }} onClick={submitSource}>
                {t('update.card.save')}
              </button>
            </div>
          </div>
        )}

        {checkState === 'done' && checkResult && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 10,
              fontSize: 12.5,
              lineHeight: 1.7,
              background: checkResult.checked ? (checkResult.updateAvailable ? 'var(--accent-tint)' : 'color-mix(in srgb, var(--success) 10%, var(--bg-card))') : 'color-mix(in srgb, var(--warning) 10%, var(--bg-card))',
              color: checkResult.checked ? (checkResult.updateAvailable ? 'var(--accent)' : 'var(--success)') : 'var(--warning)',
              border: `1px solid ${checkResult.checked ? (checkResult.updateAvailable ? 'color-mix(in srgb, var(--accent) 30%, var(--bg-card))' : 'color-mix(in srgb, var(--success) 24%, var(--bg-card))') : 'color-mix(in srgb, var(--warning) 24%, var(--bg-card))'}`
            }}
          >
            {checkResult.checked ? (
              checkResult.updateAvailable ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 650 }}>{t('update.card.found', { ver: checkResult.latestVersion ?? '' })}</span>
                  {checkResult.notes && <span style={{ color: 'var(--text-muted)' }}>{checkResult.notes.slice(0, 100)}</span>}
                  {dlState?.status === 'downloading' ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ width: 140, height: 5, borderRadius: 3, background: 'var(--border-hairline)', overflow: 'hidden' }}>
                        <span
                          style={{
                            display: 'block',
                            width: `${dlState.percent || 0}%`,
                            height: '100%',
                            borderRadius: 3,
                            background: 'var(--accent)',
                            transition: 'width .3s ease'
                          }}
                        />
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>{t('update.card.dlProgress', { n: dlState.percent || 0 })}</span>
                    </span>
                  ) : dlState?.status === 'done' && dlState.filePath ? (
                    <button className="btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={installing} onClick={installNow}>
                      {installing ? t('update.installing') : t('update.install')}
                    </button>
                  ) : dlState?.status === 'error' ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--danger, #C0392B)', fontSize: 12 }}>{t('update.card.dlFailed', { err: dlState.error || t('update.unknownReason') })}</span>
                      {checkResult.download && (
                        <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => beginDownload(checkResult.download!, checkResult.latestVersion!, checkResult.digest)}>
                          {t('update.retry')}
                        </button>
                      )}
                    </span>
                  ) : checkResult.download ? (
                    <button className="btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => beginDownload(checkResult.download!, checkResult.latestVersion!, checkResult.digest)}>
                      {t('update.card.dlUpdate')}
                    </button>
                  ) : checkResult.url ? (
                    <button className="btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => openExternal(checkResult.url!).catch(() => {})}>
                      {t('update.goDownload')}
                    </button>
                  ) : null}
                </div>
              ) : (
                t('update.card.uptodate', { ver: checkResult.currentVersion })
              )
            ) : (
              t('update.card.checkFail', { reason: checkResult.reason || t('update.unknownReason') })
            )}
          </div>
        )}
      </section>

      {/* 更新记录：自更新/自修复历史 */}
      <section className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontWeight: 650, fontSize: 14 }}>{t('settings.updates.title')}</div>
            <div className="muted" style={{ fontSize: 12 }}>{t('settings.updates.desc')}</div>
          </div>
          {!updatesOpen && updates && updates.length > 0 && (
            <span className="muted" style={{ fontSize: 11.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={updates[0].updateContent || ''}>
              {t('updates.latest', { content: updates[0].updateContent || '—' })}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <CollapseToggle open={updatesOpen} onClick={() => setUpdatesOpen((v) => !v)} />
        </div>
        {updatesOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {updates === null && <div className="muted" style={{ fontSize: 12.5 }}>{t('updates.loadFail')}</div>}
          {updates?.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>{t('updates.empty')}</div>}
          {updates?.map((u, i) => {
            const st = UPDATE_STATUS_STYLE[String(u.status || '').toLowerCase()] || UPDATE_STATUS_STYLE.pending;
            return (
              <div key={u.id || i} className="selectable" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-recessed)', borderRadius: 9, fontSize: 12.5 }}>
                {u.createdAt && <span className="muted mono" style={{ fontSize: 10.5, flexShrink: 0 }}>{String(u.createdAt).slice(0, 16).replace('T', ' ')}</span>}
                {u.updateType && (
                  <span style={{ fontSize: 10.5, fontWeight: 650, color: 'var(--accent)', background: 'var(--accent-tint)', borderRadius: 6, padding: '1px 7px', flexShrink: 0 }}>
                    {u.updateType}
                  </span>
                )}
                <span style={{ flex: 1, lineHeight: 1.55, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.updateContent || ''}>
                  {u.updateContent || '—'}
                </span>
                {u.status && (
                  <span style={{ fontSize: 10.5, fontWeight: 650, color: st.color, background: `color-mix(in srgb, var(${st.mixKey === 'success' ? '--success' : st.mixKey === 'danger' ? '--danger' : '--warning'}) 12%, var(--bg-card))`, borderRadius: 6, padding: '1px 7px', flexShrink: 0 }}>
                    {u.status}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        )}
      </section>

      {/* MCP 接入：让外部程序通过 Model Context Protocol 调用智能体 */}
      <section className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 4 }}>{t('settings.mcp.title')}</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>{t('settings.mcp.desc')}</div>

        {mcp === null && <div className="muted" style={{ fontSize: 12.5 }}>{t('mcp.loadFail')}</div>}

        {mcp && (
          <>
            {/* 服务信息 */}
            <div className="selectable" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 12px', background: 'var(--bg-recessed)', borderRadius: 9, fontSize: 12.5 }}>
              <span style={{ fontWeight: 650 }}>{t('mcp.server')}</span>
              <span className="mono">{mcp.serverInfo.name} v{mcp.serverInfo.version}</span>
              <span className="muted mono">MCP {mcp.protocolVersion}</span>
              <span className="muted mono">{mcp.httpUrl}</span>
            </div>

            {/* 工具清单 */}
            <div style={{ fontSize: 12.5, fontWeight: 650, margin: '12px 0 8px' }}>{t('mcp.tools', { n: mcp.tools.length })}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {mcp.tools.map((tool) => (
                <span
                  key={tool.name}
                  title={tool.description}
                  className="mono"
                  style={{ fontSize: 11, fontWeight: 650, color: 'var(--accent)', background: 'var(--accent-tint)', borderRadius: 999, padding: '3px 10px', cursor: 'default' }}
                >
                  {tool.name}
                </span>
              ))}
            </div>

            {/* stdio 接入配置片段 */}
            <div style={{ fontSize: 12.5, fontWeight: 650, margin: '14px 0 4px' }}>{t('mcp.stdio.title')}</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.6 }}>{t('mcp.stdio.desc')}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <pre
                className="selectable mono"
                style={{ flex: 1, margin: 0, padding: '10px 12px', background: 'var(--bg-recessed)', borderRadius: 9, fontSize: 11.5, lineHeight: 1.6, overflowX: 'auto' }}
              >
                {JSON.stringify({ mcpServers: { 'mr-sliy': { command: mcp.stdio.command, args: mcp.stdio.args } } }, null, 2)}
              </pre>
              <button className="btn-ghost" style={{ fontSize: 12, padding: '0 14px', flexShrink: 0, alignSelf: 'flex-start', marginTop: 8 }} onClick={() => copyText('stdio', JSON.stringify({ mcpServers: { 'mr-sliy': { command: mcp.stdio.command, args: mcp.stdio.args } } }, null, 2))}>
                {copiedKey === 'stdio' ? t('mcp.copied') : t('mcp.copy')}
              </button>
            </div>

            {/* HTTP 接入 */}
            <div style={{ fontSize: 12.5, fontWeight: 650, margin: '14px 0 4px' }}>{t('mcp.http.title')}</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.6 }}>{t('mcp.http.desc')}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code className="selectable mono" style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-recessed)', borderRadius: 9, fontSize: 12 }}>{mcp.httpUrl}</code>
              <button className="btn-ghost" style={{ fontSize: 12, padding: '6px 14px', flexShrink: 0 }} onClick={() => copyText('http', mcp.httpUrl)}>
                {copiedKey === 'http' ? t('mcp.copied') : t('mcp.copy')}
              </button>
            </div>
          </>
        )}
      </section>

      {/* 外观设置 */}
      <section className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 4 }}>{t('settings.appearance.title')}</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>{t('settings.appearance.desc')}</div>

        {/* 日 / 夜模式 */}
        <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 8 }}>{t('appearance.daynight')}</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          {([
            { key: 'light' as ThemeMode, label: t('appearance.mode.light') },
            { key: 'dark' as ThemeMode, label: t('appearance.mode.dark') },
            { key: 'auto' as ThemeMode, label: t('appearance.mode.auto') }
          ]).map((m) => {
            const active = (appearance?.mode ?? 'auto') === m.key;
            return (
              <button
                key={m.key}
                onClick={() => onAppearanceChange({
                  theme: appearance?.theme ?? 'amber',
                  scale: appearance?.scale ?? 1,
                  mode: m.key
                })}
                style={{
                  padding: '6px 18px',
                  borderRadius: 999,
                  border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-hairline)'}`,
                  background: active ? 'var(--accent-tint)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: active ? 650 : 400,
                  fontSize: 12.5,
                  transition: 'all 0.3s ease'
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        {(appearance?.mode ?? 'auto') === 'auto' && (
          <div className="muted" style={{ fontSize: 11, marginBottom: 14 }}>{t('appearance.mode.autoDesc')}</div>
        )}
        <div style={{ height: 14 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 650 }}>{t('appearance.theme')}</div>
          {!themeOpen && (
            <>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--accent)', flexShrink: 0 }} />
              <span className="muted" style={{ fontSize: 11.5 }}>{t(themeOf(appearance?.theme ?? 'amber').name)}</span>
            </>
          )}
          <div style={{ flex: 1 }} />
          <CollapseToggle open={themeOpen} onClick={() => setThemeOpen((v) => !v)} />
        </div>
        {themeOpen && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          {THEMES.map((th) => {
            const active = appearance?.theme === th.key;
            const c = paletteOf(th.key, dark); // 预览跟随当前日/夜变体
            return (
              <button
                key={th.key}
                onClick={() => onAppearanceChange({
                  theme: th.key,
                  scale: appearance?.scale ?? 1,
                  mode: appearance?.mode ?? 'auto'
                })}
                title={t(th.name)}
                style={{
                  textAlign: 'left',
                  padding: 12,
                  borderRadius: 12,
                  border: `1.5px solid ${active ? c.accent : 'var(--border-hairline)'}`,
                  background: c.canvas,
                  boxShadow: active ? 'var(--shadow-lift)' : 'none',
                  transition: 'all 0.35s ease',
                  overflow: 'hidden'
                }}
              >
                {/* 配色预览条 */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 9 }}>
                  <span style={{ width: 20, height: 20, borderRadius: 7, background: c.accent, boxShadow: `0 2px 6px ${c.accent}55` }} />
                  <span style={{ width: 20, height: 20, borderRadius: 7, background: c.card, border: `1px solid ${c.border}` }} />
                  <span style={{ width: 20, height: 20, borderRadius: 7, background: c.recessed }} />
                  {active && (
                    <span style={{ marginLeft: 'auto', color: c.accent, fontSize: 13, fontWeight: 700 }}>✓</span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-primary)' }}>{t(th.name)}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {active ? t('common.inUse') : t('appearance.clickToApply')}
                </div>
              </button>
            );
          })}
        </div>
        )}

        <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 8 }}>{t('appearance.scale')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {SCALES.map((s) => {
            const active = (appearance?.scale ?? 1) === s.value;
            return (
              <button
                key={s.value}
                onClick={() => onAppearanceChange({
                  theme: appearance?.theme ?? 'amber',
                  scale: s.value,
                  mode: appearance?.mode ?? 'auto'
                })}
                style={{
                  padding: '6px 18px',
                  borderRadius: 999,
                  border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-hairline)'}`,
                  background: active ? 'var(--accent-tint)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: active ? 650 : 400,
                  fontSize: 12.5,
                  transition: 'all 0.3s ease'
                }}
              >
                {t(s.name)}
              </button>
            );
          })}
        </div>
      </section>

      {/* 语言 / Language */}
      <section className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 4 }}>{t('settings.lang.title')}</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>{t('settings.appearance.langDesc')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {LANGS.map((l) => {
            const active = lang === l.key;
            return (
              <button
                key={l.key}
                onClick={() => setLang(l.key)}
                style={{
                  padding: '6px 18px',
                  borderRadius: 999,
                  border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-hairline)'}`,
                  background: active ? 'var(--accent-tint)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: active ? 650 : 400,
                  fontSize: 12.5,
                  transition: 'all 0.3s ease'
                }}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      </section>

      {/* 关于 */}
      <section className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 6 }}>{t('settings.about.title')}</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
          {t('about.product')} · v{APP_VERSION}
          <br />
          {t('about.body')}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border-hairline)',
  borderRadius: 8,
  background: 'var(--bg-card)',
  padding: '8px 11px',
  fontSize: 13,
  fontFamily: 'var(--font-ui)',
  outline: 'none'
};
