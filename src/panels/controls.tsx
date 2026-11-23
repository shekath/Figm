import React, { useEffect, useRef, useState } from 'react';

/** Number field with drag-to-scrub label, arrow-key nudging and expression support (e.g. "100/2"). */
export function NumberField({
  label,
  value,
  onChange,
  onCommitStart,
  step = 1,
  min,
  max,
  suffix,
  title,
  width,
  mixed,
}: {
  label?: React.ReactNode;
  value: number;
  onChange: (v: number, live?: boolean) => void;
  onCommitStart?: () => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  title?: string;
  width?: number;
  mixed?: boolean;
}) {
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(mixed ? 'Mixed' : fmt(value));
  }, [value, focused, mixed]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = () => {
    const v = evalExpr(text, value);
    if (v !== null && v !== value) onChange(clamp(v));
    else setText(fmt(value));
  };
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    onCommitStart?.();
    const move = (ev: PointerEvent) => {
      const d = Math.round((ev.clientX - startX) / 2) * step * (ev.shiftKey ? 10 : 1);
      onChange(clamp(round(start + d)), true);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <label className="num" title={title} style={width ? { width } : undefined}>
      {label !== undefined && (
        <span className="num-label" onPointerDown={scrub}>
          {label}
        </span>
      )}
      <input
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = clamp(round(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
            onChange(v);
            setText(fmt(v));
          }
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </label>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => (Number.isFinite(v) ? String(round(v)) : '');

function evalExpr(s: string, cur: number): number | null {
  const t = s.trim().replace(/,/g, '.');
  if (!t) return null;
  if (!/^[-+*/().\d\s%]+$/.test(t)) return null;
  try {
    const expr = /^[*/+]/.test(t) ? `${cur}${t}` : t;
    // safe: only digits and operators passed the regex above
    const v = Function(`"use strict";return (${expr})`)();
    return typeof v === 'number' && Number.isFinite(v) ? round(v) : null;
  } catch {
    return null;
  }
}

export function ColorField({ value, opacity, onChange, onOpacity }: { value: string; opacity?: number; onChange: (hex: string) => void; onOpacity?: (o: number) => void }) {
  const [hex, setHex] = useState(value.replace('#', '').toUpperCase());
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setHex(value.replace('#', '').toUpperCase()), [value]);
  return (
    <div className="color-field">
      <button className="swatch" style={{ background: value }} onClick={() => ref.current?.click()} title="Pick colour" />
      <input ref={ref} type="color" value={normHex(value)} onChange={(e) => onChange(e.target.value)} className="hidden-color" />
      <input
        className="hex"
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => {
          const h = parseHex(hex);
          if (h) onChange(h);
          else setHex(value.replace('#', '').toUpperCase());
        }}
      />
      {onOpacity && opacity !== undefined && (
        <NumberField value={Math.round(opacity * 100)} onChange={(v) => onOpacity(Math.max(0, Math.min(100, v)) / 100)} suffix="%" width={54} />
      )}
    </div>
  );
}

export function normHex(h: string) {
  const p = parseHex(h);
  return p ?? '#000000';
}
export function parseHex(s: string): string | null {
  let t = s.trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(t)) t = [...t].map((c) => c + c).join('');
  if (/^[0-9a-f]{1,2}$/i.test(t)) t = t.padStart(2, t).repeat(3).slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toLowerCase() : null;
}

export function Section({ title, children, actions, collapsible = false }: { title: string; children?: React.ReactNode; actions?: React.ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="section">
      <header>
        <span className={collapsible ? 'clickable' : ''} onClick={() => collapsible && setOpen(!open)}>
          {title}
        </span>
        <div className="section-actions">{actions}</div>
      </header>
      {open && children}
    </section>
  );
}

export function IconButton({ title, onClick, active, children, disabled, className }: { title: string; onClick?: () => void; active?: boolean; children: React.ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button className={`icon-btn ${active ? 'active' : ''} ${className ?? ''}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Select<T extends string | number>({ value, options, onChange, title, width }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; title?: string; width?: number | string }) {
  return (
    <select
      className="select"
      title={title}
      style={width ? { width } : undefined}
      value={String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
