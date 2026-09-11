import { useEffect, useState } from 'react';
import { issueStats } from '../ipc/client';

interface StatRow {
  [k: string]: unknown;
}

interface Stats {
  total: number;
  fixed: number;
  unfixed: number;
  typeStats: StatRow[];
  severityStats: StatRow[];
  languageStats: StatRow[];
}

/** 严重度归一化：检测器可能输出 high/error、medium/warning、其余归低 */
function sevBucket(sev: unknown): 'high' | 'medium' | 'low' {
  const s = String(sev || '').toLowerCase();
  if (s.includes('high') || s.includes('error') || s.includes('critical')) return 'high';
  if (s.includes('medium') || s.includes('warn') || s.includes('moderate')) return 'medium';
  return 'low';
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    issueStats()
      .then((r: { success: boolean; data?: unknown }) => {
        const d = r?.data as Stats | undefined;
        if (d && typeof d.total === 'number') setStats(d);
        else setErr('暂无统计数据');
      })
      .catch(() => setErr('获取统计数据失败，请确认服务已启动'));
  }, []);

  if (err) {
    return <div className="card" style={{ padding: 40, textAlign: 'center' }}><span className="muted">{err}</span></div>;
  }

  const total = stats?.total ?? 0;
  const fixed = stats?.fixed ?? 0;
  const unfixed = stats?.unfixed ?? 0;
  const fixRate = total > 0 ? Math.round((fixed / total) * 100) : 0;
  const score = Math.max(0, Math.min(100, 100 - unfixed * 2));
  const scoreColor = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--danger)';

  const sev = { high: 0, medium: 0, low: 0 };
  (stats?.severityStats || []).forEach((r) => {
    sev[sevBucket(r.severity)] += Number(r.count) || 0;
  });

  const langs = (stats?.languageStats || [])
    .map((r) => ({ name: String(r.language || '未知'), count: Number(r.count) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const langMax = Math.max(1, ...langs.map((l) => l.count));

  const types = (stats?.typeStats || [])
    .map((r) => ({ name: String(r.issue_type || '未知'), count: Number(r.count) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: 'minmax(170px, auto)', gap: 16, overflow: 'auto', paddingBottom: 8 }}>
      <div className="card" style={bento(2)}>
        <CardTitle>项目概览</CardTitle>
        {total === 0 ? (
          <Empty>还没有扫描数据 — 回到主工作区扫描文件后，这里会展示缺陷统计与质量趋势。</Empty>
        ) : (
          <>
            <StatRow label="缺陷总数" value={String(total)} />
            <StatRow label="已修复" value={String(fixed)} color="var(--success)" />
            <StatRow label="待处理" value={String(unfixed)} color={unfixed > 0 ? 'var(--warning)' : undefined} />
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                <span className="muted">修复率</span>
                <span style={{ fontWeight: 650 }}>{fixRate}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-recessed)', overflow: 'hidden' }}>
                <div style={{ width: `${fixRate}%`, height: '100%', background: 'var(--success)', borderRadius: 4, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card" style={bento(1)}>
        <CardTitle>严重度分布</CardTitle>
        {total === 0 ? <Empty>暂无数据</Empty> : (
          <>
            <StatRow label="高危" value={String(sev.high)} color="var(--danger)" />
            <StatRow label="中危" value={String(sev.medium)} color="var(--warning)" />
            <StatRow label="低危" value={String(sev.low)} />
          </>
        )}
      </div>

      <div className="card" style={bento(1)}>
        <CardTitle>质量评分</CardTitle>
        <div style={{ fontSize: 44, fontWeight: 700, color: scoreColor }}>{total === 0 ? '—' : score}</div>
        <div className="muted" style={{ fontSize: 12 }}>按未处理缺陷数扣减（每个 -2 分）</div>
      </div>

      <div className="card" style={bento(2)}>
        <CardTitle>语言分布</CardTitle>
        {langs.length === 0 ? <Empty>暂无数据</Empty> : langs.map((l) => (
          <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mono" style={{ fontSize: 12, width: 90, textAlign: 'right' }}>{l.name}</span>
            <div style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--bg-recessed)', overflow: 'hidden' }}>
              <div style={{ width: `${(l.count / langMax) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 5, transition: 'width 0.6s ease' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 650, width: 30 }}>{l.count}</span>
          </div>
        ))}
      </div>

      <div className="card" style={bento(1)}>
        <CardTitle>高频问题类型</CardTitle>
        {types.length === 0 ? <Empty>暂无数据</Empty> : types.map((t) => (
          <StatRow key={t.name} label={t.name} value={String(t.count)} />
        ))}
      </div>
    </div>
  );
}

function bento(span: number): React.CSSProperties {
  return { gridColumn: `span ${span}`, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 };
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 650, fontSize: 14 }}>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, margin: 'auto 0' }}>{children}</div>;
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
