import { useCallback, useRef, useState } from 'react';

/**
 * 可拖拽分隔条：贴在面板边缘（absolute 定位，不占 grid/flex 轨道），拖动调整面板宽度。
 * - dir='right'：面板在左、句柄贴右缘（向右拖增大）；dir='left'：面板在右、句柄贴左缘（向左拖增大）
 * - 拖拽中实时回调 onWidth（仅内存态），mouseup 时回调 onCommit（持久化）
 * - 双击重置（onReset）；拖拽期全局 col-resize 光标并禁用文本选择
 */
export default function ResizeHandle({
  dir,
  width,
  min,
  max,
  onWidth,
  onCommit,
  onReset
}: {
  dir: 'right' | 'left';
  width: number;
  min: number;
  max: number;
  onWidth: (w: number) => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  const dragging = useRef(false);
  const [hover, setHover] = useState(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = width;
      const sign = dir === 'right' ? 1 : -1;

      const move = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const next = Math.min(max, Math.max(min, startW + sign * (ev.clientX - startX)));
        onWidth(next);
      };
      const up = () => {
        if (!dragging.current) return;
        dragging.current = false;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onCommit();
      };

      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [dir, width, min, max, onWidth, onCommit]
  );

  const visStyle: React.CSSProperties = {
    position: 'absolute',
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    background: hover ? 'var(--accent)' : 'transparent',
    transition: 'background .15s ease'
  };
  if (dir === 'right') visStyle.right = -2;
  else visStyle.left = -2;

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 8,
        cursor: 'col-resize',
        zIndex: 6,
        ...(dir === 'right' ? { right: -4 } : { left: -4 })
      }}
    >
      <div style={visStyle} />
    </div>
  );
}
