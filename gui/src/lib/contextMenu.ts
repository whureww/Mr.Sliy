/** 自定义右键菜单：屏蔽 WebView2 默认菜单（刷新/后退/打印等），按页面提供菜单项 */
export interface MenuItem {
  label?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string; // 悬停提示（如禁用原因）
  separator?: boolean;
}

interface MenuDetail {
  x: number;
  y: number;
  items: MenuItem[];
}

const EVT = 'mrsliy:contextmenu';

/** 页面打开自定义右键菜单（自动阻止浏览器默认菜单） */
export function openContextMenu(
  e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void },
  items: MenuItem[]
): void {
  e.preventDefault();
  e.stopPropagation();
  window.dispatchEvent(
    new CustomEvent<MenuDetail>(EVT, { detail: { x: e.clientX, y: e.clientY, items } })
  );
}

/** 复制文本到剪贴板（静默失败） */
export function copyText(text: string): void {
  try {
    navigator.clipboard.writeText(text).catch(() => {});
  } catch {
    /* 忽略 */
  }
}
