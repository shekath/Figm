/** Turns Research Kit results into editable canvas layers built from auto-layout frames, text and sticky notes. */
import type { DocumentData, SceneNode } from '../types';
import { createNode, solid, uid } from './factory';
import { textBoxSize } from './text';
import { applyAutoLayout } from './layout';
import type { ResearchResult } from './research';

type Frame = { kind: 'frame'; name: string; dir?: 'v' | 'h'; gap?: number; pad?: number | [number, number]; fill?: string | null; radius?: number; w?: number; stroke?: string; wrap?: boolean; shadow?: boolean; align?: 'start' | 'center' | 'end'; children: Spec[] };
type Text = { kind: 'text'; text: string; size?: number; weight?: number; color?: string; w: number; italic?: boolean; name?: string };
type Spec = Frame | Text;

const INK = '#1e1e24', MUTED = '#6b6b78', LINE = '#e4e4ea';
const STICKY = ['#fff3a8', '#ffd6e0', '#cdeffd', '#d4f5d0', '#ffe2c2', '#e5dbff'];

const T = (text: string, w: number, size = 14, weight = 400, color = INK, extra: Partial<Text> = {}): Text => ({ kind: 'text', text, w, size, weight, color, ...extra });
const F = (name: string, children: Spec[], o: Partial<Frame> = {}): Frame => ({ kind: 'frame', name, children, ...o });
const sticky = (text: string, color: string, w = 180): Frame => F('Sticky', [T(text, w - 24, 13, 400, INK)], { fill: color, pad: 12, w, radius: 4, shadow: true });
const list = (title: string, items: string[], w: number, bullet = '•'): Frame =>
  F(title, [T(title, w, 12, 600, MUTED), ...items.map((i) => T(`${bullet} ${i}`, w, 14, 400, INK))], { dir: 'v', gap: 6, fill: null, w });
const card = (name: string, children: Spec[], w: number, fill = '#ffffff'): Frame => F(name, children, { dir: 'v', gap: 16, pad: 24, fill, radius: 16, w, stroke: LINE, shadow: true });
const heading = (title: string, sub: string | undefined, w: number): Spec[] => [T(title, w, 28, 700), ...(sub ? [T(sub, w, 15, 400, MUTED)] : [])];

/* ---------- per-tool layouts ---------- */
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function persona(d: D): Spec {
  const W = 760, col = 340;
  const stars = '●'.repeat(Math.max(1, Math.min(5, d.techSavviness ?? 3))) + '○'.repeat(5 - Math.max(1, Math.min(5, d.techSavviness ?? 3)));
  return card('Persona — ' + d.name, [
    F('Header', [
      F('Avatar', [T((d.name ?? '?').split(' ').map((s: string) => s[0]).join('').slice(0, 2), 64, 28, 700, '#ffffff', { name: 'Initials' })], { fill: '#7c5cff', pad: [24, 0], w: 96, radius: 48, align: 'center' }),
      F('Identity', [T(d.name, 560, 28, 700), T(`${d.age} · ${d.role} · ${d.location}`, 560, 15, 400, MUTED), T(`“${d.quote}”`, 560, 16, 500, '#4b3bd6', { italic: true })], { dir: 'v', gap: 6, fill: null }),
    ], { dir: 'h', gap: 20, fill: null, align: 'center' }),
    T(d.bio, W - 48, 15, 400, INK),
    F('Columns', [
      F('Left', [list('Goals', d.goals, col), list('Motivations', d.motivations, col), list('Tools & channels', d.tools, col)], { dir: 'v', gap: 18, fill: null }),
      F('Right', [list('Frustrations', d.frustrations, col), list('Behaviors', d.behaviors, col), F('Tech', [T('Tech savviness', col, 12, 600, MUTED), T(stars, col, 18, 400, '#7c5cff')], { dir: 'v', gap: 4, fill: null })], { dir: 'v', gap: 18, fill: null }),
    ], { dir: 'h', gap: 32, fill: null }),
  ], W);
}

