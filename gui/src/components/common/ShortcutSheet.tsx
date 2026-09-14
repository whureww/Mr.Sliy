import { useEffect, useState } from 'react';
import { t, useLang } from '../../lib/i18n';

/** 快捷键条目 */
const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'keys.global',
    items: [
      ['Ctrl+P', 'keys.quickOpen'],
      ['Ctrl+/', 'keys.cheat'],
      ['Ctrl+S', 'keys.save'],
      ['Esc', 'keys.esc']
    ]
  },
  {
    title: 'keys.editor',
    items: [
      ['Ctrl+F', 'keys.find'],
      ['Ctrl+G', 'keys.gotoLine'],
      ['Tab', 'keys.tab'],
      ['( [ {', 'keys.autoPair'],
      ['Enter', 'keys.autoIndent'],
      ['Backspace', 'keys.pairDel']
    ]
  }
];

/** 快捷键速查表：Ctrl+/ 呼出的全局浮层 */
export default function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useLang();
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(38,37,35,0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 160
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card" style={{ width: 520, maxHeight: '76vh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 15 }}>{t('keys.title')}</strong>
          <div style={{ flex: 1 }} />
          <button className="btn-ghost" style={{ width: 24, height: 24, padding: 0 }} onClick={onClose} title="Esc">×</button>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} style={{ marginBottom: 14 }}>
            <div className="muted" style={{ fontSize: 11.5, letterSpacing: 1, marginBottom: 6 }}>{t(g.title)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {g.items.map(([k, label]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'var(--bg-recessed)', borderRadius: 7 }}>
                  <kbd className="mono" style={{ fontSize: 11, background: 'var(--bg-card)', border: '1px solid var(--border-hairline)', borderRadius: 5, padding: '2px 7px', flexShrink: 0 }}>{k}</kbd>
                  <span style={{ fontSize: 12.5 }}>{t(label)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
