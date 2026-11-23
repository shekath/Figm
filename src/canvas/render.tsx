import React from 'react';
import type { Paint, SceneNode, Stroke } from '../types';
import { pathData, polygonPoints, roundedRectPath, starPoints } from '../lib/geometry';
import { FONT_STACK, layoutLines, transformText } from '../lib/text';
import { ringsPath } from '../lib/boolean';
import { childOverrides } from '../lib/components';

type Nodes = Record<string, SceneNode>;

export interface RenderCtx {
  nodes: Nodes;
  outlines?: boolean;
  /** id prefix to keep defs unique when the same node renders twice (instances) */
  prefix?: string;
  overrides?: Record<string, Partial<SceneNode>>;
  hideIds?: Set<string>; // e.g. text being edited
  /** components currently being rendered (guards against an instance containing itself) */
  stack?: string[];
  /** prototype scroll offsets per frame id */
  scroll?: Record<string, { x: number; y: number }>;
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

function paintDef(p: Paint, id: string, w: number, h: number): React.ReactNode {
  if (p.kind === 'linear') {
    const a = (((p.angle ?? 90) - 90) * Math.PI) / 180;
    const x1 = 0.5 - Math.cos(a) / 2,
      y1 = 0.5 - Math.sin(a) / 2,
      x2 = 0.5 + Math.cos(a) / 2,
      y2 = 0.5 + Math.sin(a) / 2;
    return (
      <linearGradient key={id} id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
        {(p.stops ?? []).map((s, i) => (
          <stop key={i} offset={s.offset} stopColor={s.color} />
        ))}
      </linearGradient>
    );
  }
  if (p.kind === 'radial')
    return (
      <radialGradient key={id} id={id} cx="0.5" cy="0.5" r="0.5">
        {(p.stops ?? []).map((s, i) => (
          <stop key={i} offset={s.offset} stopColor={s.color} />
        ))}
      </radialGradient>
    );
  if (p.kind === 'image' && p.src)
    return (
      <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={w} height={h}>
        <image href={p.src} width={w} height={h} preserveAspectRatio="xMidYMid slice" />
      </pattern>
    );
  return null;
}

const paintValue = (p: Paint, id: string) => (p.kind === 'solid' ? p.color : `url(#${id})`);

function effectFilter(n: SceneNode, id: string): React.ReactNode {
  const fx = n.effects.filter((e) => e.visible);
  if (!fx.length) return null;
  const parts: React.ReactNode[] = [];
  let last = 'SourceGraphic';
  const merges: string[] = [];
  fx.forEach((e, i) => {
    const r = `r${i}`;
    if (e.kind === 'drop-shadow') {
      parts.push(
        <React.Fragment key={i}>
          <feMorphology in="SourceAlpha" operator={e.spread >= 0 ? 'dilate' : 'erode'} radius={Math.abs(e.spread)} result={`${r}m`} />
          <feGaussianBlur in={`${r}m`} stdDeviation={e.blur / 2} result={`${r}b`} />
          <feOffset dx={e.x} dy={e.y} in={`${r}b`} result={`${r}o`} />
          <feFlood floodColor={e.color} floodOpacity={e.opacity} result={`${r}c`} />
          <feComposite in={`${r}c`} in2={`${r}o`} operator="in" result={r} />
        </React.Fragment>,
      );
      merges.unshift(r);
    } else if (e.kind === 'inner-shadow') {
      parts.push(
        <React.Fragment key={i}>
          <feComponentTransfer in="SourceAlpha" result={`${r}inv`}>
            <feFuncA type="table" tableValues="1 0" />
          </feComponentTransfer>
          <feGaussianBlur in={`${r}inv`} stdDeviation={e.blur / 2} result={`${r}b`} />
          <feOffset dx={e.x} dy={e.y} in={`${r}b`} result={`${r}o`} />
          <feFlood floodColor={e.color} floodOpacity={e.opacity} result={`${r}c`} />
          <feComposite in={`${r}c`} in2={`${r}o`} operator="in" result={`${r}s`} />
          <feComposite in={`${r}s`} in2="SourceAlpha" operator="in" result={r} />
        </React.Fragment>,
      );
      merges.push('__inner__' + r);
    } else if (e.kind === 'layer-blur') {
      parts.push(<feGaussianBlur key={i} in={last} stdDeviation={e.blur / 2} result={r} />);
      last = r;
    }
  });
  const shadows = merges.filter((m) => !m.startsWith('__inner__'));
  const inners = merges.filter((m) => m.startsWith('__inner__')).map((m) => m.slice(9));
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
      {parts}
      <feMerge>
        {shadows.map((m) => (
          <feMergeNode key={m} in={m} />
        ))}
        <feMergeNode in={last} />
        {inners.map((m) => (
          <feMergeNode key={m} in={m} />
        ))}
      </feMerge>
    </filter>
  );
}

