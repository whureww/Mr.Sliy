import { ReactNode } from 'react';

/**
 * 丝滑折叠容器:grid-template-rows 0fr↔1fr 过渡,高度自适应内容,无需测量 scrollHeight。
 * 收起时内容不可见且不可聚焦,展开后恢复。
 */
export default function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={'collapse' + (open ? ' collapse-open' : '')} aria-hidden={!open}>
      <div className="collapse-inner">{children}</div>
    </div>
  );
}
