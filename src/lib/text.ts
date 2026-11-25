import type { TextStyle } from '../types';

let ctx: CanvasRenderingContext2D | null = null;
const getCtx = () => {
  if (!ctx && typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
  return ctx;
};

export const FONT_STACK = (family: string) => `"${family}", Inter, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif`;

export function fontString(t: TextStyle) {
  return `${t.italic ? 'italic ' : ''}${t.fontWeight} ${t.fontSize}px ${FONT_STACK(t.fontFamily)}`;
}

export function transformText(s: string, t: TextStyle['transform']) {
  if (t === 'uppercase') return s.toUpperCase();
  if (t === 'lowercase') return s.toLowerCase();
  if (t === 'capitalize') return s.replace(/\b\w/g, (c) => c.toUpperCase());
  return s;
}

export function measure(text: string, t: TextStyle): number {
  const c = getCtx();
  if (!c) return text.length * t.fontSize * 0.55;
  c.font = fontString(t);
  return c.measureText(text).width + Math.max(0, text.length - 1) * t.letterSpacing;
}

/** Break text into lines that fit maxWidth (Infinity => only hard breaks). */
export function layoutLines(t: TextStyle, maxWidth: number): string[] {
  const content = transformText(t.content, t.transform);
  const out: string[] = [];
  for (const para of content.split('\n')) {
    if (!isFinite(maxWidth)) {
      out.push(para);
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (line && measure(test.trimEnd(), t) > maxWidth) {
        out.push(line.trimEnd());
        line = w.trimStart();
        // hard-break very long words
        while (measure(line, t) > maxWidth && line.length > 1) {
          let i = line.length;
          while (i > 1 && measure(line.slice(0, i), t) > maxWidth) i--;
          out.push(line.slice(0, i));
          line = line.slice(i);
        }
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function textBoxSize(t: TextStyle, width: number): { w: number; h: number } {
  const lh = t.fontSize * t.lineHeight;
  if (t.autoResize === 'width') {
    const lines = layoutLines(t, Infinity);
    return { w: Math.ceil(Math.max(1, ...lines.map((l) => measure(l, t)))), h: Math.ceil(lines.length * lh) };
  }
  const lines = layoutLines(t, width);
  return { w: width, h: Math.ceil(lines.length * lh) };
}

export const FONTS = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Montserrat',
  'Lato',
  'Poppins',
  'Playfair Display',
  'Merriweather',
  'Source Code Pro',
  'JetBrains Mono',
  'Space Grotesk',
  'DM Sans',
  'Nunito',
  'Raleway',
  'Oswald',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Segoe UI',
];

const loaded = new Set<string>();
/** Load a Google font on demand (web + desktop when online). System fonts are skipped. */
export function ensureFont(family: string) {
  if (loaded.has(family) || ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Segoe UI'].includes(family)) return;
  loaded.add(family);
  if (typeof document === 'undefined') return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@0,100..900;1,100..900&display=swap`;
  document.head.appendChild(link);
  // re-render once fonts arrive so measurements are right
  (document as Document & { fonts?: FontFaceSet }).fonts?.ready.then(() => window.dispatchEvent(new Event('figmy:fonts')));
}
