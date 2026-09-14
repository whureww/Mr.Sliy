/** 编辑器偏好（字号）：跨页面共享的全局状态（订阅式），设置页与编辑器联动 */

import { useSyncExternalStore } from 'react';

const KEY = 'mrsliy.editorFontSize';
export const EDITOR_FONT_MIN = 11;
export const EDITOR_FONT_MAX = 20;
export const EDITOR_FONT_DEFAULT = 13;

const listeners = new Set<() => void>();

function read(): number {
  try {
    const n = parseInt(localStorage.getItem(KEY) || '', 10);
    if (!isNaN(n)) return Math.min(EDITOR_FONT_MAX, Math.max(EDITOR_FONT_MIN, n));
  } catch {
    /* ignore */
  }
  return EDITOR_FONT_DEFAULT;
}

let current = read();

export function getEditorFontSize(): number {
  return current;
}

export function setEditorFontSize(n: number): void {
  const v = Math.min(EDITOR_FONT_MAX, Math.max(EDITOR_FONT_MIN, Math.round(n)));
  if (v === current) return;
  current = v;
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

/** React 订阅：字号变化时触发使用方重渲染 */
export function useEditorFontSize(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current
  );
}
