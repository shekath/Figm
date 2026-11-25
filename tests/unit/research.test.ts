import { describe, expect, it } from 'vitest';
import { RESEARCH_TOOLS, runResearch, type ResearchToolId } from '../../src/lib/research';
import { placeResearch } from '../../src/lib/researchCanvas';
import { docWith } from './helpers';

const SAMPLES: Partial<Record<ResearchToolId, unknown>> = {
  persona: { name: 'Sara Ahmed', age: 35, role: 'Payroll manager', location: 'Leeds, UK', quote: 'I need everyone paid on time.', bio: 'Runs payroll for 240 staff.', goals: ['Accurate payroll'], frustrations: ['Manual tax updates'], motivations: ['Recognition'], behaviors: ['Checks twice'], tools: ['Excel'], techSavviness: 3 },
  journey: { title: 'Mortgage pre-approval', stages: [{ name: 'Discover', actions: ['Searches rates'], thoughts: ['Can I afford it?'], emotion: 'neutral', painPoints: ['Jargon'], opportunities: ['Plain-language calculator'] }, { name: 'Apply', actions: ['Uploads payslips'], thoughts: ['So many documents'], emotion: 'frustrated', painPoints: ['Upload errors'], opportunities: ['Bank connect'] }] },
  sitemap: { title: 'Recipe app', nodes: [{ id: 'root', label: 'Recipe app', parentId: null, note: '' }, { id: 'plan', label: 'Meal plan', parentId: 'root', note: 'Weekly planner' }, { id: 'week', label: 'This week', parentId: 'plan', note: '' }, { id: 'groc', label: 'Groceries', parentId: 'root', note: '' }] },
  hmw: { problem: 'New hires feel lost', statements: [{ hmw: 'How might we make day one feel guided?', angle: 'Remove the bad', ideas: ['Buddy', 'Checklist'] }] },
  affinity: { clusters: [{ theme: 'Speed', insight: 'Users want faster checkout', notes: ['Too many steps', 'Slow page'] }, { theme: 'Trust', insight: 'Fees surprise people', notes: ['Hidden fees'] }] },
  copy: { variants: [{ label: 'Direct', headline: 'No messages yet', body: 'Invite your team.', primaryCta: 'Invite', secondaryCta: 'Learn more' }], microcopy: [{ element: 'Search placeholder', text: 'Search conversations' }], tips: ['Lead with the benefit'] },
  summarize: { summary: 'Users value speed.', themes: [{ theme: 'Speed', evidence: ['P1: slow'] }], insights: ['Speed beats features'], recommendations: ['Cut steps'], quotes: ['It takes forever'] },
  interview: { title: 'Invoicing habits', intro: 'Thanks for joining.', sections: [{ title: 'Warm-up', questions: [{ question: 'Tell me about your work.', followUp: 'What does a week look like?' }] }], closing: 'Thank you.' },
  brief: { title: 'Checkout redesign', overview: 'Improve conversion.', problem: 'Drop-off at shipping.', goals: ['+10% conversion'], audience: ['Plant lovers'], inScope: ['Checkout'], outOfScope: ['Catalog'], deliverables: ['Prototype'], milestones: [{ name: 'Research', when: 'Week 1' }], successMetrics: ['Conversion'], risks: ['Payment provider limits'] },
  questionnaire: { title: 'Website discovery', intro: 'Help us understand your goals.', sections: [{ title: 'Goals', questions: [{ question: 'What is the main goal?', type: 'long', options: [] }, { question: 'Budget range?', type: 'choice', options: ['<5k', '5-15k'] }, { question: 'How urgent?', type: 'scale', options: [] }] }] },
};

function fakeClient(response: unknown, seen: unknown[]) {
  return { messages: { create: async (params: unknown) => { seen.push(params); return { stop_reason: 'end_turn', content: [{ type: 'text', text: typeof response === 'string' ? response : JSON.stringify(response) }] }; } } } as never;
}

describe('research kit', () => {
  it('every structured tool has a strict-compatible schema', () => {
    const check = (s: Record<string, unknown>): void => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect(new Set(s.required as string[])).toEqual(new Set(Object.keys(s.properties as object)));
        Object.values(s.properties as Record<string, Record<string, unknown>>).forEach(check);
      }
      if (s.type === 'array') check(s.items as Record<string, unknown>);
    };
    for (const t of RESEARCH_TOOLS) if (!t.chat) check(t.schema!);
  });

  it('sends structured-output requests and parses results', async () => {
    const seen: Record<string, any>[] = [];
    const r = await runResearch(fakeClient(SAMPLES.persona, seen), { tool: 'persona', inputs: { who: 'payroll manager' } });
    expect((r.data as { name: string }).name).toBe('Sara Ahmed');
    expect(seen[0].model).toBe('claude-opus-5-5');
    expect(seen[0].output_config.format.type).toBe('json_schema');
    await expect(runResearch(fakeClient({}, []), { tool: 'persona', inputs: {} })).rejects.toThrow(/fill in/);
  });

  it('chat tools pass history and the attached document', async () => {
    const seen: Record<string, any>[] = [];
    const r = await runResearch(fakeClient('Top pain point: uploads.', seen), { tool: 'docchat', inputs: {}, document: { name: 'notes.txt', text: 'P1 hated uploads' }, messages: [{ role: 'user', content: 'Top pain point?' }] });
    expect(r.text).toMatch(/uploads/);
    expect(seen[0].messages[0].content).toContain('P1 hated uploads');
    await expect(runResearch(fakeClient('x', []), { tool: 'docchat', inputs: {}, messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/Attach/);
  });

  it('places every result type on the canvas as a valid layer tree', () => {
    for (const [tool, data] of Object.entries(SAMPLES)) {
      const d = docWith();
      const root = placeResearch(d, d.pages[0].id, { tool: tool as ResearchToolId, data });
      const n = d.nodes[root];
      expect(n.type).toBe('frame');
      expect(d.pages[0].children).toContain(root);
      for (const x of Object.values(d.nodes)) {
        expect([x.x, x.y, x.w, x.h].every(Number.isFinite)).toBe(true);
        for (const c of x.children) expect(d.nodes[c].parentId).toBe(x.id);
      }
      expect(n.w).toBeGreaterThan(300);
      expect(n.h).toBeGreaterThan(100);
    }
    const d = docWith();
    placeResearch(d, d.pages[0].id, { tool: 'chat', text: '# Tips\n\nTest early.\n\nTest often.' }, 'How to test?');
    expect(Object.values(d.nodes).some((n) => n.text?.content === 'Test often.')).toBe(true);
  });
});
