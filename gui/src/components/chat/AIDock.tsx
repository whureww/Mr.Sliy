import { useEffect, useRef, useState } from 'react';
import { AnalysisMode, AnalyzeResult, ChatMsg, chatWithAI, getLlmProviders } from '../../ipc/client';
import { fileName } from '../../lib/analysis';
import { openContextMenu, copyText } from '../../lib/contextMenu';
import { ModProposal, ModStatus, RISK_STYLE, parseReply } from '../../lib/modProposal';
import { t, useLang } from '../../lib/i18n';
import ChatText from './ChatText';

interface Props {
  currentFile: { path: string; content: string } | null;
  result: AnalyzeResult | null;
  scanning: boolean;
  analysisMode: AnalysisMode;
  locked?: boolean; // 会话锁定：助手输入禁用
  /** 门控：应用代码修改（在当前文件中定位替换并保存），返回错误信息或 null（成功） */
  onApplyCode?: (originalCode: string, modifiedCode: string) => Promise<string | null>;
}

/** 代码修改方案（<MODIFICATION> 块解析结果） */
type ModStatusLocal = ModStatus;

interface Msg {
  from: 'user' | 'ai';
  /** 展示文本（已剥离 MODIFICATION 块） */
  text: string;
  /** 原始回复（含 MODIFICATION 块，用于对话历史保持方案上下文） */
  raw?: string;
  /** 该消息使用的模式（云对话 / 本地提示），用于气泡内标签 */
  mode?: 'cloud' | 'local';
  mod?: ModProposal | null;
  modStatus?: ModStatusLocal;
  applyError?: string;
  /** 大模型用量（tokens/缓存命中率）与耗时 */
  llm?: { tokens: number; cacheHitRate: number | null; requests: number; model: string | null };
  elapsed?: number;
}

/** 从回复中解析门控方案：parseReply 来自 lib/modProposal */

const codePreStyle: React.CSSProperties = {
  margin: '5px 0 0',
  padding: 8,
  background: 'var(--bg-recessed)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 8,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  lineHeight: 1.55,
  whiteSpace: 'pre',
  overflow: 'auto',
  maxHeight: 170
};

/** 风险等级 → i18n key（RISK_STYLE 仅取配色，文案走 DICT） */
const RISK_KEY: Record<string, string> = {
  low: 'ai.risk.low',
  medium: 'ai.risk.medium',
  high: 'ai.risk.high'
};

