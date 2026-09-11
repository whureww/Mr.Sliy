import { useEffect, useRef, useState } from 'react';
import { Issue, ProjectScanResult } from '../ipc/client';
import { ChatMessage, fileName, isHigh, severityColor, stepStatus } from '../lib/analysis';
import { ModProposal, RISK_STYLE } from '../lib/modProposal';
import { openContextMenu, copyText } from '../lib/contextMenu';
import ChatText from '../components/chat/ChatText';

interface Props {
  currentFile: { path: string; content: string } | null;
  messages: ChatMessage[];
  scanning: boolean;
  fixing: string | null;
  error: string;
  locked?: boolean; // 会话锁定：只读，禁用扫描/发送/修复
  busy?: boolean; // 聊天/扫描进行中（显示停止按钮）
  onSend: (text: string) => void;
  onScan: () => void;
  onFix: (issue: Issue) => void;
  onModAction: (action: 'apply' | 'reject' | 'more' | 'undo' | 'verify', msgId: number, mod: ModProposal) => void;
  onExportReport: (r: ProjectScanResult) => void;
  onStop: () => void;
}

/** 分析模式：对话流 + 分析过程时间线 + 问题卡片为主 */
export default function AnalysisView({
  currentFile,
  messages,
  scanning,
  fixing,
  error,
  locked,
  busy,
  onSend,
  onScan,
  onFix,
  onModAction,
  onExportReport,
  onStop
}: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const submit = () => {
    if (busy) return; // 回复/扫描进行中禁止重复提交
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    // "分析"类关键词或点击扫描按钮 → 触发流水线；其余走对话回复
    if (/分析|扫描|检测|scan/i.test(text) && currentFile) onScan();
    else onSend(text);
  };

  return (
    <section
      className="card"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
    >
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border-hairline)' }}>
        <strong style={{ fontSize: 14 }}>分析会话</strong>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {currentFile ? fileName(currentFile.path) : '未打开文件'}
        </span>
        {scanning && (
          <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>检测进行中…</span>
        )}
        {locked && (
          <span
            style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title="会话已锁定：只读，右键左侧会话可解锁"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
              <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
            </svg>
            已锁定
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn-primary" onClick={onScan} disabled={!currentFile || scanning || locked} title={locked ? '会话已锁定' : undefined}>
          {scanning ? '分析中…' : '开始分析'}
        </button>
      </div>

      {/* 对话流 */}
      <div ref={listRef} style={{ flex: 1, overflow: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {messages.length === 0 && (
          <div className="muted" style={{ textAlign: 'center', marginTop: 60, fontSize: 13, lineHeight: 2 }}>
            在左侧文件树展开目录并选择文件，或直接发送消息
            <br />
            点击"开始分析"后，这里会实时展示每一步的执行过程与问题结果
          </div>
        )}
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <div
                className="selectable"
                onContextMenu={(e) => openContextMenu(e, [{ label: '复制消息内容', onClick: () => copyText(msg.text || '') }])}
                style={{
                  background: 'var(--accent-tint)',
                  color: 'var(--text-primary)',
                  padding: '9px 14px',
                  borderRadius: '12px 12px 3px 12px',
                  maxWidth: '70%',
                  fontSize: 13.5,
                  lineHeight: 1.6
                }}
              >
                {msg.text}
              </div>
              {msg.time && <span className="muted" style={{ fontSize: 11, paddingRight: 2 }}>我 · {msg.time}</span>}
            </div>
          ) : (
            <AssistantMessage key={msg.id} msg={msg} fixing={fixing} locked={locked} onFix={onFix} onModAction={onModAction} onExportReport={onExportReport} />
          )
        )}
      </div>

      {/* 输入区 */}
      <div style={{ padding: '12px 16px 14px', borderTop: '1px solid var(--border-hairline)' }}>
        {error && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
        <div className={`ask-bar${!currentFile || locked ? ' disabled' : ''}`}>
          <input
            className="ask-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
            }}
            placeholder={locked ? '会话已锁定，请先解锁' : currentFile ? '描述你的问题，或输入"分析"触发检测流水线' : '请先在左侧选择文件'}
            disabled={!currentFile || scanning || locked}
          />
          {busy ? (
            <button className="ask-send stopping" onClick={onStop} title="中断当前回复 / 扫描" aria-label="停止">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="5" y="5" width="14" height="14" rx="2.5" />
              </svg>
            </button>
          ) : (
            <button
              className="ask-send"
              onClick={submit}
              disabled={!currentFile || locked || !draft.trim()}
              title="发送 (Enter)"
              aria-label="发送"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22l-4-9-9-4Z" />
              </svg>
            </button>
          )}
        </div>
        <div className="ask-hint">
          <span>输入</span>
          <kbd>分析</kbd>
          <span>触发检测流水线 · Enter 发送</span>
        </div>
      </div>
    </section>
  );
}

