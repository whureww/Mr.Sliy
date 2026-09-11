import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeFile, AnalysisMode, AnalyzeResult, Issue, listDir, readFile, saveFile, loadState, saveState, chatWithAIStream, getLlmProviders, projectScan, generateReport, ProjectScanResult } from '../ipc/client';
import { DiffPayload } from '../App';
import { optimizeCode } from '../ipc/client';
import { openContextMenu, copyText } from '../lib/contextMenu';
import { ModProposal, parseReply } from '../lib/modProposal';
import AnalysisView from './AnalysisView';
import AIDock from '../components/chat/AIDock';
import CodeEditor from '../components/editor/CodeEditor';
import WorkspaceNav, { Workspace } from '../components/nav/WorkspaceNav';
import {
  WorkbenchMode,
  ChatMessage,
  AnalysisStep,
  StepStatus,
  fileName,
  isHigh,
  nowTime,
  sanitizeMessages,
  severityColor
} from '../lib/analysis';

export type { WorkbenchMode };

interface Props {
  mode: WorkbenchMode;
  onModeChange: (m: WorkbenchMode) => void;
  onOpenDiff: (p: DiffPayload) => void;
  analysisMode: AnalysisMode;
}

/** 编辑器多标签页：每个标签持有独立内容/磁盘基线/扫描结果 */
interface EditorTab {
  path: string;
  content: string;
  disk: string;
  result: AnalyzeResult | null;
}

interface Session {
  currentFile: { path: string; content: string } | null;
  result: AnalyzeResult | null;
  messages: ChatMessage[];
  tabs?: EditorTab[];
}

