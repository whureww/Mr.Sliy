import { Issue, ProjectScanResult } from '../ipc/client';
import { ModProposal } from './modProposal';
import { t } from './i18n';

export type WorkbenchMode = 'analysis' | 'editor';

export type StepStatus = 'pending' | 'active' | 'done';

export interface AnalysisStep {
  label: string;
  detail: string;
  /** 兼容旧会话数据：新代码以 status 为准 */
  done: boolean;
  status?: StepStatus;
  /** 步骤耗时（毫秒） */
  ms?: number;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text?: string;
  steps?: AnalysisStep[];
  issues?: Issue[];
  total?: number;
  lang?: string;
  error?: string;
  /** AI 正在组织回复（打字指示气泡） */
  typing?: boolean;
  /** 整条分析的总耗时（毫秒） */
  elapsed?: number;
  /** 消息时间 HH:MM */
  time?: string;
  /** 本次分析执行方式：local=本地知识库 / cloud=大模型增强 */
  tag?: 'local' | 'cloud';
  /** 云端大模型用量（仅 cloud 模式且调用成功时存在） */
  llm?: { tokens: number; cacheHitRate: number | null; requests: number; model: string | null };
  /** LLM 原始回复（含 MODIFICATION 块，用于对话历史） */
  raw?: string;
  /** 代码修改门控方案（助手回复附带时存在） */
  mod?: ModProposal | null;
  /** 门控状态 */
  modStatus?: 'pending' | 'applied' | 'rejected' | 'superseded' | 'failed' | 'undone';
  /** 门控应用失败的错误信息 */
  applyError?: string;
  /** 应用修改前的文件内容（用于一键撤销本次修改） */
  modPrevContent?: string;
  /** 项目级扫描结果卡片 */
  projScan?: ProjectScanResult;
  /** 正在流式输出中 */
  streaming?: boolean;
}

export const fileName = (p: string) => p.split(/[\\/]/).pop() || p;

export const nowTime = (): string =>
  new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

/** 兼容旧数据：缺 status 时由 done 推导 */
export const stepStatus = (s: AnalysisStep): StepStatus => s.status || (s.done ? 'done' : 'pending');

/** 还原持久化会话时清除悬挂的 typing 状态与冻结的"执行中"步骤（进程中断残留） */
export const sanitizeMessages = (msgs: ChatMessage[]): ChatMessage[] =>
  msgs.map((m) => {
    const fixed: ChatMessage = { ...m };
    if (m.typing) {
      fixed.typing = false;
      fixed.text = m.text || t('chat.interrupted');
    }
    if (m.streaming) {
      fixed.streaming = false;
      fixed.text = m.text || t('chat.interrupted');
    }
    if (m.steps?.some((s) => stepStatus(s) === 'active')) {
      fixed.steps = m.steps.map((s) =>
        stepStatus(s) === 'active' ? { ...s, status: 'done' as StepStatus, done: true } : s
      );
    }
    return fixed;
  });

export const isHigh = (sev?: string): boolean => {
  const s = (sev || '').toLowerCase();
  return s.includes('high') || s.includes('error');
};

export const severityColor = (sev?: string): string => {
  const s = (sev || '').toLowerCase();
  if (isHigh(s)) return 'var(--danger)';
  if (s.includes('medium') || s.includes('warn')) return 'var(--warning)';
  return 'var(--text-muted)';
};