function journey(d: D): Spec {
  const colW = 220;
  const EMO: Record<string, [string, string]> = { delighted: ['😄', '#d4f5d0'], positive: ['🙂', '#e3f7df'], neutral: ['😐', '#f1f1f4'], frustrated: ['😟', '#ffe2c2'], angry: ['😠', '#ffd6e0'] };
  const rows: [string, (s: D) => Spec][] = [
    ['Actions', (s) => F('Actions', s.actions.map((a: string) => sticky(a, STICKY[2], colW)), { dir: 'v', gap: 8, fill: null })],
    ['Thoughts', (s) => F('Thoughts', s.thoughts.map((a: string) => sticky(`“${a}”`, STICKY[0], colW)), { dir: 'v', gap: 8, fill: null })],
    ['Emotion', (s) => { const [e, c] = EMO[s.emotion] ?? EMO.neutral; return F('Emotion', [T(`${e} ${s.emotion}`, colW - 24, 15, 600)], { fill: c, pad: 12, w: colW, radius: 8 }); }],
    ['Pain points', (s) => F('Pain points', s.painPoints.map((a: string) => sticky(a, STICKY[1], colW)), { dir: 'v', gap: 8, fill: null })],
    ['Opportunities', (s) => F('Opportunities', s.opportunities.map((a: string) => sticky(a, STICKY[3], colW)), { dir: 'v', gap: 8, fill: null })],
  ];
  const stages: D[] = d.stages ?? [];
  const W = 160 + stages.length * (colW + 16);
  return card('Journey map — ' + d.title, [
    ...heading(d.title, 'User journey map', W),
    F('Stages', [F('Label', [T('', 140, 13)], { fill: null, w: 140 }), ...stages.map((s, i) => F('Stage', [T(`${i + 1}. ${s.name}`, colW - 24, 15, 700, '#ffffff')], { fill: '#5b4bdb', pad: 12, w: colW, radius: 8 }))], { dir: 'h', gap: 16, fill: null }),
    ...rows.map(([label, cell]) => F(label, [F('Label', [T(label, 140, 13, 700, MUTED)], { fill: null, w: 140 }), ...stages.map(cell)], { dir: 'h', gap: 16, fill: null })),
  ], W + 48);
}

function sitemap(d: D): Spec {
  const nodes: D[] = d.nodes ?? [];
  const root = nodes.find((n) => !n.parentId) ?? nodes[0];
  const kids = (id: string) => nodes.filter((n) => n.parentId === id);
  const box = (n: D, depth: number): Frame => F(n.label, [T(n.label, 168, depth === 0 ? 16 : 14, depth < 2 ? 700 : 500, depth === 0 ? '#ffffff' : INK), ...(n.note ? [T(n.note, 168, 11, 400, depth === 0 ? '#e0dcff' : MUTED)] : [])], { dir: 'v', gap: 4, pad: 12, w: 192, radius: 8, fill: depth === 0 ? '#5b4bdb' : depth === 1 ? '#ece9ff' : '#ffffff', stroke: depth > 1 ? LINE : undefined });
  const branch = (n: D): Frame => F('Section — ' + n.label, [box(n, 1), F('Pages', kids(n.id).map((c) => F(c.label, [box(c, 2), ...kids(c.id).map((g) => F(g.label, [T('↳ ' + g.label, 150, 13, 400, INK)], { pad: [6, 10], w: 176, fill: '#f6f6f9', radius: 6 }))], { dir: 'v', gap: 6, fill: null })), { dir: 'v', gap: 10, fill: null, pad: [0, 0] })], { dir: 'v', gap: 12, fill: null });
  const sections = root ? kids(root.id) : [];
  return card('Sitemap — ' + (d.title ?? root?.label), [
    ...heading(d.title ?? 'Sitemap', 'Information architecture', Math.max(600, sections.length * 208)),
    F('Root', [box(root ?? { label: '?' }, 0)], { fill: null }),
    F('Sections', sections.map(branch), { dir: 'h', gap: 16, fill: null }),
  ], Math.max(648, sections.length * 208 + 48));
}

function hmw(d: D): Spec {
  const W = 3 * 260 + 2 * 16;
  return card('How might we', [
    ...heading('How might we…', d.problem, W),
    F('Statements', (d.statements ?? []).map((s: D, i: number) => F('HMW', [T(s.angle.toUpperCase(), 236, 11, 700, MUTED), T(s.hmw, 236, 15, 600), ...s.ideas.map((x: string) => T('→ ' + x, 236, 13, 400, MUTED))], { dir: 'v', gap: 8, pad: 12, w: 260, fill: STICKY[i % STICKY.length], radius: 6, shadow: true })), { dir: 'h', gap: 16, wrap: true, fill: null, w: W }),
  ], W + 48);
}

function affinity(d: D): Spec {
  const clusters: D[] = d.clusters ?? [];
  const W = clusters.length * 236;
  return card('Affinity map', [
    ...heading('Affinity map', `${clusters.length} themes`, W),
    F('Clusters', clusters.map((c, i) => F('Theme — ' + c.theme, [T(c.theme, 196, 16, 700), T(c.insight, 196, 13, 400, MUTED), ...c.notes.map((n: string) => sticky(n, STICKY[i % STICKY.length], 196))], { dir: 'v', gap: 8, pad: 12, w: 220, fill: '#f6f6f9', radius: 10 })), { dir: 'h', gap: 16, fill: null }),
  ], W + 48);
}

