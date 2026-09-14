import { useEffect, useState } from 'react';
import { issueStats, listProjects, type ProjectRow } from '../ipc/client';
import { t } from '../lib/i18n';

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
  unfixedSeverityStats?: StatRow[];
  projectSize?: { totalFiles?: number; totalLines?: number };
}

/** 严重度归一化：检测器可能输出 high/error、medium/warning、其余归低 */
function sevBucket(sev: unknown): 'high' | 'medium' | 'low' {
  const s = String(sev || '').toLowerCase();
  if (s.includes('high') || s.includes('error') || s.includes('critical')) return 'high';
  if (s.includes('medium') || s.includes('warn') || s.includes('moderate')) return 'medium';
  return 'low';
}

// ---- 质量评分:加权缺陷密度(兼顾问题占比与严重等级) ----
// 加权缺陷 = 高危×10 + 中危×3 + 低危×1(仅未修复)
// 密度 = 加权缺陷 / 每千行代码(KLOC 下限 1,小项目不吃亏)
// 扣分 = 密度 × 15 → 每千行 1 个加权缺陷扣 15 分,封顶扣 100
// 分母(项目行数)缺失时(旧版本扫描的存量项目)回退为加权计数 ×2 扣减
const W_HIGH = 10;
const W_MEDIUM = 3;
const W_LOW = 1;
const DENSITY_FACTOR = 15;

function computeQualityScore(
  unfixedSev: { high: number; medium: number; low: number },
  totalLines: number
): { score: number; densityBased: boolean } {
  const weighted = unfixedSev.high * W_HIGH + unfixedSev.medium * W_MEDIUM + unfixedSev.low * W_LOW;
  if (weighted === 0) return { score: 100, densityBased: totalLines > 0 };
  if (totalLines > 0) {
    const kloc = Math.max(totalLines / 1000, 1);
    const density = weighted / kloc;
    return { score: Math.round(Math.max(0, 100 - density * DENSITY_FACTOR)), densityBased: true };
  }
  return { score: Math.max(0, 100 - weighted * 2), densityBased: false };
}