/** Builds the base geometry element for a node, in node-local coordinates (0,0)-(w,h). */
function geometry(n: SceneNode, props: React.SVGProps<SVGElement>, inset = 0): React.ReactNode {
  const w = Math.max(0, n.w - inset * 2),
    h = Math.max(0, n.h - inset * 2);
  const p = props as Record<string, unknown>;
  switch (n.type) {
    case 'ellipse':
      return <ellipse cx={n.w / 2} cy={n.h / 2} rx={w / 2} ry={h / 2} {...p} />;
    case 'polygon':
      return <polygon transform={`translate(${inset},${inset})`} points={polygonPoints(w, h, n.sides ?? 3)} {...p} />;
    case 'star':
      return <polygon transform={`translate(${inset},${inset})`} points={starPoints(w, h, n.sides ?? 5, n.innerRatio ?? 0.38)} {...p} />;
    case 'line':
      return <line x1={0} y1={0} x2={n.w} y2={n.h} {...p} />;
    case 'path':
      return <path d={n.rings?.length ? ringsPath(n.rings) : pathData(n.points ?? [], !!n.closed)} fillRule="evenodd" {...p} />;
    default: {
      const r = Math.max(0, (n.radius ?? 0) - inset);
      if (n.radii && n.radii.some((v) => v !== n.radii![0]))
        return <path transform={`translate(${inset},${inset})`} d={roundedRectPath(w, h, n.radii.map((v) => Math.max(0, v - inset)) as [number, number, number, number])} {...p} />;
      return <rect x={inset} y={inset} width={w} height={h} rx={Math.min(r, w / 2, h / 2)} {...p} />;
    }
  }
}

function strokeProps(s: Stroke): React.SVGProps<SVGElement> {
  return {
    stroke: s.color,
    strokeOpacity: s.opacity,
    strokeWidth: s.width,
    strokeDasharray: s.dash ? `${s.dash} ${s.dash}` : undefined,
    strokeLinecap: s.cap,
    strokeLinejoin: s.join,
    fill: 'none',
  };
}

function renderText(n: SceneNode, pre: string): React.ReactNode {
  const t = n.text!;
  const lines = layoutLines(t, t.autoResize === 'width' ? Infinity : n.w);
  const lh = t.fontSize * t.lineHeight;
  const anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start';
  const x = t.align === 'center' ? n.w / 2 : t.align === 'right' ? n.w : 0;
  const totalH = lines.length * lh;
  const offY = t.vAlign === 'middle' ? (n.h - totalH) / 2 : t.vAlign === 'bottom' ? n.h - totalH : 0;
  const fills = n.fills.filter((f) => f.visible);
  const deco = [t.underline && 'underline', t.strike && 'line-through'].filter(Boolean).join(' ') || undefined;
  return fills.map((f, fi) => (
    <text
      key={fi}
      fill={paintValue(f, `${pre}f${fi}`)}
      fillOpacity={f.opacity}
      fontFamily={FONT_STACK(t.fontFamily)}
      fontSize={t.fontSize}
      fontWeight={t.fontWeight}
      fontStyle={t.italic ? 'italic' : 'normal'}
      letterSpacing={t.letterSpacing}
      textAnchor={anchor}
      textDecoration={deco}
      style={{ whiteSpace: 'pre', userSelect: 'none' }}
    >
      {lines.map((l, i) => (
        <tspan key={i} x={x} y={offY + i * lh + lh / 2} dominantBaseline="central">
          {l || ' '}
        </tspan>
      ))}
    </text>
  ));
}