function copy(d: D): Spec {
  const W = 3 * 300 + 32;
  return card('UX copy', [
    ...heading('UX copy', 'Variants, microcopy and tips', W),
    F('Variants', (d.variants ?? []).map((v: D) => F('Variant — ' + v.label, [T(v.label.toUpperCase(), 252, 11, 700, MUTED), T(v.headline, 252, 22, 700), T(v.body, 252, 14, 400, MUTED), F('CTAs', [F('Primary', [T(v.primaryCta, 120, 13, 600, '#ffffff')], { fill: '#5b4bdb', pad: [8, 14], radius: 8 }), F('Secondary', [T(v.secondaryCta, 120, 13, 600, '#5b4bdb')], { fill: '#ece9ff', pad: [8, 14], radius: 8 })], { dir: 'h', gap: 8, fill: null })], { dir: 'v', gap: 10, pad: 20, w: 300, fill: '#ffffff', radius: 12, stroke: LINE })), { dir: 'h', gap: 16, fill: null }),
    F('Microcopy', (d.microcopy ?? []).map((m: D) => F(m.element, [T(m.element, 200, 12, 600, MUTED), T(m.text, 600, 14)], { dir: 'h', gap: 16, fill: null })), { dir: 'v', gap: 8, fill: null }),
    list('Writing tips', d.tips ?? [], W),
  ], W + 48);
}

function summarize(d: D): Spec {
  const W = 760;
  return card('Summary', [
    ...heading('Research summary', undefined, W),
    T(d.summary, W, 15),
    F('Themes', (d.themes ?? []).map((t: D, i: number) => F('Theme — ' + t.theme, [T(t.theme, 220, 15, 700), ...t.evidence.map((e: string) => T('• ' + e, 220, 12, 400, MUTED))], { dir: 'v', gap: 6, pad: 12, w: 244, fill: STICKY[i % STICKY.length], radius: 8 })), { dir: 'h', gap: 12, wrap: true, fill: null, w: W }),
    F('Columns', [list('Key insights', d.insights ?? [], 360), list('Recommendations', d.recommendations ?? [], 360, '→')], { dir: 'h', gap: 40, fill: null }),
    ...(d.quotes?.length ? [F('Quotes', d.quotes.map((q: string) => T(`“${q}”`, W, 14, 500, '#4b3bd6', { italic: true })), { dir: 'v', gap: 6, fill: null })] : []),
  ], W + 48);
}

function interview(d: D): Spec {
  const W = 720;
  return card('Interview guide', [
    ...heading(d.title, 'Interview guide', W),
    F('Intro', [T('Introduction', W - 32, 12, 600, MUTED), T(d.intro, W - 32, 14)], { dir: 'v', gap: 6, pad: 16, fill: '#f6f6f9', radius: 8, w: W }),
    ...(d.sections ?? []).map((s: D, si: number) => F('Section — ' + s.title, [T(`${si + 1}. ${s.title}`, W, 18, 700), ...s.questions.map((q: D, qi: number) => F('Question', [T(`${si + 1}.${qi + 1}  ${q.question}`, W, 15, 500), T('Probe: ' + q.followUp, W - 24, 13, 400, MUTED)], { dir: 'v', gap: 4, fill: null }))], { dir: 'v', gap: 12, fill: null })),
    F('Closing', [T('Wrap-up', W - 32, 12, 600, MUTED), T(d.closing, W - 32, 14)], { dir: 'v', gap: 6, pad: 16, fill: '#f6f6f9', radius: 8, w: W }),
  ], W + 48);
}

function brief(d: D): Spec {
  const W = 760, col = 350;
  return card('Design brief', [
    ...heading(d.title, 'Design brief', W),
    T(d.overview, W, 15),
    F('Problem', [T('Problem', W - 32, 12, 600, MUTED), T(d.problem, W - 32, 15, 500)], { dir: 'v', gap: 6, pad: 16, fill: '#fff3a8', radius: 8, w: W }),
    F('Row1', [list('Goals', d.goals, col), list('Audience', d.audience, col)], { dir: 'h', gap: 40, fill: null }),
    F('Row2', [list('In scope', d.inScope, col, '✓'), list('Out of scope', d.outOfScope, col, '✕')], { dir: 'h', gap: 40, fill: null }),
    F('Row3', [list('Deliverables', d.deliverables, col), list('Success metrics', d.successMetrics, col)], { dir: 'h', gap: 40, fill: null }),
    F('Milestones', [T('Milestones', W, 12, 600, MUTED), F('Timeline', (d.milestones ?? []).map((m: D) => F(m.name, [T(m.when, 130, 11, 600, '#5b4bdb'), T(m.name, 130, 13, 500)], { dir: 'v', gap: 4, pad: 10, w: 150, fill: '#ece9ff', radius: 8 })), { dir: 'h', gap: 10, wrap: true, fill: null, w: W })], { dir: 'v', gap: 8, fill: null }),
    list('Risks', d.risks ?? [], W, '⚠'),
  ], W + 48);
}