export default function Dashboard({ onReady }: { onReady?: () => void }) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState('');

  // 加载项目列表，默认选中最近扫描(无扫描时间则按创建时间)的项目
  useEffect(() => {
    listProjects()
      .then((rows) => {
        setProjects(rows);
        if (rows.length === 0) {
          setErr('dash.empty');
          onReady?.();
          return;
        }
        const latest = [...rows].sort((a, b) =>
          String(b.last_scan_at || b.created_at || '').localeCompare(String(a.last_scan_at || a.created_at || ''))
        )[0];
        setProjectId(latest.id);
      })
      .catch(() => {
        setErr('dash.loadFail');
        onReady?.();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换项目后按该项目重新取统计（质量评分只反映当前项目的扫描情况）
  useEffect(() => {
    if (projectId == null) return;
    let cancelled = false;
    setStats(null);
    issueStats(projectId)
      .then((r: { success: boolean; data?: unknown }) => {
        if (cancelled) return;
        const d = r?.data as Stats | undefined;
        if (d && typeof d.total === 'number') setStats(d);
        else setErr('dash.empty');
        onReady?.();
      })
      .catch(() => {
        if (cancelled) return;
        setErr('dash.loadFail');
        onReady?.();
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const projectName = (id: number | null) => {
    const p = projects.find((x) => x.id === id);
    return p ? String(p.project_name || p.project_path || `#${p.id}`) : '';
  };

  if (projects.length === 0 && err) {
    return <div className="card" style={{ padding: 40, textAlign: 'center' }}><span className="muted">{t(err)}</span></div>;
  }

  const total = stats?.total ?? 0;
  const fixed = stats?.fixed ?? 0;
  const unfixed = stats?.unfixed ?? 0;
  const fixRate = total > 0 ? Math.round((fixed / total) * 100) : 0;

  // 未修复缺陷按严重度分桶 → 加权缺陷密度评分
  const unfixedSev = { high: 0, medium: 0, low: 0 };
  (stats?.unfixedSeverityStats || []).forEach((r) => {
    unfixedSev[sevBucket(r.severity)] += Number(r.count) || 0;
  });
  const totalLines = Number(stats?.projectSize?.totalLines) || 0;
  const { score, densityBased } = computeQualityScore(unfixedSev, totalLines);
  const scoreColor = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--danger)';

  const sev = { high: 0, medium: 0, low: 0 };
  (stats?.severityStats || []).forEach((r) => {
    sev[sevBucket(r.severity)] += Number(r.count) || 0;
  });

  const langs = (stats?.languageStats || [])
    .map((r) => ({ name: String(r.language || t('an.unknown')), count: Number(r.count) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const langMax = Math.max(1, ...langs.map((l) => l.count));

  const types = (stats?.typeStats || [])
    .map((r) => ({ name: String(r.issue_type || t('an.unknown')), count: Number(r.count) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', paddingBottom: 8 }}>
      {/* 项目选择器：概览与评分仅反映所选项目 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>{t('dash.selectProject')}</span>
        <select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(Number(e.target.value))}
          style={{ maxWidth: 360, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-recessed)', color: 'var(--text-primary)' }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{String(p.project_name || p.project_path || `#${p.id}`)}</option>
          ))}
        </select>
        {stats && <span className="muted" style={{ fontSize: 12 }}>{projectName(projectId)} · {t('dash.scannedAt')} {String(projects.find((x) => x.id === projectId)?.last_scan_at || '—').replace('T', ' ').slice(0, 19)}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: 'minmax(170px, auto)', gap: 16 }}>
        <div className="card" style={bento(2)}>
          <CardTitle>{t('dash.overview')}</CardTitle>
          {err && !stats ? (
            <Empty>{t(err)}</Empty>
          ) : total === 0 ? (
            <Empty>{t('dash.noData')}</Empty>
          ) : (
            <>
              <StatRow label={t('dash.totalIssues')} value={String(total)} />
              <StatRow label={t('dash.fixed')} value={String(fixed)} color="var(--success)" />
              <StatRow label={t('dash.pending')} value={String(unfixed)} color={unfixed > 0 ? 'var(--warning)' : undefined} />
              <div style={{ marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span className="muted">{t('dash.fixRate')}</span>
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
          <CardTitle>{t('dash.severity')}</CardTitle>
          {err && !stats ? <Empty>{t(err)}</Empty> : total === 0 ? <Empty>{t('dash.noData')}</Empty> : (
            <>
              <StatRow label={t('dash.high')} value={String(sev.high)} color="var(--danger)" />
              <StatRow label={t('dash.medium')} value={String(sev.medium)} color="var(--warning)" />
              <StatRow label={t('dash.low')} value={String(sev.low)} />
            </>
          )}
        </div>

        <div className="card" style={bento(1)}>
          <CardTitle>{t('dash.score')}</CardTitle>
          <div style={{ fontSize: 44, fontWeight: 700, color: scoreColor }}>{stats ? score : '—'}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {densityBased ? t('dash.scoreDescDensity') : t('dash.scoreDescLegacy')}
          </div>
        </div>

        <div className="card" style={bento(2)}>
          <CardTitle>{t('dash.languages')}</CardTitle>
          {langs.length === 0 ? <Empty>{t('dash.noData')}</Empty> : langs.map((l) => (
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
          <CardTitle>{t('dash.topTypes')}</CardTitle>
          {types.length === 0 ? <Empty>{t('dash.noData')}</Empty> : types.map((ty) => (
            <StatRow key={ty.name} label={ty.name} value={String(ty.count)} />
          ))}
        </div>
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

function StatRow({ label, value, color }: { label: string, value: string, color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
