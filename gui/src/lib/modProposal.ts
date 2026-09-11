/** 代码修改门控方案共享逻辑（主会话与编辑模式 AI 助手共用） */

/** 代码修改方案（<MODIFICATION> 块解析结果） */
export interface ModProposal {
  language?: string;
  originalCode: string;
  modifiedCode: string;
  summary?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  risks?: string[];
}

export type ModStatus = 'pending' | 'applied' | 'rejected' | 'superseded' | 'failed';

/** 风险等级徽章样式 */
export const RISK_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  low: { label: '低风险', color: '#1A7F37', bg: '#E9F7EF' },
  medium: { label: '中风险', color: '#9A6700', bg: '#FFF3D6' },
  high: { label: '高风险', color: '#CF222E', bg: '#FFEBE9' }
};

/** 从回复中解析 <MODIFICATION>{...}</MODIFICATION> 门控方案，返回展示文本与方案 */
export function parseReply(raw: string): { text: string; mod: ModProposal | null; parseFailed: boolean } {
  const m = raw.match(/<MODIFICATION>([\s\S]*?)<\/MODIFICATION>/i);
  if (!m) return { text: raw.trim(), mod: null, parseFailed: false };
  let mod: ModProposal | null = null;
  const inner = m[1].trim();
  try {
    mod = JSON.parse(inner);
  } catch {
    const j = inner.match(/\{[\s\S]*\}/);
    if (j) {
      try {
        mod = JSON.parse(j[0]);
      } catch {
        mod = null;
      }
    }
  }
  if (mod && (typeof mod.originalCode !== 'string' || typeof mod.modifiedCode !== 'string' || !mod.originalCode || !mod.modifiedCode)) {
    mod = null;
  }
  const text = raw.replace(/<MODIFICATION>[\s\S]*?<\/MODIFICATION>/i, '').trim();
  return { text, mod, parseFailed: !mod };
}
