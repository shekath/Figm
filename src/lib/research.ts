/**
 * Research Kit: AI-assisted UX research tools (personas, journey maps, sitemaps, affinity maps, ...).
 * Shared by the browser (user's own API key) and the Figmy server (/api/ai/research).
 * Each tool asks Claude for structured JSON (output_config.format), which is rendered as editable canvas layers.
 */
import type Anthropic from '@anthropic-ai/sdk';

export type ResearchToolId =
  | 'persona'
  | 'journey'
  | 'sitemap'
  | 'chat'
  | 'hmw'
  | 'affinity'
  | 'copy'
  | 'summarize'
  | 'docchat'
  | 'interview'
  | 'brief'
  | 'questionnaire';

export interface ResearchField { key: string; label: string; placeholder: string; multiline?: boolean; required?: boolean }
export interface ResearchTool {
  id: ResearchToolId;
  label: string;
  blurb: string;
  icon: string;
  fields: ResearchField[];
  /** Chat tools return prose; the rest return JSON matching `schema`. */
  chat?: boolean;
  acceptsDocument?: boolean;
  schema?: Record<string, unknown>;
  instructions: string;
}

/* ---------- schema helpers (structured outputs need additionalProperties:false + required on every object) ---------- */
const str = { type: 'string' } as const;
const strs = { type: 'array', items: str } as const;
const obj = (props: Record<string, unknown>) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const arr = (items: unknown) => ({ type: 'array', items });