const PIPELINE: Omit<AnalysisStep, 'done'>[] = [
  { label: '解析源码', detail: 'Tree-sitter 词法与语法解析' },
  { label: '构建 AST', detail: '抽象语法树与作用域分析' },
  { label: '规则检测', detail: '缺陷规则与代码坏味道匹配' },
  { label: '知识库比对', detail: 'RAG 检索相似案例与修复方案' },
  { label: '生成结论', detail: '汇总问题清单与优化建议' }
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Workbench({ mode, onModeChange, onOpenDiff, analysisMode }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWs, setActiveWs] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<{ path: string; content: string } | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** 磁盘基线内容：用于未保存标记（dirty = 编辑内容 ≠ 磁盘内容） */
  const [diskContent, setDiskContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  /** 编辑器多标签页（编辑模式）：与 currentFile 双向同步 */
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  /** 聊天/扫描中断控制器：停止按钮使用 */
  const chatAbort = useRef<AbortController | null>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const msgId = useRef(1);
  const sessionMap = useRef<Map<string, Session>>(new Map());
  const restoring = useRef(false);
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 持久化（防抖 600ms）到 ~/.mr-sliy/gui-state/guiState.json */
  const scheduleSave = useCallback(() => {
    if (!loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const sessions: Record<string, Session> = {};
      sessionMap.current.forEach((v, k) => (sessions[k] = v));
      saveState('guiState', JSON.stringify({ workspaces, activeWs, sessions })).catch(() => {});
    }, 600);
  }, [workspaces, activeWs]);

  /** 会话内容（文件/结果/消息/标签页）变化时写回当前工作区的会话缓存 */
  useEffect(() => {
    if (!activeWs || restoring.current) return;
    sessionMap.current.set(activeWs, { currentFile, result, messages, tabs });
    scheduleSave();
  }, [currentFile, result, messages, tabs, activeWs, scheduleSave]);

  const newId = () => msgId.current++;

  const emptySession = (): Session => ({ currentFile: null, result: null, messages: [] });

  /** 切换激活工作区：保存当前会话 → 恢复目标会话（文件树由 WorkspaceNav 自行加载） */
  const switchTo = async (path: string) => {
    if (path === activeWs) return;
    restoring.current = true;
    if (activeWs) {
      sessionMap.current.set(activeWs, { currentFile, result, messages, tabs });
    }
    setActiveWs(path);
    const s = sessionMap.current.get(path) || emptySession();
    setCurrentFile(s.currentFile);
    setDiskContent(s.currentFile?.content ?? null);
    setResult(s.result);
    setMessages(sanitizeMessages(s.messages));
    setTabs(s.tabs || (s.currentFile ? [{ path: s.currentFile.path, content: s.currentFile.content, disk: s.currentFile.content, result: s.result }] : []));
    setError('');
    restoring.current = false;
    scheduleSave();
  };

  /** 新建工作区：验证目录可读 → 加入列表 → 激活为新对话 */
  const addWorkspace = async (raw: string): Promise<string | null> => {
    const p = raw.trim().replace(/[\\/]+$/, '');
    if (!p) return '请输入或选择路径';
    if (workspaces.some((w) => w.path.toLowerCase() === p.toLowerCase())) return '该路径已在列表中';
    try {
      await listDir(p);
    } catch {
      return '目录不存在或无法读取';
    }
    const ws: Workspace = { path: p, name: fileName(p) };
    setWorkspaces((w) => [...w, ws]);
    sessionMap.current.set(p, {
      currentFile: null,
      result: null,
      messages: [
        {
          id: newId(),
          role: 'assistant',
          text: `已创建工作区「${ws.name}」。在左侧文件树展开目录并选择一个文件开始分析，或直接发送你的问题。`,
          time: nowTime()
        }
      ]
    });
    restoring.current = true;
    setActiveWs(p);
    setCurrentFile(null);
    setDiskContent(null);
    setResult(null);
    setTabs([]);
    setMessages(sessionMap.current.get(p)!.messages);
    setError('');
    restoring.current = false;
    scheduleSave();
    return null;
  };

  const removeWorkspace = (p: string) => {
    if (workspaces.find((w) => w.path === p)?.locked) return; // 锁定中不可移除
    sessionMap.current.delete(p);
    const next = workspaces.filter((w) => w.path !== p);
    setWorkspaces(next);
    if (p === activeWs) {
      if (next.length) switchTo(next[0].path);
      else {
        setActiveWs(null);
        setCurrentFile(null);
        setDiskContent(null);
        setResult(null);
        setTabs([]);
        setMessages([]);
      }
    }
    scheduleSave();
  };

  /** 锁定/解锁工作区：锁定后不可移除，会话内容只读（防误删误操作） */
  const toggleLock = (p: string) => {
    setWorkspaces((ws) => ws.map((w) => (w.path === p ? { ...w, locked: !w.locked } : w)));
    scheduleSave();
  };

  /** 当前会话是否锁定 */
  const activeLocked = !!workspaces.find((w) => w.path === activeWs)?.locked;

  /** 未保存标记：编辑内容 ≠ 磁盘内容 */
  const dirty = !!currentFile && currentFile.content !== diskContent;

  /** 保存编辑内容到磁盘文件 */
  const saveToDisk = async () => {
    if (!currentFile || saving || activeLocked) return;
    setSaving(true);
    try {
      await saveFile(currentFile.path, currentFile.content);
      setDiskContent(currentFile.content);
      setTabs((t) => t.map((x) => (x.path === currentFile.path ? { ...x, disk: currentFile.content, content: currentFile.content } : x)));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
    } catch (e) {
      setError(`保存失败: ${(e as Error).message || '无法写入文件'}`);
    } finally {
      setSaving(false);
    }
  };

  /** 编辑内容更新：currentFile 与对应标签页同步 */
  const updateContent = (v: string) => {
    setCurrentFile((f) => {
      if (!f) return f;
      setTabs((t) => t.map((x) => (x.path === f.path ? { ...x, content: v } : x)));
      return { ...f, content: v };
    });
  };

  /** 定时自动扫描：激活工作区开启定时后，按间隔触发当前文件的静默扫描 */
  useEffect(() => {
    const ws = workspaces.find((w) => w.path === activeWs);
    const minutes = ws?.scheduleMinutes || 0;
    if (!minutes || mode !== 'analysis') return;
    const timer = setInterval(() => {
      if (!scanning && !activeLocked && currentFile) {
        void runScan(`定时扫描（每 ${minutes} 分钟）：${fileName(currentFile.path)}`);
      }
    }, minutes * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, activeWs, mode, scanning, activeLocked, currentFile]);

  /** 门控确认：将 AI 建议的代码修改应用到当前文件（定位替换并保存），返回错误信息或 null（成功） */
  const applyCodeChange = async (originalCode: string, modifiedCode: string): Promise<string | null> => {
    if (!currentFile) return '当前没有打开的文件';
    if (activeLocked) return '会话已锁定，无法修改代码';
    const content = currentFile.content;
    const norm = (s: string) => s.replace(/\r\n/g, '\n');
    let next: string | null = null;
    const i1 = content.indexOf(originalCode);
    if (i1 >= 0) {
      next = content.slice(0, i1) + modifiedCode + content.slice(i1 + originalCode.length);
    } else {
      // 行尾风格不一致（CRLF/LF）时按归一化匹配（整文件统一为 LF）
      const nc = norm(content);
      const no = norm(originalCode);
      const i2 = nc.indexOf(no);
      if (i2 >= 0) {
        next = nc.slice(0, i2) + norm(modifiedCode) + nc.slice(i2 + no.length);
      }
    }
    if (next === null) return '未能在当前文件中定位原始代码片段（文件可能已被修改），请手动检查后重试';
    const updated = { ...currentFile, content: next };
    setCurrentFile(updated);
    setTabs((t) => t.map((x) => (x.path === updated.path ? { ...x, content: updated.content, disk: updated.content } : x)));
    try {
      await saveFile(updated.path, updated.content);
      setDiskContent(updated.content);
      return null;
    } catch (e) {
      return `写入文件失败: ${(e as Error).message || '未知错误'}`;
    }
  };

  const openFile = async (node: { path: string; is_dir?: boolean }) => {
    if (!activeWs) return;
    if (activeLocked) {
      setError('会话已锁定，请先在左侧右键解锁后再操作');
      return;
    }
    setError('');
    // 已在标签页中打开 → 直接激活（保留编辑内容与扫描结果）
    const existing = tabs.find((t) => t.path.toLowerCase() === node.path.toLowerCase());
    if (existing) {
      setCurrentFile({ path: existing.path, content: existing.content });
      setDiskContent(existing.disk);
      setResult(existing.result);
      return;
    }
    try {
      const { content } = await readFile(node.path);
      setCurrentFile({ path: node.path, content });
      setDiskContent(content);
      setResult(null);
      setTabs((t) => [...t, { path: node.path, content, disk: content, result: null }]);
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: 'assistant',
          text: `已打开 ${fileName(node.path)}。发送消息或点击"开始分析"，我将展示完整的分析过程。`,
          time: nowTime()
        }
      ]);
    } catch {
      setError('文件读取失败');
    }
  };

  /** 切换编辑器标签页：同步内容/基线/结果 */
  const switchTab = (path: string) => {
    const t = tabs.find((x) => x.path === path);
    if (!t) return;
    setCurrentFile({ path: t.path, content: t.content });
    setDiskContent(t.disk);
    setResult(t.result);
  };

  /** 关闭标签页：活动标签关闭时切换到相邻标签 */
  const closeTab = (path: string) => {
    const idx = tabs.findIndex((t) => t.path === path);
    const next = tabs.filter((t) => t.path !== path);
    setTabs(next);
    if (currentFile?.path === path) {
      const fallback = next[Math.min(idx, next.length - 1)];
      if (fallback) {
        setCurrentFile({ path: fallback.path, content: fallback.content });
        setDiskContent(fallback.disk);
        setResult(fallback.result);
      } else {
        setCurrentFile(null);
        setDiskContent(null);
        setResult(null);
      }
    }
  };

  /** 执行分析：分析模式下以对话流 + 流水线时间线呈现（步骤状态：pending/active/done + 耗时）；支持中途停止 */
  const runScan = async (userText?: string) => {
    if (!currentFile || scanning) return;
    if (activeLocked) {
      setError('会话已锁定，请先在左侧右键解锁后再操作');
      return;
    }
    setScanning(true);
    setError('');
    const uid = newId();
    const aid = newId();
    const started = Date.now();
    setMessages((m) => [
      ...m,
      { id: uid, role: 'user', text: userText || `分析 ${fileName(currentFile.path)}`, time: nowTime() },
      {
        id: aid,
        role: 'assistant',
        time: nowTime(),
        steps: PIPELINE.map((s) => ({ ...s, done: false, status: 'pending' as const }))
      }
    ]);
    const patch = (fn: (steps: AnalysisStep[]) => AnalysisStep[]) =>
      setMessages((m) => m.map((msg) => (msg.id === aid ? { ...msg, steps: fn(msg.steps || []) } : msg)));
    const mark = (i: number, status: StepStatus, ms?: number) =>
      patch((ss) => ss.map((s, j) => (j === i ? { ...s, status, done: status === 'done', ms: ms ?? s.ms } : s)));

    const controller = new AbortController();
    scanAbort.current = controller;
    try {
      const req = analyzeFile(currentFile.path, currentFile.content, analysisMode, controller.signal);
      // 前四步按节奏点亮，最后一步等待真实请求返回
      for (let i = 0; i < PIPELINE.length - 1; i++) {
        mark(i, 'active');
        const t = Date.now();
        await sleep(420);
        mark(i, 'done', Date.now() - t);
      }
      const last = PIPELINE.length - 1;
      mark(last, 'active');
      const t4 = Date.now();
      const r = await req;
      mark(last, 'done', Math.max(Date.now() - t4, 420));
      setResult(r);
      // 同步结果到对应标签页
      setTabs((t) => t.map((x) => (x.path === currentFile.path ? { ...x, result: r } : x)));
      setMessages((m) =>
        m.map((msg) =>
          msg.id === aid
            ? {
                ...msg,
                steps: PIPELINE.map((s, j) => ({
                  ...s,
                  done: true,
                  status: 'done' as const,
                  ms: msg.steps?.[j]?.ms
                })),
                issues: r.issues,
                total: r.totalIssues,
                lang: r.language,
                tag: analysisMode === 'cloud' ? 'cloud' : 'local',
                elapsed: Date.now() - started,
                llm: r.llmUsage
                  ? {
                      tokens: r.llmUsage.totalTokens || 0,
                      cacheHitRate: r.llmUsage.cacheHitRate ?? null,
                      requests: r.llmUsage.requests || 0,
                      model: r.llmUsage.model || null
                    }
                  : undefined
              }
            : msg
        )
      );
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      patch((ss) => ss.map((s) => (s.status === 'active' ? { ...s, status: 'done', done: true } : s)));
      setMessages((m) =>
        m.map((msg) =>
          msg.id === aid
            ? {
                ...msg,
                error: aborted ? '分析已停止' : '分析失败，请确认本地服务已启动',
                elapsed: Date.now() - started
              }
            : msg
        )
      );
      if (!aborted) setError('扫描失败，请确认本地服务已启动');
    } finally {
      scanAbort.current = null;
      setScanning(false);
    }
  };

  /** 中断当前扫描/流式回复（停止按钮） */
  const stopAll = () => {
    chatAbort.current?.abort();
    scanAbort.current?.abort();
  };

  /** 本地规则兜底回复（未配置大模型或调用失败时） */
  const cannedReply = (): string => {
    if (!currentFile) {
      return '请先在左侧文件树中选择一个文件，我可以帮你分析其中的问题。';
    }
    if (!result) {
      return `我已了解 ${fileName(currentFile.path)}。发送"分析"或点击"开始分析"触发完整检测流水线。`;
    }
    const high = (result.issues || []).filter((i) => isHigh(i.severity)).length;
    return `关于 ${fileName(currentFile.path)}：共 ${result.totalIssues} 个问题（高危 ${high} 个）。点击问题卡片上的"修复"可生成优化 diff；发送"分析"可重新检测。`;
  };

  /** 随聊天注入的工作区上下文：当前文件 + 扫描结果概览 */
  const chatContext = () => ({
    fileName: currentFile ? fileName(currentFile.path) : undefined,
    language: result?.language,
    totalIssues: result?.totalIssues,
    topIssues: result?.issues?.slice(0, 5).map((i) => ({ type: i.issueType, message: i.message, line: i.line }))
  });

  /** 分析模式自由消息：配置了大模型即走真实流式对话（与分析模式无关），否则本地兜底 */
  const sendChat = async (text: string) => {
    if (!text.trim() || scanning) return;
    if (activeLocked) {
      setError('会话已锁定，请先在左侧右键解锁后再操作');
      return;
    }
    const uid = newId();
    const aid = newId();
    const started = Date.now();
    setMessages((m) => [
      ...m,
      { id: uid, role: 'user', text, time: nowTime() },
      { id: aid, role: 'assistant', typing: true, time: nowTime() }
    ]);

    try {
      const prov = await getLlmProviders();
      if (prov.active) {
        // 完整历史交给服务端（服务端负责压缩早期对话为摘要）；本地只做防失控截断
        const hist = [
          ...messages.filter((x) => (x.role === 'user' || x.role === 'assistant') && x.text && !x.typing && !x.error).slice(-40).map((x) => ({ role: x.role, content: (x.raw ?? x.text)!.slice(0, 2000) })),
          { role: 'user' as const, content: text }
        ];
        const controller = new AbortController();
        chatAbort.current = controller;
        // 流式：先移除打字动画，创建流式气泡逐字填充
        setMessages((m) => m.map((msg) => (msg.id === aid ? { ...msg, typing: false, text: '', streaming: true } : msg)));
        const res = await chatWithAIStream(hist, chatContext(), {
          signal: controller.signal,
          onDelta: (d) => setMessages((m) => m.map((msg) => (msg.id === aid ? { ...msg, text: (msg.text || '') + d } : msg)))
        });
        const raw = res.reply;
        const parsed = parseReply(raw);
        const note = parsed.parseFailed ? '\n\n修改方案解析失败，请让 AI 重新给出方案。' : '';
        // 用量换算：与服务端 scanRoutes 的 cacheHitRate 口径一致
        const u = (res.usage || null) as { totalTokens?: number; cacheHitTokens?: number; cacheMissTokens?: number } | null;
        const cacheTotal = u ? (u.cacheHitTokens || 0) + (u.cacheMissTokens || 0) : 0;
        setMessages((m) =>
          m.map((msg) =>
            msg.id === aid
              ? {
                  ...msg,
                  streaming: false,
                  text: parsed.text + note,
                  raw,
                  mod: parsed.mod,
                  modStatus: parsed.mod ? 'pending' : undefined,
                  elapsed: Date.now() - started,
                  llm:
                    u && (u.totalTokens || 0) > 0
                      ? {
                          tokens: u.totalTokens || 0,
                          cacheHitRate: cacheTotal > 0 ? Math.round(((u.cacheHitTokens || 0) / cacheTotal) * 1000) / 10 : null,
                          requests: 1,
                          model: prov.active
                        }
                      : undefined
                }
              : msg
          )
        );
        return;
      }
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      setMessages((m) =>
        m.map((msg) =>
          msg.id === aid
            ? {
                ...msg,
                streaming: false,
                typing: false,
                elapsed: Date.now() - started,
                text: aborted
                  ? (msg.text || '') + '\n\n（已停止生成）'
                  : (msg.text || '') || cannedReply() + '\n\n（大模型调用失败，已回退本地提示）'
              }
            : msg
        )
      );
      return;
    } finally {
      chatAbort.current = null;
    }

    // 未配置大模型：本地轻量提示
    setMessages((m) =>
      m.map((msg) => (msg.id === aid ? { ...msg, typing: false, text: cannedReply() } : msg))
    );
  };

  /** 门控动作：应用/取消/换思路/撤销（主会话助手气泡内的代码修改卡片） */
  const onModAction = async (action: 'apply' | 'reject' | 'more' | 'undo' | 'verify', msgId: number, mod: ModProposal) => {
    if (action === 'reject') {
      setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, modStatus: 'rejected' } : x)));
      return;
    }
    if (action === 'more') {
      setMessages((m) => m.map((x) => (x.modStatus === 'pending' ? { ...x, modStatus: 'superseded' } : x)));
      void sendChat('这个方案我想再看看其他思路，请换一种不同的实现方式，重新给出修改建议和风险评估。');
      return;
    }
    if (action === 'verify') {
      void runScan('重新分析验证：确认修改后的问题状态');
      return;
    }
    if (action === 'undo') {
      const msg = messages.find((x) => x.id === msgId);
      if (msg?.modPrevContent === undefined) {
        setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, applyError: '未找到修改前备份，无法撤销' } : x)));
        return;
      }
      if (!currentFile) return;
      const restored = { ...currentFile, content: msg.modPrevContent };
      setCurrentFile(restored);
      setTabs((t) => t.map((x) => (x.path === restored.path ? { ...x, content: restored.content, disk: restored.content } : x)));
      try {
        await saveFile(restored.path, restored.content);
        setDiskContent(restored.content);
        setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, modStatus: 'undone' } : x)));
      } catch (e) {
        setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, applyError: `撤销写回失败: ${(e as Error).message}` } : x)));
      }
      return;
    }
    // apply
    let err: string | null;
    let prevContent: string | undefined;
    if (!currentFile) err = '当前没有打开的文件';
    else if (activeLocked) err = '会话已锁定，无法修改代码';
    else {
      const content = currentFile.content;
      prevContent = content;
      const norm = (s: string) => s.replace(/\r\n/g, '\n');
      let next: string | null = null;
      const i1 = content.indexOf(mod.originalCode);
      if (i1 >= 0) {
        next = content.slice(0, i1) + mod.modifiedCode + content.slice(i1 + mod.originalCode.length);
      } else {
        const nc = norm(content);
        const no = norm(mod.originalCode);
        const i2 = nc.indexOf(no);
        if (i2 >= 0) next = nc.slice(0, i2) + norm(mod.modifiedCode) + nc.slice(i2 + no.length);
      }
      if (next === null) {
        err = '未能在当前文件中定位原始代码片段（文件可能已被修改），请手动检查后重试';
      } else {
        const updated = { ...currentFile, content: next };
        setCurrentFile(updated);
        setTabs((t) => t.map((x) => (x.path === updated.path ? { ...x, content: updated.content, disk: updated.content } : x)));
        try {
          await saveFile(updated.path, updated.content);
          setDiskContent(updated.content);
          err = null;
        } catch (e) {
          err = `写入文件失败: ${(e as Error).message || '未知错误'}`;
        }
      }
    }
    setMessages((m) =>
      m.map((x) =>
        x.id === msgId
          ? { ...x, modStatus: err ? 'failed' : 'applied', applyError: err ?? undefined, modPrevContent: err ? undefined : prevContent }
          : x
      )
    );
  };

  /** 项目级扫描：聚合检测整个工作区目录（结果以卡片消息呈现，支持一键导出报告） */
  const runProjectScan = async () => {
    if (!activeWs || scanning) return;
    if (activeLocked) {
      setError('会话已锁定，请先在左侧右键解锁后再操作');
      return;
    }
    const aid = newId();
    setMessages((m) => [
      ...m,
      { id: aid, role: 'assistant', typing: true, time: nowTime(), text: `正在扫描整个项目 ${fileName(activeWs)}…` }
    ]);
    try {
      const r = await projectScan(activeWs, analysisMode);
      setMessages((m) =>
        m.map((msg) => (msg.id === aid ? { ...msg, typing: false, text: '', projScan: r } : msg))
      );
    } catch (e) {
      setMessages((m) =>
        m.map((msg) => (msg.id === aid ? { ...msg, typing: false, text: `项目扫描失败：${(e as Error).message || '未知错误'}` } : msg))
      );
    }
  };

  /** 导出项目扫描报告（HTML 落盘 ~/.mr-sliy/reports/） */
  const exportReport = async (r: ProjectScanResult) => {
    const aid = newId();
    setMessages((m) => [
      ...m,
      { id: aid, role: 'assistant', typing: true, time: nowTime(), text: '正在生成 HTML 分析报告…' }
    ]);
    try {
      const out = await generateReport({
        title: fileName(r.projectPath),
        projectPath: r.projectPath,
        summary: {
          totalFiles: r.totalFiles,
          scannedFiles: r.scannedFiles,
          failedFiles: r.failedFiles,
          totalIssues: r.totalIssues,
          durationMs: r.durationMs
        },
        files: r.results,
        format: 'html'
      });
      setMessages((m) =>
        m.map((msg) =>
          msg.id === aid
            ? { ...msg, typing: false, text: `报告已生成：${out.path}\n（可用浏览器打开查看，路径已可选中复制）` }
            : msg
        )
      );
    } catch (e) {
      setMessages((m) =>
        m.map((msg) => (msg.id === aid ? { ...msg, typing: false, text: `报告生成失败：${(e as Error).message}` } : msg))
      );
    }
  };

  const fix = async (issue: Issue) => {
    if (!currentFile) return;
    if (activeLocked) {
      setError('会话已锁定，请先在左侧右键解锁后再操作');
      return;
    }
    setFixing(issue.issueType);
    try {
      const opt = await optimizeCode(
        currentFile.content,
        currentFile.path,
        result?.language || 'javascript',
        issue.issueType,
        issue.message,
        issue.line
      );
      onOpenDiff({ filePath: currentFile.path, language: result?.language || 'javascript', originalCode: currentFile.content, result: opt });
    } catch (e) {
      setError((e as Error).message || '优化请求失败');
    } finally {
      setFixing(null);
    }
  };

  // 启动时从状态文件恢复工作区列表、激活会话与各会话内容
  useEffect(() => {
    (async () => {
      let state: { workspaces?: Workspace[]; activeWs?: string | null; sessions?: Record<string, Session> } | null = null;
      try {
        const raw = await loadState('guiState');
        if (raw) state = JSON.parse(raw);
      } catch {
        state = null;
      }
      const ws = [...(state?.workspaces || [])];
      // 迁移旧版 localStorage 数据
      if (!ws.length) {
        try {
          const legacy = JSON.parse(localStorage.getItem('mrsliy.workspaces') || '[]');
          if (Array.isArray(legacy) && legacy.length) ws.push(...legacy);
        } catch { /* 忽略 */ }
      }
      restoring.current = true;
      if (ws.length) {
        for (const [k, v] of Object.entries(state?.sessions || {})) {
          sessionMap.current.set(k, { ...v, messages: sanitizeMessages(v.messages || []) });
        }
        setWorkspaces(ws);
        const target = ws.find((w) => w.path === state?.activeWs)?.path || ws[0].path;
        setActiveWs(target);
        const s = sessionMap.current.get(target);
        if (s) {
          setCurrentFile(s.currentFile);
          setDiskContent(s.currentFile?.content ?? null);
          setResult(s.result);
          setMessages(s.messages);
          setTabs(s.tabs || (s.currentFile ? [{ path: s.currentFile.path, content: s.currentFile.content, disk: s.currentFile.content, result: s.result }] : []));
        }
      }
      restoring.current = false;
      loaded.current = true;
    })();
  }, []);

  const nav = (
    <WorkspaceNav
      workspaces={workspaces}
      activeWs={activeWs}
      currentFile={currentFile}
      loadDir={listDir}
      onAdd={addWorkspace}
      onRemove={removeWorkspace}
      onToggleLock={toggleLock}
      onArchive={(p) => {
        setWorkspaces((ws) => ws.map((w) => (w.path === p ? { ...w, archived: !w.archived } : w)));
        scheduleSave();
      }}
      onSchedule={(p, minutes) => {
        setWorkspaces((ws) => ws.map((w) => (w.path === p ? { ...w, scheduleMinutes: minutes } : w)));
        scheduleSave();
      }}
      onProjectScan={runProjectScan}
      onSelect={(p) => switchTo(p)}
      onOpenFile={openFile}
    />
  );

  /** 聊天/扫描进行中（用于停止按钮） */
  const busy = scanning || messages.some((x) => x.streaming || x.typing);

  if (mode === 'analysis') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, height: '100%' }}>
        {nav}
        <AnalysisView
          currentFile={currentFile}
          messages={messages}
          scanning={scanning}
          fixing={fixing}
          error={error}
          locked={activeLocked}
          onSend={(t) => void sendChat(t)}
          onModAction={onModAction}
          onExportReport={exportReport}
          onStop={stopAll}
          busy={busy}
          onScan={() => runScan()}
          onFix={fix}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 320px', gap: 16, height: '100%', position: 'relative' }}>
      {nav}

      {/* 中栏 · 编辑器（编辑模式主区域）：彩色语法高亮 + 可编辑任意行 */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--border-hairline)' }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {currentFile?.path || '未打开文件'}
          </span>
          {dirty && (
            <span title="有未保存的修改" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flex: 'none' }} />
          )}
          {activeLocked && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>· 会话已锁定</span>}
          <div style={{ flex: 1 }} />
          {currentFile && (
            <button
              className="btn-ghost"
              style={{ fontSize: 12.5 }}
              onClick={saveToDisk}
              disabled={!dirty || saving || activeLocked}
              title={activeLocked ? '会话已锁定' : '保存到原文件 (Ctrl+S)'}
            >
              {saving ? '保存中…' : savedFlash ? '已保存 ✓' : dirty ? '保存修改' : '已保存'}
            </button>
          )}
          <button className="btn-primary" onClick={() => runScan()} disabled={!currentFile || scanning || activeLocked} title={activeLocked ? '会话已锁定' : undefined}>
            {scanning ? '扫描中…' : '扫描此文件'}
          </button>
        </div>
        {/* 多标签页：同一会话可同时打开多个文件 */}
        {tabs.length > 0 && (
          <div style={{ display: 'flex', gap: 4, padding: '6px 10px', borderBottom: '1px solid var(--border-hairline)', overflowX: 'auto' }}>
            {tabs.map((t) => {
              const active = currentFile?.path === t.path;
              const tabDirty = t.content !== t.disk;
              return (
                <div
                  key={t.path}
                  onClick={() => switchTab(t.path)}
                  onContextMenu={(e) =>
                    openContextMenu(e, [
                      { label: '关闭标签页', onClick: () => closeTab(t.path) },
                      { label: '复制文件路径', onClick: () => copyText(t.path) }
                    ])
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    background: active ? 'var(--accent-tint)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: active ? 600 : 400
                  }}
                >
                  <span>{fileName(t.path)}</span>
                  {tabDirty && <span title="未保存" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />}
                  <span
                    title="关闭"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.path);
                    }}
                    style={{ opacity: 0.55, padding: '0 2px' }}
                  >
                    ×
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
          {error && <div style={{ color: 'var(--danger)', padding: '8px 14px 0', fontSize: 13 }}>{error}</div>}
          {currentFile ? (
            <div style={{ flex: 1, minHeight: 0 }}>
              <CodeEditor
                path={currentFile.path}
                value={currentFile.content}
                readOnly={activeLocked}
                onChange={updateContent}
                onSave={saveToDisk}
                onContextMenu={(e, sel) => {
                  openContextMenu(e, [
                    { label: '复制选中内容', disabled: !sel, onClick: () => copyText(sel) },
                    {
                      label: '全选代码',
                      onClick: () => {
                        const ta = document.querySelector<HTMLTextAreaElement>('.ce-input');
                        ta?.select();
                      }
                    },
                    { separator: true },
                    { label: scanning ? '扫描中…' : '扫描此文件', disabled: scanning || activeLocked, title: activeLocked ? '会话已锁定' : undefined, onClick: () => runScan() },
                    ...(dirty
                      ? [{ label: saving ? '保存中…' : '保存修改', disabled: saving || activeLocked, onClick: () => saveToDisk() }]
                      : [])
                  ]);
                }}
              />
            </div>
          ) : (
            <div className="muted" style={{ textAlign: 'center', marginTop: 80 }}>
              {activeWs ? '从左侧文件树选择一个文件开始编辑与扫描' : '点击左侧"+ 新建"添加工作区后开始'}
            </div>
          )}
        </div>
      </section>

      {/* 右栏 · 问题精简面板：分析过程只显示部分 */}
      <aside className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, padding: 14, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>问题</strong>
          {result && <span className="muted" style={{ fontSize: 12 }}>{result.totalIssues} 个 · {result.language}</span>}
        </div>
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.7, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border-hairline)' }}>
          {scanning ? (
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>分析进行中：解析源码 → 构建AST → 规则检测 → RAG 比对 → 生成结论</span>
          ) : (
            '分析管线：Tree-sitter 解析 · 规则检测 · RAG 比对（完整过程见分析模式）'
          )}
        </div>
        <div style={{ overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!result && !scanning && <div className="muted" style={{ fontSize: 13 }}>扫描后在此显示检测结果</div>}
          {scanning && (
            <div style={{ background: 'var(--accent-tint)', borderRadius: 10, padding: 12, fontSize: 12.5, color: 'var(--accent)', lineHeight: 1.7 }}>
              正在分析 {currentFile ? fileName(currentFile.path) : ''}，检测完成后结果会显示在这里…
            </div>
          )}
          {result?.issues?.slice(0, 3).map((iss, i) => (
            <div key={i} style={{ background: 'var(--bg-recessed)', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: severityColor(iss.severity) }} />
                <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{iss.issueType}</span>
                {iss.line != null && <span className="muted" style={{ fontSize: 11 }}>L{iss.line}</span>}
              </div>
              <div style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 }}>{iss.message}</div>
              <button
                className="btn-primary"
                style={{ fontSize: 12, padding: '5px 12px' }}
                onClick={() => fix(iss)}
                disabled={fixing !== null}
              >
                {fixing === iss.issueType ? '生成优化中…' : '修复'}
              </button>
            </div>
          ))}
          {result && result.totalIssues === 0 && (
            <div style={{ color: 'var(--success)', fontSize: 13 }}>未发现问题</div>
          )}
        </div>
        {result && (result.issues?.length || 0) > 3 && (
          <button
            className="btn-ghost"
            style={{ marginTop: 10, fontSize: 12.5 }}
            onClick={() => onModeChange('analysis')}
          >
            其余 {(result.issues?.length || 0) - 3} 条 · 前往分析模式查看
          </button>
        )}
      </aside>

      {/* 编辑模式专属：AI 悬浮小框 */}
      <AIDock currentFile={currentFile} result={result} scanning={scanning} analysisMode={analysisMode} locked={activeLocked} onApplyCode={applyCodeChange} />
    </div>
  );
}