function AssistantMessage({
  msg,
  fixing,
  locked,
  onFix,
  onModAction,
  onExportReport
}: {
  msg: ChatMessage;
  fixing: string | null;
  locked?: boolean;
  onFix: (issue: Issue) => void;
  onModAction: (action: 'apply' | 'reject' | 'more' | 'undo' | 'verify', msgId: number, mod: ModProposal) => void;
  onExportReport: (r: ProjectScanResult) => void;
}) {
  const typing = !!msg.typing;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      {/* 头像 */}
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          background: 'var(--accent)',
          color: '#FFF',
          fontSize: 10,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 2
        }}
      >
        AI
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '86%', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 650 }}>MR·SLIY</span>
          {msg.time && <span className="muted" style={{ fontSize: 11 }}>{msg.time}</span>}
        </div>
        <div
          className="selectable"
          onContextMenu={(e) =>
            openContextMenu(e, [
              {
                label: '复制回复内容',
                disabled: !msg.text,
                onClick: () =>
                  copyText(
                    msg.text ||
                      (msg.issues
                        ? `检测完成 · ${msg.total} 个问题${msg.lang ? ` · ${msg.lang}` : ''}`
                        : '')
                  )
              }
            ])
          }
          style={{
            background: 'var(--bg-recessed)',
            padding: '12px 16px',
            borderRadius: '3px 12px 12px 12px',
            fontSize: 13.5,
            lineHeight: 1.7
          }}
        >
          {/* 打字指示 */}
          {typing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0' }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="typing-dot"
                  style={{ animationDelay: `${i * 0.18}s` }}
                />
              ))}
              <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>正在组织回复…</span>
            </div>
          )}

          {/* 分析过程时间线 */}
          {msg.steps && (
            <div style={{ marginBottom: msg.issues || msg.error ? 12 : 0 }}>
              <div className="muted" style={{ fontSize: 11.5, letterSpacing: 1, marginBottom: 8 }}>
                分析过程{msg.elapsed != null && ` · 总耗时 ${(msg.elapsed / 1000).toFixed(1)}s`}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {msg.steps.map((s, i) => {
                  const st = stepStatus(s);
                  const last = i === msg.steps!.length - 1;
                  return (
                    <div key={i} style={{ display: 'flex', gap: 10 }}>
                      {/* 节点 + 连接线 */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        {st === 'done' ? (
                          <span
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              background: 'var(--success)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <svg width="9" height="9" viewBox="0 0 10 10">
                              <path d="M1.5 5.5 L4 8 L8.5 2" stroke="#FFF" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                            </svg>
                          </span>
                        ) : st === 'active' ? (
                          <span
                            className="step-active-ring"
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: '2px solid var(--accent)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
                          </span>
                        ) : (
                          <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #CFCDC7', boxSizing: 'border-box' }} />
                        )}
                        {!last && (
                          <span
                            style={{
                              width: 2,
                              flex: 1,
                              minHeight: 10,
                              margin: '2px 0',
                              borderRadius: 1,
                              background: st === 'done' ? 'var(--success)' : 'var(--border-hairline)',
                              opacity: st === 'done' ? 0.5 : 1
                            }}
                          />
                        )}
                      </div>
                      {/* 文案 */}
                      <div style={{ paddingBottom: last ? 0 : 10 }}>
                        <div style={{ fontSize: 13, fontWeight: st === 'pending' ? 400 : 650, color: st === 'active' ? 'var(--accent)' : 'inherit' }}>
                          {s.label}
                          {st === 'active' && <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>执行中…</span>}
                          {st === 'done' && s.ms != null && (
                            <span className="muted" style={{ fontWeight: 400, fontSize: 11.5, marginLeft: 8 }}>
                              {(s.ms / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                        {st !== 'pending' && <div className="muted" style={{ fontSize: 12 }}>{s.detail}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {msg.error && (
            <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: msg.text ? 6 : 0 }}>{msg.error}</div>
          )}

          {msg.text && <ChatText text={msg.text} streaming={msg.streaming} />}

          {/* 门控卡片：代码修改确认 */}
          {msg.mod && (
            <div
              style={{
                marginTop: 10,
                border: '1px solid var(--border-hairline)',
                borderRadius: 10,
                background: 'var(--bg-card)',
                padding: 12,
                fontSize: 12.5,
                opacity: msg.modStatus === 'superseded' || msg.modStatus === 'rejected' ? 0.62 : 1
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 13 }}>代码修改确认</strong>
                {(() => {
                  const risk = RISK_STYLE[msg.mod!.riskLevel || 'medium'] || RISK_STYLE.medium;
                  return (
                    <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 99, fontWeight: 700, color: risk.color, background: risk.bg }}>
                      {risk.label}
                    </span>
                  );
                })()}
              </div>
              {msg.mod.summary && <div style={{ marginTop: 6, lineHeight: 1.6 }}>{msg.mod.summary}</div>}
              <div style={{ marginTop: 8 }}>
                <details>
                  <summary className="muted" style={{ cursor: 'pointer', fontSize: 12, userSelect: 'none' }}>查看原代码</summary>
                  <pre
                    className="selectable mono"
                    style={{ margin: '6px 0 0', padding: 10, background: 'var(--bg-recessed)', border: '1px solid var(--border-hairline)', borderRadius: 8, fontSize: 11.5, lineHeight: 1.55, whiteSpace: 'pre', overflow: 'auto', maxHeight: 190 }}
                  >
                    {msg.mod.originalCode}
                  </pre>
                </details>
                <details open>
                  <summary className="muted" style={{ cursor: 'pointer', fontSize: 12, userSelect: 'none', marginTop: 6 }}>查看修改后代码</summary>
                  <pre
                    className="selectable mono"
                    style={{ margin: '6px 0 0', padding: 10, background: 'var(--bg-recessed)', border: '1px solid var(--border-hairline)', borderRadius: 8, fontSize: 11.5, lineHeight: 1.55, whiteSpace: 'pre', overflow: 'auto', maxHeight: 190 }}
                  >
                    {msg.mod.modifiedCode}
                  </pre>
                </details>
              </div>
              {(msg.mod.risks?.length || 0) > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
                  {msg.mod.risks!.map((r, k) => (
                    <li key={k}>{r}</li>
                  ))}
                </ul>
              )}
              {msg.modStatus === 'pending' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn-primary" disabled={locked} title={locked ? '会话已锁定' : undefined} onClick={() => onModAction('apply', msg.id, msg.mod!)} style={{ fontSize: 12, padding: '6px 12px' }}>
                    ✓ 确认修改
                  </button>
                  <button className="btn-ghost" onClick={() => onModAction('more', msg.id, msg.mod!)} style={{ fontSize: 12, padding: '6px 12px' }}>
                    更多想法
                  </button>
                  <button className="btn-ghost" onClick={() => onModAction('reject', msg.id, msg.mod!)} style={{ fontSize: 12, padding: '6px 12px' }}>
                    取消
                  </button>
                </div>
              )}
              {msg.modStatus === 'applied' && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--success)', fontSize: 12.5 }}>已应用并保存到文件</span>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    disabled={locked}
                    title={locked ? '会话已锁定' : '将文件恢复为修改前内容'}
                    onClick={() => onModAction('undo', msg.id, msg.mod!)}
                  >
                    撤销修改
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    disabled={locked}
                    title={locked ? '会话已锁定' : '重新扫描当前文件，验证修改效果'}
                    onClick={() => onModAction('verify', msg.id, msg.mod!)}
                  >
                    重新扫描验证
                  </button>
                </div>
              )}
              {msg.modStatus === 'undone' && <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>已撤销，文件已恢复到修改前内容（可重新扫描确认）</div>}
              {msg.modStatus === 'rejected' && <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>已取消该修改建议</div>}
              {msg.modStatus === 'superseded' && <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>已被新的修改方案取代</div>}
              {msg.modStatus === 'failed' && <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: 12.5 }}>应用失败：{msg.applyError || '未知错误'}</div>}
            </div>
          )}

          {/* 结果汇总 + 问题卡片 */}
          {msg.issues && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', paddingTop: 10, borderTop: '1px solid var(--border-hairline)' }}>
                <span style={{ background: 'var(--accent-tint)', color: 'var(--accent)', fontSize: 12, fontWeight: 650, padding: '3px 10px', borderRadius: 6 }}>
                  {msg.tag === 'cloud' ? '[大模型]' : '[本地]'}
                </span>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  检测完成 · {msg.total} 个问题{msg.lang && ` · ${msg.lang}`}
                  {(msg.issues || []).some((i) => isHigh(i.severity)) && (
                    <span style={{ color: 'var(--danger)', fontWeight: 600 }}> · 存在高危项</span>
                  )}
                </span>
              </div>
              <IssueGrid
                issues={msg.issues || []}
                fixing={fixing}
                locked={locked}
                onFix={onFix}
              />
              {msg.total === 0 && (
                <div style={{ color: 'var(--success)', fontSize: 13 }}>未发现问题，代码质量良好。</div>
              )}
            </>
          )}

          {/* 项目级扫描结果卡片 */}
          {msg.projScan && (
            <div
              onContextMenu={(e) => openContextMenu(e, [{ label: '导出 HTML 报告', onClick: () => onExportReport(msg.projScan!) }])}
              style={{ marginTop: 10, border: '1px solid var(--border-hairline)', borderRadius: 10, background: 'var(--bg-card)', padding: 12, fontSize: 12.5 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>项目扫描报告</strong>
                <span className="mono muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>{msg.projScan.projectPath}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                <span>
                  扫描文件 <strong>{msg.projScan.scannedFiles}</strong>/{msg.projScan.totalFiles}
                  {msg.projScan.failedFiles > 0 && <span style={{ color: 'var(--danger)' }}>（失败 {msg.projScan.failedFiles}）</span>}
                </span>
                <span>
                  问题总数 <strong style={{ color: msg.projScan.totalIssues > 0 ? 'var(--warning)' : 'var(--success)' }}>{msg.projScan.totalIssues}</strong>
                </span>
                <span className="muted">耗时 {(msg.projScan.durationMs / 1000).toFixed(1)}s</span>
              </div>
              {/* 问题最多的文件 Top5 */}
              {(msg.projScan.results || []).filter((f) => (f.totalIssues || 0) > 0).length > 0 && (
                <div style={{ marginTop: 8, borderTop: '1px dashed var(--border-hairline)', paddingTop: 8 }}>
                  <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>问题集中的文件</div>
                  {[...(msg.projScan.results || [])]
                    .sort((a, b) => (b.totalIssues || 0) - (a.totalIssues || 0))
                    .slice(0, 5)
                    .map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                        <span className="mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {f.filePath || f.path || f.file}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 650,
                            color: (f.totalIssues || 0) > 0 ? 'var(--warning)' : 'var(--success)',
                            flexShrink: 0
                          }}
                        >
                          {f.totalIssues || 0} 个
                        </span>
                      </div>
                    ))}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => onExportReport(msg.projScan!)}>
                  导出 HTML 报告
                </button>
              </div>
            </div>
          )}

          {/* 云端大模型用量：对话结尾右下角（对话回复附耗时，分析消息的耗时在过程时间线中展示） */}
          {((msg.llm && msg.llm.tokens > 0) || (!msg.steps && msg.elapsed != null)) && (
            <div
              className="muted mono"
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
                fontSize: 11,
                marginTop: 8,
                paddingTop: 6,
                borderTop: '1px dashed var(--border-hairline)'
              }}
              title={`模型 ${msg.llm?.model || '未知'} · 共 ${msg.llm?.requests ?? 1} 次调用`}
            >
              {!msg.steps && msg.elapsed != null && <span>耗时 {(msg.elapsed / 1000).toFixed(1)}s</span>}
              {msg.llm && msg.llm.tokens > 0 && <span>{msg.llm.tokens.toLocaleString('en-US')} tokens</span>}
              {msg.llm && msg.llm.cacheHitRate !== null && msg.llm.cacheHitRate !== undefined && (
                <span style={{ color: 'var(--accent)' }}>缓存命中 {msg.llm.cacheHitRate}%</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 问题卡片网格：双列紧凑布局，超过 8 个默认折叠（右键卡片可修复/复制） */
function IssueGrid({
  issues,
  fixing,
  locked,
  onFix
}: {
  issues: Issue[];
  fixing: string | null;
  locked?: boolean;
  onFix: (issue: Issue) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? issues : issues.slice(0, 8);
  if (issues.length === 0) return null;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {shown.map((iss, i) => (
          <div
            key={i}
            onContextMenu={(e) =>
              openContextMenu(e, [
                { label: '修复此问题', disabled: fixing !== null || locked, title: locked ? '会话已锁定' : undefined, onClick: () => onFix(iss) },
                {
                  label: '复制问题描述',
                  onClick: () => copyText(`${iss.issueType}${iss.line != null ? ` (L${iss.line})` : ''}：${iss.message}`)
                }
              ])
            }
            style={{
              background: 'var(--bg-card)',
              borderRadius: 8,
              padding: '8px 10px',
              border: '1px solid var(--border-hairline)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minWidth: 0
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: severityColor(iss.severity), flexShrink: 0 }} />
              <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {iss.issueType}
              </span>
              {isHigh(iss.severity) && (
                <span style={{ fontSize: 10.5, color: 'var(--danger)', fontWeight: 600, flexShrink: 0 }}>高危</span>
              )}
              {iss.line != null && <span className="muted" style={{ fontSize: 10.5, flexShrink: 0 }}>L{iss.line}</span>}
              <span style={{ flex: 1 }} />
              <button
                className="btn-primary"
                style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0 }}
                onClick={() => onFix(iss)}
                disabled={fixing !== null || locked}
                title={locked ? '会话已锁定' : undefined}
              >
                {fixing === iss.issueType ? '生成中…' : '修复'}
              </button>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>{iss.message}</div>
          </div>
        ))}
      </div>
      {issues.length > 8 && (
        <button
          className="btn-ghost"
          style={{ fontSize: 12, padding: '5px 12px', marginTop: 8 }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起问题列表' : `展开全部 ${issues.length} 个问题`}
        </button>
      )}
    </div>
  );
}
