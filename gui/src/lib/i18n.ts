import { useSyncExternalStore } from 'react';

/** 轻量 i18n 基础：字典 + 全局语言状态（localStorage 持久化）+ 订阅式 hook。
 *  Settings 页已全覆盖；其余页面按需引入 t() 逐步迁移。 */

export type Lang = 'zh' | 'en';

type Entry = { zh: string; en: string };

const DICT: Record<string, Entry> = {
  // ---------- Settings：分析模式 ----------
  'settings.mode.title': { zh: '分析模式', en: 'Analysis Mode' },
  'settings.mode.desc': {
    zh: '选择检测与优化执行方式；扫描结果会带对应标识（本地 / 大模型）',
    en: 'Choose how detection & optimization run; results are tagged (Local / LLM)'
  },
  'mode.local.title': { zh: '本地知识库', en: 'Local Knowledge Base' },
  'mode.local.desc': {
    zh: 'Tree-sitter AST 解析 + 本地规则检测，完全离线可用，速度快且代码不出本机',
    en: 'Tree-sitter AST parsing + local rule detection; fully offline, fast, and code never leaves your machine'
  },
  'mode.cloud.title': { zh: '大模型增强', en: 'LLM Enhanced' },
  'mode.cloud.desc': {
    zh: '在本地检测的基础上，将问题片段交给云端大模型生成优化建议（需在下方配置 API Key）',
    en: 'On top of local detection, sends issue snippets to a cloud LLM for optimization advice (configure an API key below)'
  },
  'common.inUse': { zh: '当前使用', en: 'In use' },
  'mode.noProvider': {
    zh: '尚未启用任何大模型 — 请在下方配置并启用一个提供商，否则增强阶段会自动回退为本地结果。',
    en: 'No LLM enabled — configure and activate a provider below, otherwise the enhance stage falls back to local results.'
  },

  // ---------- Settings：大模型提供商 ----------
  'settings.llm.title': { zh: '大模型提供商', en: 'LLM Providers' },
  'settings.llm.hint': {
    zh: 'API Key 仅保存在本机数据库，不会上传',
    en: 'API keys stay in the local database and are never uploaded'
  },
  'llm.custom': { zh: '+ 自定义', en: '+ Custom' },
  'llm.refresh': { zh: '刷新状态', en: 'Refresh' },
  'llm.custom.title': { zh: '添加自定义提供商（OpenAI 兼容协议）', en: 'Add custom provider (OpenAI-compatible)' },
  'field.name': { zh: '名称（必填）', en: 'Name (required)' },
  'field.name.ph': { zh: '例如：硅基流动 / 公司中转', en: 'e.g. SiliconFlow / corporate gateway' },
  'field.url': { zh: 'API 地址（必填，OpenAI 兼容）', en: 'API URL (required, OpenAI-compatible)' },
  'field.key': { zh: 'API Key（服务不要求时可留空）', en: 'API Key (leave blank if not required)' },
  'field.model': { zh: '模型名称（可选）', en: 'Model name (optional)' },
  'field.model.ph': { zh: '例如：qwen2.5-72b-instruct', en: 'e.g. qwen2.5-72b-instruct' },
  'common.add': { zh: '添加', en: 'Add' },
  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.loading': { zh: '正在加载提供商状态…', en: 'Loading provider status…' },
  'provider.available': { zh: '可用', en: 'Available' },
  'provider.unavailable': { zh: '未配置或不可达', en: 'Not configured or unreachable' },
  'provider.active': { zh: '使用中', en: 'Active' },
  'provider.edit': { zh: '编辑', en: 'Edit' },
  'provider.config': { zh: '配置', en: 'Configure' },
  'provider.collapse': { zh: '收起', en: 'Collapse' },
  'provider.activate': { zh: '启用', en: 'Activate' },
  'provider.activating': { zh: '启用中…', en: 'Activating…' },
  'provider.delete': { zh: '删除', en: 'Delete' },
  'provider.keyRequired': { zh: 'API Key（必填）', en: 'API Key (required)' },
  'provider.keySavedPh': { zh: '已保存 {masked}，可输入新 Key 覆盖', en: 'Saved {masked}; enter a new key to override' },
  'provider.keyPh': { zh: '粘贴提供商控制台生成的 API Key', en: 'Paste the API key from the provider console' },
  'field.urlOptional': { zh: 'API 地址（可选，使用代理或私有部署时填写）', en: 'API URL (optional, for proxies or private deployments)' },
  'field.urlOptionalPh': { zh: '留空使用官方默认地址', en: 'Leave blank for the official default' },
  'field.modelOptionalPh': { zh: '留空使用默认模型', en: 'Leave blank for the default model' },
  'provider.save': { zh: '保存配置', en: 'Save' },
  'provider.saving': { zh: '保存中…', en: 'Saving…' },

  // ---------- Settings：记忆库 ----------
  'settings.memory.title': { zh: '记忆库', en: 'Memory' },
  'settings.memory.desc': {
    zh: 'AI 助手的跨会话记忆：在对话中说「记住……」即可保存偏好，以下条目会自动注入每次对话提示词',
    en: 'Cross-session memory for the AI assistant: say "remember ..." in chat to save a preference; entries below are injected into every prompt'
  },
  'memory.addPh': { zh: '手动添加一条记忆，例如：使用 4 空格缩进', en: 'Add a memory manually, e.g. Use 4-space indentation' },
  'memory.clear': { zh: '清空全部', en: 'Clear all' },
  'memory.empty': {
    zh: '暂无记忆。在对话中说「记住：……」即可自动保存。',
    en: 'No memories yet. Say "remember: ..." in chat to save one automatically.'
  },
  'memory.count': { zh: '{n} 条', en: '{n} items' },

  // ---------- Settings：更新记录 ----------
  'settings.updates.title': { zh: '更新记录', en: 'Update History' },
  'settings.updates.desc': { zh: '自更新与自修复的历史（最新在前）', en: 'Self-update & self-repair history (newest first)' },
  'updates.empty': { zh: '暂无更新记录', en: 'No update records yet' },
  'updates.loadFail': { zh: '更新记录读取失败', en: 'Failed to load update records' },

  // ---------- Settings：MCP 接入 ----------
  'settings.mcp.title': { zh: 'MCP 接入', en: 'MCP Integration' },
  'settings.mcp.desc': {
    zh: '通过 Model Context Protocol 把本机的 MR·SLIY 能力开放给外部程序：扫描、AI 优化、对话、知识库、记忆与历史均可被 Claude Desktop、Cursor、Cline 等客户端直接调用',
    en: 'Expose local MR·SLIY capabilities via Model Context Protocol: scanning, AI optimization, chat, knowledge base, memory and history are callable from Claude Desktop, Cursor, Cline and other clients'
  },
  'mcp.server': { zh: '服务信息', en: 'Server' },
  'mcp.tools': { zh: '可用工具（{n}）', en: 'Available tools ({n})' },
  'mcp.stdio.title': { zh: 'stdio 接入（推荐，桌面客户端）', en: 'stdio (recommended for desktop clients)' },
  'mcp.stdio.desc': {
    zh: '把下面的 JSON 合并进客户端配置文件：Claude Desktop 为 claude_desktop_config.json，Cursor 为 .cursor/mcp.json，Cline 为 cline_mcp_settings.json，保存后重启客户端即可',
    en: 'Merge the JSON below into the client config: claude_desktop_config.json for Claude Desktop, .cursor/mcp.json for Cursor, cline_mcp_settings.json for Cline; restart the client afterwards'
  },
  'mcp.http.title': { zh: 'HTTP 接入（本机其他程序）', en: 'HTTP (local programs)' },
  'mcp.http.desc': {
    zh: '本机任意程序向该端点 POST JSON-RPC 2.0 消息即可调用（无需额外鉴权，仅监听 127.0.0.1）',
    en: 'Any local program can POST JSON-RPC 2.0 messages to this endpoint (no extra auth; listens on 127.0.0.1 only)'
  },
  'mcp.copy': { zh: '复制', en: 'Copy' },
  'mcp.copied': { zh: '已复制', en: 'Copied' },
  'mcp.loadFail': { zh: 'MCP 状态读取失败，请确认本地服务已就绪', en: 'Failed to load MCP status; make sure the local service is ready' },

  // ---------- Settings：外观 ----------
  'settings.appearance.title': { zh: '外观设置', en: 'Appearance' },
  'settings.appearance.desc': {
    zh: '整套配色方案：背景、卡片、边框与强调色联动切换，立即生效并自动保存',
    en: 'Full palettes: background, cards, borders and accent switch together; applies instantly and saves automatically'
  },
  'appearance.theme': { zh: '主题', en: 'Theme' },
  'appearance.clickToApply': { zh: '点击应用', en: 'Click to apply' },
  'appearance.scale': { zh: '界面大小（含字体）', en: 'UI scale (incl. fonts)' },

  // ---------- Settings：语言 ----------
  'settings.lang.title': { zh: '语言 / Language', en: '语言 / Language' },
  'settings.lang.desc': {
    zh: '界面语言（Settings 页已完整覆盖，其余页面逐步支持）',
    en: 'UI language (Settings page fully covered; other pages progressively)'
  },

  // ---------- Settings：关于 ----------
  'settings.about.title': { zh: '关于', en: 'About' },
  'about.body': {
    zh: '基于 Tree-sitter AST 检测与 RAG 知识库，可选接入云端大模型（内置 5 家 + 自定义 OpenAI 兼容接口）；会话与配置保存在 ~/.mr-sliy/。',
    en: 'Built on Tree-sitter AST detection and a RAG knowledge base, with optional cloud LLMs (5 built-in + custom OpenAI-compatible endpoints); sessions and config are stored under ~/.mr-sliy/.'
  },

  // ---------- Settings：操作提示 ----------
  'toast.saved': { zh: '已保存 {name} 的配置', en: 'Saved {name} configuration' },
  'toast.saveFail': { zh: '保存失败：{msg}', en: 'Save failed: {msg}' },
  'toast.activated': { zh: '已启用 {name}', en: 'Activated {name}' },
  'toast.activateFail': { zh: '启用失败：{msg}', en: 'Activation failed: {msg}' },
  'toast.deleted': { zh: '已删除该配置', en: 'Configuration deleted' },
  'toast.deleteFail': { zh: '删除失败：{msg}', en: 'Delete failed: {msg}' },
  'toast.customAdded': { zh: '已添加自定义提供商「{name}」', en: 'Custom provider "{name}" added' },
  'toast.addFail': { zh: '添加失败：{msg}', en: 'Add failed: {msg}' },
  'toast.llmFail': {
    zh: '无法读取大模型配置，请确认本地服务已就绪',
    en: 'Cannot read LLM config; make sure the local service is ready'
  },
  'toast.needKey': { zh: '请填写 API Key', en: 'Please enter the API key' },
  'toast.needName': { zh: '请填写提供商名称', en: 'Please enter a provider name' },
  'toast.needUrl': { zh: '请填写 API 地址', en: 'Please enter the API URL' },
  'toast.memoryAdded': { zh: '记忆已添加', en: 'Memory added' },
  'toast.memoryDeleted': { zh: '记忆已删除', en: 'Memory deleted' },
  'toast.memoryCleared': { zh: '已清空全部记忆', en: 'All memories cleared' },
  'toast.memFail': { zh: '记忆操作失败：{msg}', en: 'Memory operation failed: {msg}' }
};

const LANG_KEY = 'mrsliy.lang';
const listeners = new Set<() => void>();

let current: Lang = 'zh';
try {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === 'en' || saved === 'zh') current = saved;
} catch {
  /* 忽略 */
}

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  if (current === l) return;
  current = l;
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* 忽略 */
  }
  listeners.forEach((fn) => fn());
}

/** React 订阅：语言切换时触发重渲染 */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current
  );
}

/** 翻译：t('toast.saved', { name: 'DeepSeek' })；缺失词条时回退 key 本身 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const e = DICT[key];
  let s = e ? e[current] : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return s;
}
