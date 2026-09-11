import { useEffect, useRef, useState } from 'react';
import { MenuItem } from '../../lib/contextMenu';

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

const EVT = 'mrsliy:contextmenu';

/** 输入框通用编辑菜单：剪切/复制/粘贴/全选（替代 WebView2 默认菜单） */
function editItems(el: HTMLInputElement | HTMLTextAreaElement): MenuItem[] {
  const sel = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  const isPassword = (el as HTMLInputElement).type === 'password';
  return [
    { label: '剪切', disabled: !sel || isPassword, onClick: () => document.execCommand('cut') },
    { label: '复制', disabled: !sel || isPassword, onClick: () => document.execCommand('copy') },
    {
      label: '粘贴',
      onClick: () => {
        navigator.clipboard
          .readText()
          .then((t) => {
            if (t) document.execCommand('insertText', false, t);
          })
          .catch(() => {});
      }
    },
    { separator: true },
    { label: '全选', onClick: () => { el.focus(); el.select(); } }
  ];
}

/** 全局右键菜单层：一律屏蔽 WebView2 默认菜单；文本输入框给编辑菜单，其余由页面自定义 */
export default function ContextMenuLayer() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = (e: Event) => setMenu((e as CustomEvent<MenuState>).detail);

    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      const t = e.target as HTMLElement;
      // 在菜单自身上右键：仅关闭
      if (ref.current?.contains(t)) {
        setMenu(null);
        return;
      }
      // 文本输入框：通用编辑菜单
      const box = t.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
      if (box) {
        window.dispatchEvent(
          new CustomEvent<MenuState>(EVT, { detail: { x: e.clientX, y: e.clientY, items: editItems(box) } })
        );
      }
    };

    // 菜单外按下即关闭（捕获阶段，先于菜单项 click 不影响——菜单项 onClick 在 mouseup 后触发）
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const onBlur = () => setMenu(null);

    window.addEventListener(EVT, open);
    document.addEventListener('contextmenu', onCtx);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener(EVT, open);
      document.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  if (!menu) return null;

  // 视口边界内收敛（估算：宽 180，单项高 34 / 分隔线 11）
  const estH = menu.items.reduce((h, it) => h + (it.separator ? 11 : 34), 8);
  const x = Math.min(menu.x, window.innerWidth - 196);
  const y = Math.min(menu.y, window.innerHeight - estH - 8);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className={`ctx-item${it.danger ? ' ctx-danger' : ''}`}
            disabled={it.disabled}
            title={it.title}
            onClick={() => {
              setMenu(null);
              it.onClick?.();
            }}
          >
            {it.label}
          </button>
        )
      )}
    </div>
  );
}