/** 编辑模式悬浮 AI 小框：收纳为右下角气泡，展开为紧凑对话窗 */
export default function AIDock({ currentFile, result, scanning, analysisMode, locked, onApplyCode }: Props) {
  useLang();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [thinking, setThinking] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  /** 是否配置了可用的大模型（聊天能力与分析模式无关，只要配置了即可对话） */
  const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** 当前 LLM 请求的中断控制器（停止按钮使用） */
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open, thinking]);

  // 打开助手时探测大模型可用性（配置了活跃提供商即可真聊天）
  useEffect(() => {
    if (!open) return;
    let alive = true;
    getLlmProviders()
      .then((p) => alive && setLlmAvailable(Boolean(p.active)))
      .catch(() => alive && setLlmAvailable(false));
    return () => {
      alive = false;
    };
  }, [open]);

  /** 本地固定提示（未配置大模型或调用失败时的兜底） */
  const localReply = (text: string): string => {
    if (!currentFile) return t('ai.noFile');
    const name = fileName(currentFile.path);
    if (scanning) return t('ai.scanning', { name });
    if (!result) return t('ai.needScan', { name });
    const high = (result.issues || []).filter((i) => {
      const s = (i.severity || '').toLowerCase();
      return s.includes('high') || s.includes('error');
    }).length;
    return t('ai.summary', { name, total: result.totalIssues, high });
  };

  const send = async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || locked || thinking) return;
    if (!override) setDraft('');
    const nextMsgs: Msg[] = [...msgs, { from: 'user', text }];
    setMsgs(nextMsgs);

    // 只要配置了大模型就走真实 LLM 对话（携带最近 12 条历史，服务端统一注入系统提示词）；
    // 分析模式（云/本地）仅影响扫描方式，不影响对话能力
    if (llmAvailable !== false) {
      setThinking(true);
      const started = Date.now();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const history: ChatMsg[] = nextMsgs.slice(-12).map((m) => ({
          role: m.from === 'user' ? 'user' : 'assistant',
          content: m.raw ?? m.text
        }));
        const res = await chatWithAI(history, null, controller.signal);
        const replyStr = typeof res.reply === 'string' ? res.reply : String(res.reply || '');
        const { text: display, mod, parseFailed } = parseReply(replyStr);
        const note = parseFailed ? '\n\n' + t('ai.parseFail') : '';
        // 用量换算：与服务端 scanRoutes 的 cacheHitRate 口径一致
        const u = (res.usage || null) as { totalTokens?: number; cacheHitTokens?: number; cacheMissTokens?: number } | null;
        const cacheTotal = u ? (u.cacheHitTokens || 0) + (u.cacheMissTokens || 0) : 0;
        setMsgs((m) => [
          ...m,
          {
            from: 'ai',
            text: display + note,
            raw: replyStr,
            mode: 'cloud',
            mod,
            modStatus: mod ? 'pending' : undefined,
            elapsed: Date.now() - started,
            llm:
              u && (u.totalTokens || 0) > 0
                ? {
                    tokens: u.totalTokens || 0,
                    cacheHitRate: cacheTotal > 0 ? Math.round(((u.cacheHitTokens || 0) / cacheTotal) * 1000) / 10 : null,
                    requests: 1,
                    model: null
                  }
                : undefined
          }
        ]);
      } catch {
        // 用户主动停止时不再回退到本地兜底提示
        setMsgs((m) => [...m, { from: 'ai', text: controller.signal.aborted ? t('ai.stopped') : localReply(text), mode: 'local' }]);
      } finally {
        abortRef.current = null;
        setThinking(false);
      }
      return;
    }

    // 未配置大模型：本地轻量提示
    setTimeout(() => {
      setMsgs((m) => [...m, { from: 'ai', text: localReply(text), mode: 'local' }]);
    }, 500);
  };

  /** 门控：确认应用修改到当前文件 */
  const applyMod = async (idx: number) => {
    const target = msgs[idx];
    if (!target?.mod) return;
    if (!onApplyCode) {
      setMsgs((ms) => ms.map((x, j) => (j === idx ? { ...x, modStatus: 'failed', applyError: t('ai.applyUnsupported') } : x)));
      return;
    }
    setApplyingIdx(idx);
    try {
      const err = await onApplyCode(target.mod.originalCode, target.mod.modifiedCode);
      setMsgs((ms) => ms.map((x, j) => (j === idx ? { ...x, modStatus: err ? 'failed' : 'applied', applyError: err ?? undefined } : x)));
    } catch (e) {
      setMsgs((ms) => ms.map((x, j) => (j === idx ? { ...x, modStatus: 'failed', applyError: (e as Error).message || t('ai.unknownErr') } : x)));
    } finally {
      setApplyingIdx(null);
    }
  };

  /** 门控：取消该修改建议 */
  const rejectMod = (idx: number) => {
    setMsgs((ms) => ms.map((x, j) => (j === idx ? { ...x, modStatus: 'rejected' } : x)));
  };

  /** 门控：不再采用当前方案，请 AI 换一种思路重新给出修改建议 */
  const askMoreIdeas = () => {
    setMsgs((ms) => ms.map((x) => (x.mod && x.modStatus === 'pending' ? { ...x, modStatus: 'superseded' } : x)));
    void send(t('ai.askMoreIdeas'));
  };

  return (
    <>
      {/* 展开的小对话框 */}
      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            right: 20,
            bottom: 20,
            width: 320,
            height: 430,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 50
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-hairline)' }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent)', color: '#FFF', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              AI
            </div>
            <strong style={{ fontSize: 13 }}>{t('ai.assistant')}</strong>
            <span className="muted" style={{ fontSize: 11 }}>
              {(llmAvailable ?? analysisMode === 'cloud') ? t('ai.tagCloud') : t('ai.tagLocal')}
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setOpen(false)}
              className="muted"
              style={{ background: 'transparent', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
              title={t('ai.collapse')}
            >
              ×
            </button>
          </div>
          <div ref={bodyRef} style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {msgs.length === 0 && (
              <div className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 24 }}>
                {t('ai.welcome')}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start' }}>
                <div
                  className="selectable"
                  onContextMenu={(e) => openContextMenu(e, [{ label: t('ai.copyContent'), onClick: () => copyText(m.text) }])}
                  style={{
                    background: m.from === 'user' ? 'var(--accent-tint)' : 'var(--bg-recessed)',
                    padding: '7px 11px',
                    borderRadius: m.from === 'user' ? '10px 10px 3px 10px' : '10px 10px 10px 3px',
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    maxWidth: m.from === 'ai' && m.mod ? '100%' : '88%',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}
                >
                  {m.from === 'ai' && (
                    <span className="muted" style={{ fontSize: 10.5, marginRight: 4 }}>
                      {m.mode === 'cloud' ? t('ai.tagCloud') : t('ai.tagLocal')}
                    </span>
                  )}
                  {m.text}

                  {/* 门控卡片：代码修改确认 */}
                  {m.from === 'ai' && m.mod && (
                    <div
                      style={{
                        marginTop: 8,
                        border: '1px solid var(--border-hairline)',
                        borderRadius: 8,
                        background: 'var(--bg-card)',
                        padding: 9,
                        fontSize: 12,
                        opacity: m.modStatus === 'superseded' || m.modStatus === 'rejected' ? 0.62 : 1
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong style={{ fontSize: 12 }}>{t('ai.confirm.title')}</strong>
                        {(() => {
                          const level = m.mod!.riskLevel || 'medium';
                          const risk = RISK_STYLE[level] || RISK_STYLE.medium;
                          return (
                            <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 99, fontWeight: 700, color: risk.color, background: risk.bg }}>
                              {t(RISK_KEY[level] || 'ai.risk.medium')}
                            </span>
                          );
                        })()}
                      </div>
                      {m.mod.summary && <div style={{ marginTop: 4, lineHeight: 1.5 }}>{m.mod.summary}</div>}
                      <div style={{ marginTop: 6 }}>
                        <details>
                          <summary className="muted" style={{ cursor: 'pointer', fontSize: 11, userSelect: 'none' }}>{t('ai.viewOriginal')}</summary>
                          <pre className="selectable" style={codePreStyle}>{m.mod.originalCode}</pre>
                        </details>
                        <details open>
                          <summary className="muted" style={{ cursor: 'pointer', fontSize: 11, userSelect: 'none', marginTop: 4 }}>{t('ai.viewModified')}</summary>
                          <pre className="selectable" style={codePreStyle}>{m.mod.modifiedCode}</pre>
                        </details>
                      </div>
                      {(m.mod.risks?.length || 0) > 0 && (
                        <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5 }}>
                          {m.mod.risks!.map((r, k) => (
                            <li key={k}>{r}</li>
                          ))}
                        </ul>
                      )}
                      {m.modStatus === 'pending' && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <button className="btn-primary" disabled={applyingIdx === i} onClick={() => applyMod(i)} style={{ fontSize: 11.5, padding: '5px 10px' }}>
                            {applyingIdx === i ? t('ai.applying') : t('ai.confirmApply')}
                          </button>
                          <button className="btn-ghost" onClick={askMoreIdeas} style={{ fontSize: 11.5, padding: '5px 10px' }}>
                            {t('ai.moreIdeas')}
                          </button>
                          <button className="btn-ghost" onClick={() => rejectMod(i)} style={{ fontSize: 11.5, padding: '5px 10px' }}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      )}
                      {m.modStatus === 'applied' && <div style={{ marginTop: 6, color: 'var(--success)', fontSize: 11.5 }}>{t('ai.applied')}</div>}
                      {m.modStatus === 'rejected' && <div className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>{t('ai.rejected')}</div>}
                      {m.modStatus === 'superseded' && <div className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>{t('ai.superseded')}</div>}
                      {m.modStatus === 'failed' && <div style={{ marginTop: 6, color: 'var(--danger)', fontSize: 11.5 }}>{t('ai.applyFailed', { err: m.applyError || t('ai.unknownErr') })}</div>}
                    </div>
                  )}

                  {/* 大模型用量：耗时 / tokens / 缓存命中率 */}
                  {m.from === 'ai' && m.mode === 'cloud' && (m.llm || m.elapsed != null) && (
                    <div
                      className="muted mono"
                      style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 8,
                        fontSize: 10.5,
                        marginTop: 6,
                        paddingTop: 5,
                        borderTop: '1px dashed var(--border-hairline)'
                      }}
                      title={m.llm ? t('ai.llmCalls', { n: m.llm.requests }) : undefined}
                    >
                      {m.elapsed != null && <span>{t('an.usage.time')} {(m.elapsed / 1000).toFixed(1)}s</span>}
                      {m.llm && m.llm.tokens > 0 && <span>{m.llm.tokens.toLocaleString('en-US')} tokens</span>}
                      {m.llm && m.llm.cacheHitRate != null && <span style={{ color: 'var(--accent)' }}>{t('an.usage.cache')} {m.llm.cacheHitRate}%</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {thinking && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div className="muted" style={{ background: 'var(--bg-recessed)', padding: '7px 11px', borderRadius: '10px 10px 10px 3px', fontSize: 12.5 }}>
                  {t('ai.thinking')}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--border-hairline)' }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder={locked ? t('wb.locked') : t('ai.inputPh')}
              disabled={locked}
              style={{
                flex: 1,
                border: '1px solid var(--border-hairline)',
                borderRadius: 8,
                padding: '7px 10px',
                fontSize: 12.5,
                outline: 'none',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)'
              }}
            />
            {thinking ? (
              <button
                className="btn-primary"
                onClick={() => abortRef.current?.abort()}
                title={t('ai.stop')}
                aria-label={t('ai.stop')}
                style={{ width: 47, padding: '7px 0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="5" y="5" width="14" height="14" rx="2.5" />
                </svg>
              </button>
            ) : (
              <button className="btn-primary" onClick={() => send()} disabled={locked} style={{ fontSize: 12, padding: '7px 12px' }}>
                {t('an.send')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 收起态气泡按钮 */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title={t('ai.title')}
          style={{
            position: 'absolute',
            right: 20,
            bottom: 20,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: '#FFF',
            fontWeight: 700,
            fontSize: 13,
            boxShadow: 'var(--shadow-soft)',
            zIndex: 50,
            transition: 'transform 0.35s ease, background 0.35s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.06)';
            e.currentTarget.style.background = 'var(--accent-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.background = 'var(--accent)';
          }}
        >
          AI
        </button>
      )}
    </>
  );
}