export function RenderNode({ id, ctx }: { id: string; ctx: RenderCtx }): React.ReactElement | null {
  const raw = ctx.nodes[id];
  if (!raw) return null;
  const n: SceneNode = ctx.overrides?.[id] ? { ...raw, ...ctx.overrides[id] } : raw;
  if (!n.visible) return null;
  const pre = safe((ctx.prefix ?? '') + n.id);
  const defs: React.ReactNode[] = [];
  const fills = n.fills.filter((f) => f.visible);
  fills.forEach((f, i) => {
    const d = paintDef(f, `${pre}f${i}`, n.w, n.h);
    if (d) defs.push(d);
  });
  const filterEl = ctx.outlines ? null : effectFilter(n, `${pre}fx`);
  if (filterEl) defs.push(<React.Fragment key="fx">{filterEl}</React.Fragment>);

  const cx = n.w / 2,
    cy = n.h / 2;
  let transform = `translate(${n.x},${n.y})`;
  if (n.rotation) transform += ` rotate(${n.rotation} ${cx} ${cy})`;
  if (n.flipX || n.flipY) transform += ` translate(${n.flipX ? n.w : 0},${n.flipY ? n.h : 0}) scale(${n.flipX ? -1 : 1},${n.flipY ? -1 : 1})`;

  const style: React.CSSProperties = { mixBlendMode: n.blend !== 'normal' ? n.blend : undefined };
  const body: React.ReactNode[] = [];
  const outline = ctx.outlines;

  const renderChildren = (kids: string[], c: RenderCtx) => {
    const out: React.ReactNode[] = [];
    let maskId: string | null = null;
    const masked: React.ReactNode[] = [];
    for (const kid of kids) {
      const k = c.nodes[kid];
      if (!k) continue;
      if (k.isMask && !maskId) {
        maskId = `${safe((c.prefix ?? '') + kid)}mask`;
        out.push(
          <defs key={'m' + kid}>
            <mask id={maskId} maskUnits="userSpaceOnUse">
              <RenderNode id={kid} ctx={{ ...c, outlines: false, prefix: (c.prefix ?? '') + 'mk' }} />
            </mask>
          </defs>,
        );
        if (c.outlines) out.push(<RenderNode key={kid} id={kid} ctx={c} />);
        continue;
      }
      const el = <RenderNode key={kid} id={kid} ctx={c} />;
      if (maskId) masked.push(el);
      else out.push(el);
    }
    if (maskId)
      out.push(
        <g key="masked" mask={c.outlines ? undefined : `url(#${maskId})`}>
          {masked}
        </g>,
      );
    return out;
  };

  if (n.type === 'text' && n.text) {
    if (ctx.hideIds?.has(n.id)) return null;
    body.push(...([] as React.ReactNode[]).concat(outline ? <rect key="o" width={n.w} height={n.h} fill="none" stroke="#999" strokeWidth={0.5} vectorEffect="non-scaling-stroke" /> : renderText(n, pre)));
  } else if (n.type === 'image') {
    body.push(
      <React.Fragment key="img">
        <defs>
          <clipPath id={`${pre}ic`}>{geometry(n, {})}</clipPath>
        </defs>
        {outline ? (
          geometry(n, { fill: 'none', stroke: '#999', strokeWidth: 0.5, vectorEffect: 'non-scaling-stroke' } as React.SVGProps<SVGElement>)
        ) : (
          <image href={n.src} width={n.w} height={n.h} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${pre}ic)`} />
        )}
      </React.Fragment>,
    );
  } else if (n.type === 'group') {
    // groups are positioned via children absolute coords => undo translate
  } else if (n.type === 'instance') {
    const comp = n.componentId ? ctx.nodes[n.componentId] : undefined;
    if (comp && ctx.stack?.includes(comp.id)) {
      body.push(<rect key="cycle" width={n.w} height={n.h} fill="#fee" stroke="#f66" strokeDasharray="4 4" />);
    } else if (comp) {
      const sx = n.w / (comp.w || 1),
        sy = n.h / (comp.h || 1);
      const compFills = (n.overrides?.[comp.id]?.fills ?? comp.fills).filter((f) => f.visible);
      compFills.forEach((f, i) => {
        const d = paintDef(f, `${pre}cf${i}`, n.w, n.h);
        if (d) defs.push(d);
      });
      body.push(
        ...compFills.map((f, i) =>
          outline ? null : geometry({ ...comp, w: n.w, h: n.h }, { key: 'cf' + i, fill: paintValue(f, `${pre}cf${i}`), fillOpacity: f.opacity } as React.SVGProps<SVGElement>),
        ),
      );
      body.push(
        <g key="ic" clipPath={comp.clip ? `url(#${pre}clip)` : undefined}>
          <g transform={`scale(${sx},${sy}) translate(${-comp.x},${-comp.y})`}>{renderChildren(comp.children, { ...ctx, prefix: pre, overrides: childOverrides(ctx.nodes, n, ctx.overrides), stack: [...(ctx.stack ?? []), comp.id] })}</g>
        </g>,
      );
      if (comp.clip) defs.push(<clipPath key="clip" id={`${pre}clip`}>{geometry({ ...comp, w: n.w, h: n.h }, {})}</clipPath>);
      if (outline) body.push(<rect key="ol" width={n.w} height={n.h} fill="none" stroke="#9747ff" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />);
    } else {
      body.push(<rect key="missing" width={n.w} height={n.h} fill="#fee" stroke="#f66" strokeDasharray="4 4" />);
    }
  } else {
    if (outline) {
      body.push(
        geometry(n, { key: 'o', fill: 'none', stroke: n.type === 'frame' || n.type === 'component' ? '#bbb' : '#666', strokeWidth: 0.6, vectorEffect: 'non-scaling-stroke' } as React.SVGProps<SVGElement>),
      );
    } else {
      fills.forEach((f, i) => {
        if (n.type === 'line' || (n.type === 'path' && !n.closed && f.kind === 'solid' && n.strokes.length && false)) return;
        body.push(geometry(n, { key: 'f' + i, fill: paintValue(f, `${pre}f${i}`), fillOpacity: f.opacity, fillRule: 'evenodd' } as React.SVGProps<SVGElement>));
      });
    }
  }

  // strokes (non-container shapes and frames)
  const strokesEl: React.ReactNode[] = [];
  if (!outline && n.type !== 'group' && n.type !== 'text' && n.type !== 'instance') {
    n.strokes
      .filter((s) => s.visible && s.width > 0)
      .forEach((s, i) => {
        const closedShape = !['line', 'path'].includes(n.type) || n.closed;
        const inset = closedShape && ['rect', 'frame', 'component', 'ellipse', 'image', 'polygon', 'star'].includes(n.type) ? (s.align === 'inside' ? s.width / 2 : s.align === 'outside' ? -s.width / 2 : 0) : 0;
        strokesEl.push(geometry(n, { key: 's' + i, ...strokeProps(s) } as React.SVGProps<SVGElement>, ['polygon', 'star'].includes(n.type) ? 0 : inset));
      });
  }

  const isContainer = n.type === 'frame' || n.type === 'component';
  if (isContainer && n.clip && !outline) defs.push(<clipPath key="clip" id={`${pre}clip`}>{geometry(n, {})}</clipPath>);

  const childEls =
    n.type === 'group' || isContainer ? (
      <g key="kids" clipPath={isContainer && n.clip && !outline ? `url(#${pre}clip)` : undefined}>
        {ctx.scroll?.[n.id] ? (
          <>
            <g transform={`translate(${-n.x - ctx.scroll[n.id].x},${-n.y - ctx.scroll[n.id].y})`}>{renderChildren(n.children.filter((c) => !ctx.nodes[c]?.fixed), ctx)}</g>
            <g transform={`translate(${-n.x},${-n.y})`}>{renderChildren(n.children.filter((c) => ctx.nodes[c]?.fixed), ctx)}</g>
          </>
        ) : (
          <g transform={`translate(${-n.x},${-n.y})`}>{renderChildren(n.autoLayout?.reverseZ ? [...n.children].reverse() : n.children, ctx)}</g>
        )}
      </g>
    ) : null;

  return (
    <g data-id={n.id} transform={transform} opacity={n.opacity < 1 ? n.opacity : undefined} style={style} filter={filterEl ? `url(#${pre}fx)` : undefined}>
      {defs.length > 0 && <defs>{defs}</defs>}
      {body}
      {childEls}
      {strokesEl}
    </g>
  );
}

export function textPreview(n: SceneNode) {
  return n.text ? transformText(n.text.content, n.text.transform) : '';
}
