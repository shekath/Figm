import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderNode } from '../canvas/render';
import type { SceneNode } from '../types';
import { unionRects, visualBounds, type Rect } from './geometry';

type Nodes = Record<string, SceneNode>;

export function exportSvgString(nodes: Nodes, ids: string[], background?: string, pad = 0): string {
  const rect: Rect = unionRects(ids.map((id) => visualBounds(nodes[id]))) ?? { x: 0, y: 0, w: 1, h: 1 };
  const x = rect.x - pad,
    y = rect.y - pad,
    w = Math.max(1, rect.w + pad * 2),
    h = Math.max(1, rect.h + pad * 2);
  const inner = renderToStaticMarkup(
    createElement(
      'g',
      null,
      background ? createElement('rect', { x, y, width: w, height: h, fill: background }) : null,
      ...ids.map((id) => createElement(RenderNode, { key: id, id, ctx: { nodes } })),
    ),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">${inner}</svg>`;
}

export async function rasterize(svg: string, scale: number, type: 'image/png' | 'image/jpeg', bg?: string): Promise<Blob> {
  const m = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
  const w = m ? parseFloat(m[1]) : 100,
    h = m ? parseFloat(m[2]) : 100;
  const img = new Image();
  img.decoding = 'async';
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Could not render image'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const g = c.getContext('2d')!;
    if (type === 'image/jpeg' || bg) {
      g.fillStyle = bg ?? '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b!), type, 0.92));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPdf(pages: { svg: string; w: number; h: number }[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const p of pages) {
    const png = await rasterize(p.svg, 2, 'image/png');
    const dataUrl = await blobToDataUrl(png);
    const orient = p.w > p.h ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'px', format: [p.w, p.h], hotfixes: ['px_scaling'] });
    else pdf.addPage([p.w, p.h], orient);
    pdf.addImage(dataUrl, 'PNG', 0, 0, p.w, p.h);
  }
  return pdf!.output('blob');
}

export const blobToDataUrl = (b: Blob) =>
  new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(b);
  });

export async function exportNodes(nodes: Nodes, ids: string[], format: 'png' | 'jpg' | 'svg' | 'pdf', scale = 1): Promise<Blob> {
  const svg = exportSvgString(nodes, ids);
  if (format === 'svg') return new Blob([svg], { type: 'image/svg+xml' });
  if (format === 'pdf') {
    const pages = ids.map((id) => {
      const n = nodes[id];
      return { svg: exportSvgString(nodes, [id]), w: Math.max(1, n.w), h: Math.max(1, n.h) };
    });
    return exportPdf(pages);
  }
  return rasterize(svg, scale, format === 'png' ? 'image/png' : 'image/jpeg');
}

/** Generate CSS for the dev-mode inspector. */
export function cssFor(n: SceneNode): string {
  const lines: string[] = [];
  lines.push(`width: ${Math.round(n.w)}px;`, `height: ${Math.round(n.h)}px;`);
  if (n.rotation) lines.push(`transform: rotate(${n.rotation}deg);`);
  if (n.opacity < 1) lines.push(`opacity: ${n.opacity};`);
  const f = n.fills.find((p) => p.visible);
  if (f) {
    const val =
      f.kind === 'solid'
        ? hexWithAlpha(f.color, f.opacity)
        : f.kind === 'linear'
          ? `linear-gradient(${f.angle ?? 90}deg, ${(f.stops ?? []).map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')})`
          : f.kind === 'radial'
            ? `radial-gradient(${(f.stops ?? []).map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')})`
            : 'url(image.png) center / cover';
    lines.push(n.type === 'text' ? `color: ${val};` : `background: ${val};`);
  }
  if (n.radius && n.type !== 'ellipse') lines.push(`border-radius: ${n.radii ? n.radii.map((r) => r + 'px').join(' ') : n.radius + 'px'};`);
  if (n.type === 'ellipse') lines.push('border-radius: 50%;');
  const s = n.strokes.find((x) => x.visible);
  if (s) lines.push(`border: ${s.width}px ${s.dash ? 'dashed' : 'solid'} ${hexWithAlpha(s.color, s.opacity)};`);
  const shadows = n.effects.filter((e) => e.visible && (e.kind === 'drop-shadow' || e.kind === 'inner-shadow'));
  if (shadows.length) lines.push(`box-shadow: ${shadows.map((e) => `${e.kind === 'inner-shadow' ? 'inset ' : ''}${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${hexWithAlpha(e.color, e.opacity)}`).join(', ')};`);
  const blur = n.effects.find((e) => e.visible && e.kind === 'layer-blur');
  if (blur) lines.push(`filter: blur(${blur.blur / 2}px);`);
  const bblur = n.effects.find((e) => e.visible && e.kind === 'background-blur');
  if (bblur) lines.push(`backdrop-filter: blur(${bblur.blur / 2}px);`);
  if (n.blend !== 'normal') lines.push(`mix-blend-mode: ${n.blend};`);
  if (n.autoLayout) {
    const a = n.autoLayout;
    lines.push('display: flex;', `flex-direction: ${a.direction === 'horizontal' ? 'row' : 'column'};`, `gap: ${a.gap}px;`, `padding: ${a.padding.t}px ${a.padding.r}px ${a.padding.b}px ${a.padding.l}px;`);
    lines.push(`align-items: ${a.align === 'start' ? 'flex-start' : a.align === 'end' ? 'flex-end' : 'center'};`);
    lines.push(`justify-content: ${a.justify === 'start' ? 'flex-start' : a.justify === 'end' ? 'flex-end' : a.justify};`);
    if (a.wrap) lines.push('flex-wrap: wrap;');
  }
  if (n.text) {
    const t = n.text;
    lines.push(`font-family: "${t.fontFamily}";`, `font-size: ${t.fontSize}px;`, `font-weight: ${t.fontWeight};`, `line-height: ${Math.round(t.lineHeight * 100)}%;`);
    if (t.italic) lines.push('font-style: italic;');
    if (t.letterSpacing) lines.push(`letter-spacing: ${t.letterSpacing}px;`);
    if (t.align !== 'left') lines.push(`text-align: ${t.align};`);
    if (t.transform !== 'none') lines.push(`text-transform: ${t.transform};`);
    const deco = [t.underline && 'underline', t.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) lines.push(`text-decoration: ${deco};`);
  }
  return lines.join('\n');
}

export function hexWithAlpha(hex: string, a: number) {
  if (a >= 1) return hex;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
}

/** Simple React/JSX snippet for dev-mode. */
export function jsxFor(nodes: Nodes, id: string, depth = 0): string {
  const n = nodes[id];
  if (!n) return '';
  const pad = '  '.repeat(depth);
  const cls = n.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || n.type;
  if (n.type === 'text') return `${pad}<p className="${cls}">${(n.text?.content ?? '').replace(/</g, '&lt;')}</p>`;
  if (n.type === 'image') return `${pad}<img className="${cls}" src="..." alt="${n.name}" />`;
  if (!n.children.length) return `${pad}<div className="${cls}" />`;
  return `${pad}<div className="${cls}">\n${n.children.map((c) => jsxFor(nodes, c, depth + 1)).join('\n')}\n${pad}</div>`;
}
