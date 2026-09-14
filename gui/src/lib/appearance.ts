/** 外观设置：主题配色方案 / 界面缩放 / 日夜模式，实时应用并持久化。
 *  日夜三态：白天 / 黑夜 / 自动（18:00–次日 7:00 自动黑夜，运行中每分钟检测跨越） */

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface ThemeColors {
  accent: string;
  accentTint: string;
  accentHover: string;
  canvas: string;
  card: string;
  recessed: string;
  border: string;
}

export interface ThemePalette extends ThemeColors {
  key: string;
  /** i18n key，展示时经 t() 翻译 */
  name: string;
  /** 暗色变体配色 */
  dark: ThemeColors;
}

/** 预设主题：浅色暖调为基，每个主题附带手工调校的暗色变体；
 *  name 为 i18n key，展示时经 t() 翻译 */
export const THEMES: ThemePalette[] = [
  {
    key: 'amber', name: 'theme.amber',
    accent: '#E8870A', accentTint: '#FEF3E2', accentHover: '#D07808', canvas: '#F6F6F4', card: '#FFFFFF', recessed: '#F0EFEC', border: '#E9E7E2',
    dark: { accent: '#F09A2D', accentTint: '#3A2A12', accentHover: '#F7AC4E', canvas: '#161513', card: '#1E1C19', recessed: '#1A1815', border: '#2E2B26' }
  },
  {
    key: 'coral', name: 'theme.coral',
    accent: '#E06C4A', accentTint: '#FDEEE8', accentHover: '#C85A39', canvas: '#FAF3EF', card: '#FFFDFA', recessed: '#F3EAE4', border: '#EDDFD6',
    dark: { accent: '#E67E5C', accentTint: '#3B241D', accentHover: '#EC9072', canvas: '#191412', card: '#211A17', recessed: '#1C1614', border: '#33281F' }
  },
  {
    key: 'forest', name: 'theme.forest',
    accent: '#3D9A6C', accentTint: '#E9F5EE', accentHover: '#35875E', canvas: '#F2F6F1', card: '#FCFEFB', recessed: '#E9F0E7', border: '#DFE9DC',
    dark: { accent: '#52B585', accentTint: '#163024', accentHover: '#6BC79A', canvas: '#131714', card: '#191F1B', recessed: '#161B17', border: '#27302A' }
  },
  {
    key: 'lake', name: 'theme.lake',
    accent: '#3E7BC4', accentTint: '#E9F1FA', accentHover: '#356CAD', canvas: '#F1F5F9', card: '#FBFDFE', recessed: '#E7EEF4', border: '#DCE6EE',
    dark: { accent: '#5E93D6', accentTint: '#1A2735', accentHover: '#7AA8E0', canvas: '#13161A', card: '#191D22', recessed: '#161A1E', border: '#282E36' }
  },
  {
    key: 'berry', name: 'theme.berry',
    accent: '#8E6CC8', accentTint: '#F0EBF9', accentHover: '#7C5BB5', canvas: '#F5F3F8', card: '#FDFCFF', recessed: '#EDEAF3', border: '#E3DFEC',
    dark: { accent: '#A585DB', accentTint: '#262038', accentHover: '#B89BE6', canvas: '#151319', card: '#1C1922', recessed: '#181519', border: '#2B2733' }
  },
  {
    key: 'rose', name: 'theme.rose',
    accent: '#D4537E', accentTint: '#FAEAF0', accentHover: '#BC4670', canvas: '#F9F2F5', card: '#FFFBFC', recessed: '#F3E9ED', border: '#EBDEE4',
    dark: { accent: '#E0709A', accentTint: '#372028', accentHover: '#E98BB0', canvas: '#181315', card: '#201A1C', recessed: '#1B1618', border: '#33262A' }
  },
  {
    key: 'slate', name: 'theme.slate',
    accent: '#64748B', accentTint: '#EEF2F6', accentHover: '#4B5F76', canvas: '#F7F8FA', card: '#FFFFFF', recessed: '#F0F2F5', border: '#E5E8EC',
    dark: { accent: '#8195AC', accentTint: '#232A33', accentHover: '#97A9BE', canvas: '#141619', card: '#1B1E22', recessed: '#17191C', border: '#2A2E34' }
  },
  {
    key: 'teal', name: 'theme.teal',
    accent: '#129E90', accentTint: '#E7F7F5', accentHover: '#0C857A', canvas: '#F6FAF9', card: '#FFFFFF', recessed: '#EDF4F3', border: '#DCEBE9',
    dark: { accent: '#2FB5A5', accentTint: '#122E2B', accentHover: '#4CC7B8', canvas: '#121615', card: '#181E1D', recessed: '#151A19', border: '#26302E' }
  },
  {
    key: 'indigo', name: 'theme.indigo',
    accent: '#6270E8', accentTint: '#EDEFFD', accentHover: '#4B59D6', canvas: '#F7F8FC', card: '#FFFFFF', recessed: '#EFF0F8', border: '#E4E6F2',
    dark: { accent: '#7D85F0', accentTint: '#23253D', accentHover: '#969CF5', canvas: '#14151B', card: '#1A1C24', recessed: '#171820', border: '#2A2C3A' }
  },
  {
    key: 'olive', name: 'theme.olive',
    accent: '#7E8F4D', accentTint: '#F3F6E8', accentHover: '#69793C', canvas: '#F8FAF2', card: '#FFFFFF', recessed: '#F0F3E7', border: '#E5E9D6',
    dark: { accent: '#9AAE62', accentTint: '#262D16', accentHover: '#AFC17B', canvas: '#15170F', card: '#1C1F15', recessed: '#181A12', border: '#2C3020' }
  }
];