export const RESEARCH_TOOLS: ResearchTool[] = [
  {
    id: 'persona',
    label: 'User persona',
    blurb: 'Generate a persona to understand and serve your users.',
    icon: '👤',
    fields: [
      { key: 'who', label: 'Who is this user?', placeholder: 'e.g. 35-year-old payroll manager at a mid-size company', required: true },
      { key: 'product', label: 'Product or context', placeholder: 'e.g. A payroll & HR SaaS for SMBs' },
    ],
    schema: obj({
      name: str, age: { type: 'integer' }, role: str, location: str, quote: str, bio: str,
      goals: strs, frustrations: strs, motivations: strs, behaviors: strs, tools: strs,
      techSavviness: { type: 'integer', description: '1 (low) to 5 (expert)' },
    }),
    instructions: 'Create one realistic, specific user persona. Avoid stereotypes; ground goals and frustrations in the stated context. 3-5 items per list.',
  },
  {
    id: 'journey',
    label: 'User journey map',
    blurb: "Map the user's experience stage by stage and spot opportunities.",
    icon: '🧭',
    fields: [
      { key: 'persona', label: 'Persona', placeholder: 'e.g. First-time home buyer', required: true },
      { key: 'scenario', label: 'Scenario / goal', placeholder: 'e.g. Getting pre-approved for a mortgage online', required: true },
    ],
    schema: obj({
      title: str,
      stages: arr(obj({ name: str, actions: strs, thoughts: strs, emotion: { type: 'string', enum: ['delighted', 'positive', 'neutral', 'frustrated', 'angry'] }, painPoints: strs, opportunities: strs })),
    }),
    instructions: 'Produce 5-7 chronological stages. Each list has 2-3 short items written from the user perspective (thoughts in first person).',
  },
  {
    id: 'sitemap',
    label: 'Information architecture',
    blurb: 'Structure features and content into an intuitive sitemap tree.',
    icon: '🗂️',
    fields: [
      { key: 'product', label: 'Product', placeholder: 'e.g. Recipe app with meal planning and grocery lists', required: true },
      { key: 'features', label: 'Key features (optional)', placeholder: 'One per line', multiline: true },
    ],
    schema: obj({ title: str, nodes: arr(obj({ id: str, label: str, parentId: { type: ['string', 'null'] }, note: str })) }),
    instructions: 'Return a sitemap as a flat list of nodes. Exactly one root (parentId null) named after the product. 2-3 levels deep, 15-35 nodes. ids are short unique slugs; note is a short purpose description (may be empty).',
  },
  {
    id: 'chat',
    label: 'Chat assistant',
    blurb: 'Ask UX questions; get summaries and expert answers.',
    icon: '💬',
    chat: true,
    acceptsDocument: true,
    fields: [],
    instructions: 'You are a senior UX researcher and designer. Answer concisely and practically, with concrete examples. Use short headings and bullet lists where helpful.',
  },
  {
    id: 'hmw',
    label: 'How might we',
    blurb: 'Turn user problems into "How might we…" opportunity statements.',
    icon: '💡',
    fields: [{ key: 'problem', label: 'User problem or insight', placeholder: 'e.g. New employees feel lost during their first week', multiline: true, required: true }],
    schema: obj({ problem: str, statements: arr(obj({ hmw: str, angle: str, ideas: strs })) }),
    instructions: 'Write 8 varied "How might we…" statements (different angles: amplify the good, remove the bad, explore the opposite, question an assumption, etc). Each has a 2-4 word angle label and 2 quick solution ideas.',
  },
  {
    id: 'affinity',
    label: 'Affinity mapping',
    blurb: 'Cluster notes and insights into themes.',
    icon: '🧩',
    acceptsDocument: true,
    fields: [{ key: 'notes', label: 'Notes, quotes or observations', placeholder: 'Paste one note per line (or attach a document)', multiline: true, required: true }],
    schema: obj({ clusters: arr(obj({ theme: str, insight: str, notes: strs })) }),
    instructions: 'Group every input note into 3-7 themed clusters. Keep notes close to their original wording (shorten if long). Each cluster gets a short theme name and a one-sentence insight.',
  },
  {
    id: 'copy',
    label: 'UX copywriting',
    blurb: 'Generate clear, concise interface copy in several variants.',
    icon: '✍️',
    fields: [
      { key: 'screen', label: 'Screen or element', placeholder: 'e.g. Empty state for a team inbox', required: true },
      { key: 'tone', label: 'Voice & tone', placeholder: 'e.g. Friendly, confident, no jargon' },
      { key: 'audience', label: 'Audience', placeholder: 'e.g. Small business owners' },
    ],
    schema: obj({ variants: arr(obj({ label: str, headline: str, body: str, primaryCta: str, secondaryCta: str })), microcopy: arr(obj({ element: str, text: str })), tips: strs }),
    instructions: 'Give 3 distinct variants (e.g. Direct, Warm, Playful). Headlines under 8 words, body under 30 words. Add 4-6 microcopy items (tooltips, errors, placeholders) and 2-3 writing tips.',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    blurb: 'Extract main ideas and themes from raw data or transcripts.',
    icon: '📝',
    acceptsDocument: true,
    fields: [{ key: 'content', label: 'Raw data, transcript or sticky notes', placeholder: 'Paste text (or attach a document)', multiline: true, required: true }],
    schema: obj({ summary: str, themes: arr(obj({ theme: str, evidence: strs })), insights: strs, recommendations: strs, quotes: strs }),
    instructions: 'Summarize faithfully - do not invent facts. Summary is 3-5 sentences. 3-6 themes with supporting evidence, 3-6 insights, 3-5 recommendations, up to 4 notable verbatim quotes.',
  },
  {
    id: 'docchat',
    label: 'Document chat',
    blurb: 'Attach a research document and chat about it privately.',
    icon: '📄',
    chat: true,
    acceptsDocument: true,
    fields: [],
    instructions: 'Answer questions using the attached document. Quote or cite the relevant passage. If the answer is not in the document, say so plainly before offering general guidance.',
  },
  {
    id: 'interview',
    label: 'User interviews',
    blurb: 'Generate interview questions from your research objectives.',
    icon: '🎙️',
    fields: [
      { key: 'objective', label: 'Research objective', placeholder: 'e.g. Understand how freelancers track invoices and late payments', multiline: true, required: true },
      { key: 'participants', label: 'Participants', placeholder: 'e.g. Freelance designers, 2+ years experience' },
    ],
    schema: obj({ title: str, intro: str, sections: arr(obj({ title: str, questions: arr(obj({ question: str, followUp: str })) })), closing: str }),
    instructions: 'Write a semi-structured interview guide: warm-up, 3-4 topic sections and wrap-up. Open, non-leading questions, each with one probing follow-up. Intro and closing are short scripts the moderator reads.',
  },
  {
    id: 'brief',
    label: 'Design brief',
    blurb: "Define a project's goals, audience and scope.",
    icon: '📋',
    fields: [
      { key: 'project', label: 'Project', placeholder: 'e.g. Redesign the checkout of an online plant shop', multiline: true, required: true },
      { key: 'constraints', label: 'Known constraints (optional)', placeholder: 'Budget, timeline, tech, brand…', multiline: true },
    ],
    schema: obj({ title: str, overview: str, problem: str, goals: strs, audience: strs, inScope: strs, outOfScope: strs, deliverables: strs, milestones: arr(obj({ name: str, when: str })), successMetrics: strs, risks: strs }),
    instructions: 'Write a concise, practical design brief. 3-5 items per list, 4-6 milestones with relative timing (e.g. "Week 1-2").',
  },
  {
    id: 'questionnaire',
    label: 'Discovery questionnaire',
    blurb: 'Collect requirements from clients and stakeholders.',
    icon: '❓',
    fields: [
      { key: 'project', label: 'Project type', placeholder: 'e.g. New marketing website for a dental clinic', required: true },
      { key: 'stakeholders', label: 'Who answers it?', placeholder: 'e.g. Clinic owner and office manager' },
    ],
    schema: obj({ title: str, intro: str, sections: arr(obj({ title: str, questions: arr(obj({ question: str, type: { type: 'string', enum: ['short', 'long', 'choice', 'scale'] }, options: strs })) })) }),
    instructions: 'Create a client discovery questionnaire with 4-6 sections (business & goals, audience, content, brand, technical, timeline & budget). 3-6 questions each; options only for choice questions (else empty).',
  },
];

