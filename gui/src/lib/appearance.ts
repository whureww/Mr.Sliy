/** 外观设置：主题配色方案 / 界面缩放，实时应用并持久化 */

export interface ThemePalette {
  key: string;
  name: string;
  accent: string;
  accentTint: string;
  accentHover: string;
  canvas: string;
  card: string;
  recessed: string;
  border: string;
}

/** 预设主题：整套浅色暖调配色（背景 / 卡片 / 凹陷面 / 边框 / 强调色联动）；
 *  name 为 i18n key，展示时经 t() 翻译 */
export const THEMES: ThemePalette[] = [
  { key: 'amber', name: 'theme.amber', accent: '#E8870A', accentTint: '#FEF3E2', accentHover: '#D07808', canvas: '#F6F6F4', card: '#FFFFFF', recessed: '#F0EFEC', border: '#E9E7E2' },
  { key: 'coral', name: 'theme.coral', accent: '#E06C4A', accentTint: '#FDEEE8', accentHover: '#C85A39', canvas: '#FAF3EF', card: '#FFFDFA', recessed: '#F3EAE4', border: '#EDDFD6' },
  { key: 'forest', name: 'theme.forest', accent: '#3D9A6C', accentTint: '#E9F5EE', accentHover: '#35875E', canvas: '#F2F6F1', card: '#FCFEFB', recessed: '#E9F0E7', border: '#DFE9DC' },
  { key: 'lake', name: 'theme.lake', accent: '#3E7BC4', accentTint: '#E9F1FA', accentHover: '#356CAD', canvas: '#F1F5F9', card: '#FBFDFE', recessed: '#E7EEF4', border: '#DCE6EE' },
  { key: 'berry', name: 'theme.berry', accent: '#8E6CC8', accentTint: '#F0EBF9', accentHover: '#7C5BB5', canvas: '#F5F3F8', card: '#FDFCFF', recessed: '#EDEAF3', border: '#E3DFEC' },
  { key: 'rose', name: 'theme.rose', accent: '#D4537E', accentTint: '#FAEAF0', accentHover: '#BC4670', canvas: '#F9F2F5', card: '#FFFBFC', recessed: '#F3E9ED', border: '#EBDEE4' }
];

export interface Appearance {
  theme: string; // 主题 key（THEMES）
  scale: number; // 界面缩放 0.9 / 1 / 1.1 / 1.25
}

export const SCALES: { name: string; value: number }[] = [
  { name: 'scale.small', value: 0.9 },
  { name: 'scale.standard', value: 1 },
  { name: 'scale.large', value: 1.1 },
  { name: 'scale.xl', value: 1.25 }
];

export const DEFAULT_APPEARANCE: Appearance = { theme: THEMES[0].key, scale: 1 };

export function themeOf(key: string): ThemePalette {
  return THEMES.find((t) => t.key === key) || THEMES[0];
}

/** 应用外观到根元素（整套配色 CSS 变量 + 界面缩放） */
export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  const t = themeOf(a.theme);
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-tint', t.accentTint);
  root.style.setProperty('--accent-hover', t.accentHover);
  root.style.setProperty('--bg-canvas', t.canvas);
  root.style.setProperty('--bg-card', t.card);
  root.style.setProperty('--bg-recessed', t.recessed);
  root.style.setProperty('--border-hairline', t.border);
  const app = document.getElementById('root');
  if (app) (app.style as CSSStyleDeclaration & { zoom: string }).zoom = String(a.scale);
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
  return { theme: theme || DEFAULT_APPEARANCE.theme, scale };
}