function questionnaire(d: D): Spec {
  const W = 720;
  const field = (q: D): Spec =>
    q.type === 'choice' && q.options?.length
      ? F('Options', q.options.map((o: string) => T('○ ' + o, W - 40, 13, 400, MUTED)), { dir: 'v', gap: 4, fill: null })
      : q.type === 'scale'
        ? T('1   2   3   4   5', W, 13, 500, MUTED)
        : F('Answer', [T(' ', W - 24, q.type === 'long' ? 40 : 14)], { fill: '#f6f6f9', pad: 10, radius: 6, w: W });
  return card('Discovery questionnaire', [
    ...heading(d.title, d.intro, W),
    ...(d.sections ?? []).map((s: D) => F('Section — ' + s.title, [T(s.title, W, 18, 700), ...s.questions.map((q: D, i: number) => F('Question', [T(`${i + 1}. ${q.question}`, W, 15, 500), field(q)], { dir: 'v', gap: 6, fill: null }))], { dir: 'v', gap: 14, fill: null })),
  ], W + 48);
}

function prose(title: string, text: string): Spec {
  const W = 640;
  const paras = text.split(/\n{2,}/).filter(Boolean);
  return card(title, [T(title, W, 20, 700), ...paras.map((p) => T(p.replace(/^#+\s*/, '').replace(/\*\*/g, ''), W, /^#/.test(p) ? 16 : 14, /^#/.test(p) ? 700 : 400))], W + 48);
}

export function researchSpec(r: ResearchResult, title?: string): Spec {
  const d = (r.data ?? {}) as D;
  switch (r.tool) {
    case 'persona': return persona(d);
    case 'journey': return journey(d);
    case 'sitemap': return sitemap(d);
    case 'hmw': return hmw(d);
    case 'affinity': return affinity(d);
    case 'copy': return copy(d);
    case 'summarize': return summarize(d);
    case 'interview': return interview(d);
    case 'brief': return brief(d);
    case 'questionnaire': return questionnaire(d);
    default: return prose(title ?? 'Research notes', r.text ?? '');
  }
}

/** Create nodes for a spec. Returns the root id and all created nodes (children linked, positions from auto layout later). */
export function materialize(spec: Spec, parentId: string | null, out: Record<string, SceneNode>): string {
  if (spec.kind === 'text') {
    const n = createNode('text', { name: spec.name ?? (spec.text.slice(0, 40) || 'Text'), w: spec.w });
    n.parentId = parentId;
    n.text = { ...n.text!, content: spec.text, fontSize: spec.size ?? 14, fontWeight: spec.weight ?? 400, italic: !!spec.italic, autoResize: 'height', lineHeight: 1.4 };
    n.fills = [solid(spec.color ?? INK)];
    Object.assign(n, textBoxSize(n.text!, spec.w));
    out[n.id] = n;
    return n.id;
  }
  const f = createNode('frame', { name: spec.name });
  f.parentId = parentId;
  f.fills = spec.fill === null ? [] : [solid(spec.fill ?? '#ffffff')];
  f.radius = spec.radius ?? 0;
  f.clip = false;
  if (spec.stroke) f.strokes = [{ color: spec.stroke, width: 1, opacity: 1, align: 'inside', dash: 0, cap: 'butt', join: 'miter', visible: true }];
  if (spec.shadow) f.effects = [{ id: uid(), kind: 'drop-shadow', x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.08, visible: true }];
  const pad = typeof spec.pad === 'number' ? [spec.pad, spec.pad] : spec.pad ?? [0, 0];
  f.w = spec.w ?? 100;
  f.autoLayout = { direction: spec.dir === 'h' ? 'horizontal' : 'vertical', gap: spec.gap ?? 0, padding: { t: pad[0], b: pad[0], l: pad[1], r: pad[1] }, align: spec.align ?? 'start', justify: 'start', hugW: !spec.w, hugH: true, wrap: !!spec.wrap, counterGap: spec.gap };
  out[f.id] = f;
  f.children = spec.children.map((c) => materialize(c, f.id, out));
  return f.id;
}

/** Insert a research result on the current page, to the right of existing content. Mutates the document. */
export function placeResearch(d: DocumentData, pageId: string, r: ResearchResult, title?: string): string {
  const out: Record<string, SceneNode> = {};
  const root = materialize(researchSpec(r, title), null, out);
  Object.assign(d.nodes, out);
  const page = d.pages.find((p) => p.id === pageId)!;
  const tops = page.children.map((id) => d.nodes[id]).filter(Boolean);
  const x = tops.length ? Math.max(...tops.map((n) => n.x + n.w)) + 120 : 0;
  const y = tops.length ? Math.min(...tops.map((n) => n.y)) : 0;
  out[root].x = x;
  out[root].y = y;
  page.children.push(root);
  applyAutoLayout(d.nodes, root);
  return root;
}
