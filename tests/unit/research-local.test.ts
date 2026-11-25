import { describe, expect, it } from 'vitest';
import { RESEARCH_TOOLS, type ResearchToolId } from '../../src/lib/research';
import { runLocal } from '../../src/lib/researchLocal';
import { placeResearch } from '../../src/lib/researchCanvas';
import { docWith } from './helpers';

/** Minimal JSON-schema conformance check for the subset the tools use. */
function conforms(v: unknown, s: Record<string, any>, path = '$'): string | null {
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (v === null) return types.includes('null') ? null : `${path}: null`;
  if (types.includes('object')) {
    if (typeof v !== 'object' || Array.isArray(v)) return `${path}: not object`;
    for (const k of s.required) if (!(k in (v as object))) return `${path}.${k}: missing`;
    for (const k of Object.keys(v as object)) if (!(k in s.properties)) return `${path}.${k}: extra`;
    for (const [k, sub] of Object.entries(s.properties)) { const e = conforms((v as any)[k], sub as any, `${path}.${k}`); if (e) return e; }
    return null;
  }
  if (types.includes('array')) { if (!Array.isArray(v)) return `${path}: not array`; for (let i = 0; i < v.length; i++) { const e = conforms(v[i], s.items, `${path}[${i}]`); if (e) return e; } return null; }
  if (types.includes('integer')) return Number.isInteger(v) ? null : `${path}: not integer`;
  if (types.includes('string')) { if (typeof v !== 'string') return `${path}: not string`; if (s.enum && !s.enum.includes(v)) return `${path}: bad enum ${v}`; return null; }
  return null;
}

const INPUTS: Record<string, Record<string, string>> = {
  persona: { who: '35 years old payroll manager', product: 'Payroll SaaS for small businesses' },
  journey: { persona: 'First-time home buyer', scenario: 'Getting pre-approved for a mortgage online' },
  sitemap: { product: 'Recipe app with meal planning and grocery lists' },
  hmw: { problem: 'New employees feel lost during their first week' },
  affinity: { notes: 'Checkout is too slow\nShipping fees are a surprise\nI hate creating an account\nPage takes forever to load\nHidden fees at the end\nWhy do I need an account to buy once\nLoading spinner everywhere\nDelivery cost should be shown earlier' },
  copy: { screen: 'Empty state for a team inbox', tone: 'Friendly' },
  summarize: { content: 'Participants said checkout was slow. Several people were frustrated by hidden shipping fees at the final step. Most users wanted guest checkout instead of creating an account. Loading times on mobile were a common problem. One user said "I almost gave up when the fees appeared". People trusted stores that showed total cost early.' },
  interview: { objective: 'Understand how freelancers track invoices and late payments', participants: 'freelance designers' },
  brief: { project: 'Redesign the checkout of an online plant shop', constraints: 'Six week timeline; Shopify platform' },
  questionnaire: { project: 'New marketing website for a dental clinic', stakeholders: 'Clinic owner' },
};

describe('built-in research engine (offline)', () => {
  it('produces schema-valid, placeable results for every structured tool', () => {
    for (const t of RESEARCH_TOOLS.filter((x) => !x.chat)) {
      const r = runLocal({ tool: t.id, inputs: INPUTS[t.id] });
      expect(conforms(r.data, t.schema as any), `${t.id}`).toBeNull();
      const d = docWith();
      const root = placeResearch(d, d.pages[0].id, r);
      expect(d.nodes[root].h).toBeGreaterThan(100);
    }
  });

  it('is deterministic for the same input and varies with input', () => {
    const a = runLocal({ tool: 'persona', inputs: INPUTS.persona });
    const b = runLocal({ tool: 'persona', inputs: INPUTS.persona });
    const c = runLocal({ tool: 'persona', inputs: { who: 'teenage student learning guitar' } });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(c));
    expect((a.data as any).age).toBe(35);
    expect((a.data as any).goals.join(' ')).toMatch(/pay|compl|reconcil|financial|month/i);
  });

  it('affinity clusters related notes together and keeps every note', () => {
    const r = runLocal({ tool: 'affinity', inputs: INPUTS.affinity }).data as any;
    const all = r.clusters.flatMap((c: any) => c.notes);
    expect(all.length).toBe(8);
    const withFees = r.clusters.find((c: any) => c.notes.some((n: string) => /Hidden fees/.test(n)));
    expect(withFees.notes.some((n: string) => /fees|cost/i.test(n) && !/Hidden/.test(n))).toBe(true);
  });

  it('summarize extracts summary, themes and quotes from the text', () => {
    const r = runLocal({ tool: 'summarize', inputs: INPUTS.summarize }).data as any;
    expect(r.summary.length).toBeGreaterThan(30);
    expect(r.themes.length).toBeGreaterThan(0);
    expect(r.quotes[0]).toMatch(/gave up/);
  });

  it('chat answers from the knowledge base and documents without any network', () => {
    const a = runLocal({ tool: 'chat', inputs: {}, messages: [{ role: 'user', content: 'How do I run a usability test?' }] });
    expect(a.text).toMatch(/participants|think aloud/i);
    const doc = { name: 'notes.txt', text: 'Interview 1. The user found the upload step confusing and slow.\n\nInterview 2. Pricing was clear and people liked the dashboard.' };
    const b = runLocal({ tool: 'docchat', inputs: {}, document: doc, messages: [{ role: 'user', content: 'What did people say about the upload?' }] });
    expect(b.text).toMatch(/upload step confusing/);
    expect(() => runLocal({ tool: 'docchat', inputs: {}, messages: [{ role: 'user', content: 'hi' }] })).toThrow(/Attach/);
    expect(() => runLocal({ tool: 'persona', inputs: {} })).toThrow(/fill in/);
  });
});
void (0 as unknown as ResearchToolId);
