import { useEffect, useState } from 'react';
import { health, getLlmUsage, LlmUsagePayload } from '../../ipc/client';

/** 数字千分位 */
const fmt = (n: number) => n.toLocaleString('en-US');

export default function StatusBar() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<LlmUsagePayload | null>(null);

  useEffect(() => {
    const check = () => health().then(() => setOk(true)).catch(() => setOk(false));
    check();
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, []);

  // 大模型用量轮询（5s），未启用云端提供商时保持 null
  useEffect(() => {
    if (!ok) return;
    let alive = true;
    const pull = () =>
      getLlmUsage()
        .then((u) => {
          if (alive) setUsage(u);
        })
        .catch(() => {});
    pull();
    const timer = setInterval(pull, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [ok]);

  const active = usage?.active || null;
  const session = usage?.session;
  const showLlm = !!active && !!session && session.requests > 0;

  return (
    <footer
      className="mono muted"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '6px 20px',
        fontSize: 12,
        background: 'var(--bg-card)',
        borderTop: '1px solid var(--border-hairline)'
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background:
            ok === null ? 'var(--warning)' : ok ? 'var(--success)' : 'var(--danger)'
        }}
      />
      <span>{ok === null ? '正在连接服务…' : ok ? 'Ready' : '服务未就绪'}</span>
      <span>services 5/5</span>
      {showLlm && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 650 }}>{active!.name}</span>
          <span>{fmt(session!.totalTokens)} tokens</span>
          {session!.cacheHitRate !== null && session!.cacheHitRate !== undefined && (
            <span title={`缓存命中 ${fmt(session!.cacheHitTokens)} / 未命中 ${fmt(session!.cacheMissTokens)}`}>
              缓存命中 {session!.cacheHitRate}%
            </span>
          )}
          <span title="本次运行期间大模型调用次数">{session!.requests} 次调用</span>
        </span>
      )}
    </footer>
  );
}