export const toolById = (id: ResearchToolId) => RESEARCH_TOOLS.find((t) => t.id === id)!;

export interface ResearchRequest {
  tool: ResearchToolId;
  inputs: Record<string, string>;
  /** Attached document: plain text, or a PDF as base64 (chat / summarize / affinity). */
  document?: { name: string; text?: string; pdfBase64?: string } | null;
  /** Chat history for chat tools. */
  messages?: { role: 'user' | 'assistant'; content: string }[];
}
export interface ResearchResult { tool: ResearchToolId; data?: unknown; text?: string }

const SYSTEM = 'You are an expert UX researcher embedded in a design tool. Be specific, practical and concise. Never fabricate statistics or claim research was conducted.';

/** Run a research tool with an Anthropic client (browser or server). */
export async function runResearch(client: Anthropic, req: ResearchRequest, model = 'claude-opus-5-5'): Promise<ResearchResult> {
  const tool = toolById(req.tool);
  if (!tool) throw new Error('Unknown research tool');
  const docBlock = req.document?.text ? `<document name="${req.document.name.replace(/"/g, '')}">\n${req.document.text}\n</document>\n\n` : '';
  const pdf: Anthropic.ContentBlockParam[] = req.document?.pdfBase64 ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.document.pdfBase64 }, title: req.document.name }] : [];
  const hasDoc = !!docBlock || pdf.length > 0;
  const withDoc = (text: string): Anthropic.MessageParam['content'] => (pdf.length ? [...pdf, { type: 'text', text: docBlock + text }] : docBlock + text);
  if (tool.chat) {
    const history = (req.messages ?? []).filter((m) => m.content.trim());
    if (!history.length || history[history.length - 1].role !== 'user') throw new Error('Ask a question first');
    if (tool.id === 'docchat' && !hasDoc) throw new Error('Attach a document to chat with');
    const msgs: Anthropic.MessageParam[] = history.map((m, i) => ({ role: m.role, content: i === 0 && hasDoc ? withDoc(m.content) : m.content }));
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      system: `${SYSTEM}\n\n${tool.instructions}`,
      output_config: { effort: 'medium' },
      messages: msgs,
    });
    if (res.stop_reason === 'refusal') throw new Error('The assistant declined this request.');
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    return { tool: tool.id, text };
  }
  const fields = tool.fields
    .map((f) => [f.label, (req.inputs[f.key] ?? '').trim()] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:\n${v}`)
    .join('\n\n');
  for (const f of tool.fields) if (f.required && !(req.inputs[f.key] ?? '').trim() && !(tool.acceptsDocument && hasDoc)) throw new Error(`Please fill in "${f.label}"`);
  const res = await client.messages.create({
    model,
    max_tokens: 16000,
    system: `${SYSTEM}\n\nTask: ${tool.label}. ${tool.instructions}`,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: tool.schema! } },
    messages: [{ role: 'user', content: withDoc(fields || 'Use the attached document.') }],
  });
  if (res.stop_reason === 'refusal') throw new Error('The assistant declined this request.');
  if (res.stop_reason === 'max_tokens') throw new Error('The result was too long. Try a narrower request.');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return { tool: tool.id, data: JSON.parse(text) };
}