export interface Appearance {
  theme: string; // 主题 key（THEMES）
  scale: number; // 界面缩放 0.9 / 1 / 1.1 / 1.25
  mode: ThemeMode; // 日夜模式：白天 / 黑夜 / 自动（18:00–7:00 黑夜）
}

export const SCALES: { name: string; value: number }[] = [
  { name: 'scale.small', value: 0.9 },
  { name: 'scale.standard', value: 1 },
  { name: 'scale.large', value: 1.1 },
  { name: 'scale.xl', value: 1.25 }
];

export const DEFAULT_APPEARANCE: Appearance = { theme: THEMES[0].key, scale: 1, mode: 'auto' };

export function themeOf(key: string): ThemePalette {
  return THEMES.find((t) => t.key === key) || THEMES[0];
}

/** 当前是否处于黑夜时段（18:00 – 次日 7:00） */
export function isNightNow(d = new Date()): boolean {
  const h = d.getHours();
  return h >= 18 || h < 7;
}

/** 按外观配置推导当前实际生效的暗色开关（auto 跟随系统时间） */
export function isDarkMode(a: Appearance): boolean {
  return a.mode === 'dark' || (a.mode === 'auto' && isNightNow());
}

/** 取主题在指定日/夜态下的生效配色 */
export function paletteOf(key: string, dark: boolean): ThemeColors {
  const p = themeOf(key);
  return dark ? p.dark : p;
}

/** '#RRGGBB' → 'r, g, b'(供 rgba 派生色拼接);非法输入回退橙色 */
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '232, 135, 10';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

const TEXT = {
  light: { primary: '#262523', muted: '#8B8985' },
  dark: { primary: '#E8E6E2', muted: '#98958E' }
} as const;

/** auto 模式的运行时状态：保存最近一次配置，定时跨越日/夜阈值时自动重应用 */
let lastAppearance: Appearance | null = null;
let autoTimer: ReturnType<typeof setInterval> | null = null;
let lastDark = false;

/** auto 跨越日/夜阈值时广播的事件名，供 React 层（如主题预览取色）刷新 */
export const MODE_CHANGE_EVENT = 'mrsliy-mode-change';
const MODE_EVENT = MODE_CHANGE_EVENT;

function applyInternal(a: Appearance) {
  const root = document.documentElement;
  const dark = isDarkMode(a);
  const c = paletteOf(a.theme, dark);
  const tx = dark ? TEXT.dark : TEXT.light;

  root.setAttribute('data-mode', dark ? 'dark' : 'light');
  // 镜像到 localStorage，供 index.html 首帧前同步恢复日/夜（防白闪）
  try { localStorage.setItem('mrsliy.mode', dark ? 'dark' : 'light'); } catch { /* 忽略 */ }
  root.style.setProperty('--accent', c.accent);
  root.style.setProperty('--accent-tint', c.accentTint);
  root.style.setProperty('--accent-hover', c.accentHover);
  root.style.setProperty('--bg-canvas', c.canvas);
  root.style.setProperty('--bg-card', c.card);
  root.style.setProperty('--bg-recessed', c.recessed);
  root.style.setProperty('--border-hairline', c.border);
  root.style.setProperty('--text-primary', tx.primary);
  root.style.setProperty('--text-muted', tx.muted);
  // 派生色:呼吸光环/聚焦环/脉冲底色随主题 accent 动态换算,保证任意主题色下都协调
  const rgb = hexToRgb(c.accent);
  root.style.setProperty('--pulse-ring', `rgba(${rgb}, 0.35)`);
  root.style.setProperty('--pulse-halo', `rgba(${rgb}, 0.08)`);
  root.style.setProperty('--focus-ring', `rgba(${rgb}, 0.10)`);
  root.style.setProperty(
    '--shadow-soft',
    dark ? '0 12px 40px rgba(0, 0, 0, 0.45)' : '0 12px 40px rgba(38, 37, 35, 0.08)'
  );
  root.style.setProperty(
    '--shadow-lift',
    dark ? '0 4px 16px rgba(0, 0, 0, 0.35)' : '0 4px 16px rgba(38, 37, 35, 0.06)'
  );
  const app = document.getElementById('root');
  if (app) (app.style as CSSStyleDeclaration & { zoom: string }).zoom = String(a.scale);

  if (dark !== lastDark) {
    lastDark = dark;
    window.dispatchEvent(new CustomEvent(MODE_EVENT));
  }
}

/** 应用外观（auto 模式下启动分钟级检测，跨 18:00 / 7:00 阈值自动切换） */
export function applyAppearance(a: Appearance) {
  lastAppearance = a;
  applyInternal(a);

  if (a.mode === 'auto' && !autoTimer) {
    autoTimer = setInterval(() => {
      if (lastAppearance && isDarkMode(lastAppearance) !== lastDark) {
        applyInternal(lastAppearance);
      }
    }, 60_000);
  } else if (a.mode !== 'auto' && autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}

export function normalizeAppearance(raw: unknown): Appearance {
  const a = (raw || {}) as Partial<Appearance> & { accent?: string };
  let theme = typeof a.theme === 'string' && THEMES.some((t) => t.key === a.theme) ? a.theme : '';
  // 旧版配置只有主题色 hex：按 hex 匹配迁移到对应主题
  if (!theme && typeof a.accent === 'string') {
    const m = THEMES.find((t) => t.accent.toLowerCase() === a.accent!.toLowerCase());
    if (m) theme = m.key;
  }
  const scale = SCALES.some((s) => s.value === a.scale) ? (a.scale as number) : DEFAULT_APPEARANCE.scale;
  const mode: ThemeMode = a.mode === 'light' || a.mode === 'dark' || a.mode === 'auto' ? a.mode : DEFAULT_APPEARANCE.mode;
  return { theme: theme || DEFAULT_APPEARANCE.theme, scale, mode };
}
