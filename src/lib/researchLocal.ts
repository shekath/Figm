/**
 * Built-in Research Kit engine: runs entirely in Figmy (no network, no API key).
 * Generative tools combine domain knowledge packs with templates seeded from the user's input;
 * analysis tools (summarize, affinity, document chat) use local text analysis (TF-IDF scoring and clustering).
 */
import type { ResearchRequest, ResearchResult } from './research';

/* ---------- utilities ---------- */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type R = () => number;
const pick = <T,>(r: R, xs: T[]) => xs[Math.floor(r() * xs.length)];
const pickN = <T,>(r: R, xs: T[], n: number) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, Math.min(n, a.length));
};
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const lower1 = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

const STOP = new Set('a an the and or but if of to in on for with at by from as is are was were be been being it its this that these those i me my we our you your they them their he she his her not no so do does did done have has had can could would should will just very really also than then there here what when where which who why how about into over after before more most some any all each other such only own same too s t don isn aren wasn weren won doesn didn hasn haven im ive id get got lot lots thing things like one two need want make use using used much many even still way go going know think feel felt say said'.split(' '));
const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).map((w) => w.replace(/'s$/, '')).filter((w) => w.length > 2 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ing|ed|es|s|ly)$/, '').replace(/(.)\1$/, '$1') || w;
const sentences = (text: string) => (text.replace(/\r/g, '').match(/[^.!?\n]+[.!?]?/g) ?? []).map(clean).filter((s) => s.split(' ').length >= 4);

/** UX concept lexicon: related words share a concept token so they cluster together. */
const CONCEPTS: Record<string, string[]> = {
  cost: ['fee', 'fees', 'price', 'pricing', 'cost', 'costs', 'shipping', 'delivery', 'charge', 'charges', 'expensive', 'cheap', 'pay', 'payment', 'billing', 'refund', 'discount', 'money', 'budget', 'afford'],
  speed: ['slow', 'slower', 'forever', 'load', 'loading', 'loads', 'spinner', 'wait', 'waiting', 'fast', 'quick', 'lag', 'laggy', 'performance', 'speed', 'delay', 'delays', 'time', 'takes'],
  account: ['account', 'accounts', 'sign', 'signup', 'login', 'log', 'register', 'registration', 'password', 'profile', 'verify', 'verification'],
  navigation: ['find', 'navigation', 'menu', 'search', 'lost', 'where', 'browse', 'filter', 'filters', 'category', 'categories'],
  errors: ['error', 'errors', 'bug', 'bugs', 'crash', 'crashed', 'broken', 'fail', 'failed', 'failure', 'glitch'],
  clarity: ['confusing', 'confused', 'unclear', 'understand', 'jargon', 'clear', 'explain', 'complicated', 'complex', 'hard'],
  trust: ['trust', 'secure', 'security', 'safe', 'privacy', 'scam', 'hidden', 'surprise', 'honest', 'transparent'],
  support: ['support', 'help', 'contact', 'chat', 'agent', 'response', 'reply', 'phone', 'email'],
  mobile: ['mobile', 'phone', 'app', 'tablet', 'screen', 'tap', 'touch'],
  checkout: ['checkout', 'cart', 'basket', 'order', 'buy', 'purchase', 'pay'],
  onboarding: ['onboarding', 'setup', 'tutorial', 'first', 'start', 'getting', 'welcome'],
  content: ['photo', 'photos', 'image', 'images', 'description', 'reviews', 'review', 'information', 'details'],
};
const CONCEPT_OF = new Map<string, string>();
for (const [c, ws] of Object.entries(CONCEPTS)) for (const w of ws) if (!CONCEPT_OF.has(w)) CONCEPT_OF.set(w, c);
const conceptTokens = (text: string) => (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).map((w) => CONCEPT_OF.get(w)).filter((c): c is string => !!c).map((c) => '#' + c);

/** TF-IDF vectors for a list of texts (words plus concept tokens, which are weighted higher). */
function tfidf(docs: string[]) {
  const toks = docs.map((d) => { const c = conceptTokens(d); return [...words(d).map(stem), ...c, ...c]; });
  const df = new Map<string, number>();
  toks.forEach((t) => new Set(t).forEach((w) => df.set(w, (df.get(w) ?? 0) + 1)));
  const N = docs.length;
  const vecs = toks.map((t) => {
    const v = new Map<string, number>();
    t.forEach((w) => v.set(w, (v.get(w) ?? 0) + 1));
    for (const [w, c] of v) v.set(w, (c / t.length) * Math.log(1 + N / (df.get(w) ?? 1)));
    return v;
  });
  return { vecs, df, toks };
}
function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, na = 0, nb = 0;
  for (const [, x] of a) na += x * x;
  for (const [k, y] of b) { nb += y * y; const x = a.get(k); if (x) dot += x * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
/**
 * Agglomerative clustering (average linkage). Merges down to at most `k` groups, and keeps merging
 * while the closest pair is still similar (>= `threshold`) so related items never stay split.
 */
function cluster(vecs: Map<string, number>[], k: number, threshold = Infinity): number[][] {
  let groups = vecs.map((_, i) => [i]);
  const sim = (g: number[], h: number[]) => { let s = 0; for (const i of g) for (const j of h) s += cosine(vecs[i], vecs[j]); return s / (g.length * h.length); };
  while (groups.length > 1) {
    let best = -1, bi = 0, bj = 1;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) { const s = sim(groups[i], groups[j]); if (s > best) { best = s; bi = i; bj = j; } }
    if (groups.length <= k && best < threshold) break;
    groups[bi] = [...groups[bi], ...groups[bj]];
    groups.splice(bj, 1);
  }
  return groups.sort((a, b) => b.length - a.length);
}
/** Most characteristic words of a group of token lists, returned as display words. */
function topTerms(texts: string[], all: string[], n = 2) {
  const inGroup = new Map<string, number>(), display = new Map<string, string>();
  texts.forEach((t) => new Set(words(t)).forEach((w) => { const s = stem(w); inGroup.set(s, (inGroup.get(s) ?? 0) + 1); if (!display.has(s)) display.set(s, w); }));
  const everywhere = new Map<string, number>();
  all.forEach((t) => new Set(words(t).map(stem)).forEach((s) => everywhere.set(s, (everywhere.get(s) ?? 0) + 1)));
  return [...inGroup.entries()].map(([s, c]) => [s, c * Math.log(1 + all.length / (everywhere.get(s) ?? 1))] as const).sort((a, b) => b[1] - a[1]).slice(0, n).map(([s]) => display.get(s)!);
}

const CONCEPT_LABEL: Record<string, string> = { cost: 'cost & fees', speed: 'speed & performance', account: 'accounts & sign-in', navigation: 'finding things', errors: 'errors & bugs', clarity: 'clarity', trust: 'trust & transparency', support: 'support', mobile: 'mobile experience', checkout: 'checkout', onboarding: 'getting started', content: 'product information' };
/** Label for a cluster: its dominant UX concept(s), else its most distinctive words. */
function groupLabel(texts: string[], all: string[]): string[] {
  const counts = new Map<string, number>();
  texts.forEach((t) => new Set(conceptTokens(t)).forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1)));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= Math.max(1, texts.length * 0.4));
  if (top.length) return top.slice(0, top[1] && top[1][1] >= top[0][1] * 0.8 ? 2 : 1).map(([c]) => CONCEPT_LABEL[c.slice(1)] ?? c.slice(1));
  return topTerms(texts, all, 2);
}

/* ---------- domain knowledge packs ---------- */
interface Pack {
  keys: string[];
  goals: string[]; frustrations: string[]; motivations: string[]; behaviors: string[]; tools: string[];
  sections: Record<string, string[]>;
  nouns: { item: string; action: string };
}
const PACKS: Record<string, Pack> = {
  finance: {
    keys: ['payroll', 'bank', 'finance', 'invoice', 'tax', 'accounting', 'budget', 'payment', 'loan', 'mortgage', 'insurance', 'expense', 'salary', 'invest', 'wallet', 'fintech', 'billing'],
    goals: ['Get every payment right the first time', 'Stay compliant with changing regulations', 'See the full financial picture in one place', 'Close the month without overtime', 'Reduce time spent on manual reconciliation'],
    frustrations: ['Rules change and the tools lag behind', 'Copying numbers between spreadsheets and systems', 'Errors are only discovered after money has moved', 'Unclear fees and hidden charges', 'Too many approval steps for routine tasks'],
    motivations: ['Being trusted as the person who never makes mistakes', 'Peace of mind before deadlines', 'Freeing time for higher-value analysis', 'Protecting people who depend on accurate payments'],
    behaviors: ['Double-checks totals before submitting', 'Keeps a personal checklist for recurring tasks', 'Exports data to Excel to verify it', 'Works ahead of deadlines to leave a buffer'],
    tools: ['Excel', 'Online banking portal', 'Accounting software', 'Email', 'Government tax portal'],
    sections: { Dashboard: ['Overview', 'Alerts', 'Upcoming deadlines'], Transactions: ['All transactions', 'Approvals', 'Disputes'], Reports: ['Monthly report', 'Tax summary', 'Export'], Settings: ['Accounts', 'Team & permissions', 'Integrations'] },
    nouns: { item: 'payment', action: 'pay' },
  },
  health: {
    keys: ['health', 'patient', 'clinic', 'doctor', 'medical', 'hospital', 'therapy', 'fitness', 'wellness', 'dental', 'pharmacy', 'nurse', 'mental', 'care'],
    goals: ['Book care without phone queues', 'Understand results in plain language', 'Keep track of appointments and medication', 'Feel confident decisions are right for them'],
    frustrations: ['Waiting on hold to book or change appointments', 'Medical jargon nobody explains', 'Repeating the same history to every provider', 'Not knowing what happens next after a visit'],
    motivations: ['Feeling in control of their health', 'Taking care of family members', 'Avoiding unnecessary stress and cost'],
    behaviors: ['Searches symptoms online before appointments', 'Keeps paper notes of medication', 'Prefers reminders by text message', 'Asks friends for provider recommendations'],
    tools: ['Patient portal', 'Calendar app', 'Search engine', 'Messaging apps'],
    sections: { Appointments: ['Book', 'Upcoming', 'History'], 'My health': ['Results', 'Medication', 'Records'], Messages: ['Inbox', 'Ask a clinician'], Account: ['Profile', 'Insurance', 'Family members'] },
    nouns: { item: 'appointment', action: 'book' },
  },
  commerce: {
    keys: ['shop', 'store', 'ecommerce', 'checkout', 'cart', 'retail', 'product', 'order', 'delivery', 'marketplace', 'buy', 'sell', 'fashion', 'plant', 'grocery'],
    goals: ['Find the right product quickly', 'Know the total cost before paying', 'Get orders delivered on time', 'Return items without hassle'],
    frustrations: ['Surprise shipping fees at checkout', 'Creating an account just to buy once', 'Unclear stock and delivery dates', 'Product photos that do not match reality'],
    motivations: ['Getting good value', 'Treating themselves or someone else', 'Saving time compared with going to a store'],
    behaviors: ['Compares prices across tabs', 'Reads reviews before buying', 'Leaves items in the cart to decide later', 'Shops mostly on their phone'],
    tools: ['Mobile browser', 'Shopping apps', 'Price comparison sites', 'Digital wallet'],
    sections: { Shop: ['Categories', 'New arrivals', 'Deals'], Product: ['Details', 'Reviews', 'Related'], Cart: ['Cart', 'Checkout', 'Order confirmation'], Account: ['Orders', 'Returns', 'Addresses', 'Wishlist'] },
    nouns: { item: 'order', action: 'buy' },
  },
  education: {
    keys: ['learn', 'course', 'student', 'teacher', 'school', 'education', 'class', 'lesson', 'university', 'training', 'tutor', 'study', 'exam'],
    goals: ['Learn efficiently around a busy schedule', 'Track progress and stay motivated', 'Get help when stuck', 'Earn a recognised qualification'],
    frustrations: ['Losing track of deadlines across platforms', 'Content that is too long to fit in short breaks', 'Feedback that arrives too late to be useful', 'Feeling alone when stuck'],
    motivations: ['Career progression', 'Curiosity and personal growth', 'Making family proud'],
    behaviors: ['Studies in short sessions on mobile', 'Watches videos at faster speed', 'Uses group chats to ask peers', 'Crams before deadlines'],
    tools: ['Learning platform', 'YouTube', 'Notes app', 'Group chat'],
    sections: { Learn: ['My courses', 'Browse catalogue', 'Continue learning'], Progress: ['Grades', 'Certificates', 'Goals'], Community: ['Discussions', 'Study groups'], Account: ['Profile', 'Notifications', 'Billing'] },
    nouns: { item: 'lesson', action: 'learn' },
  },
  travel: {
    keys: ['travel', 'flight', 'hotel', 'trip', 'booking', 'vacation', 'holiday', 'airline', 'tour', 'rental'],
    goals: ['Plan a trip without dozens of open tabs', 'Know exactly what is included in the price', 'Handle changes and delays calmly', 'Keep all bookings in one place'],
    frustrations: ['Prices that change between search and checkout', 'Confusing change and cancellation rules', 'Itineraries scattered across emails', 'Poor support when plans go wrong'],
    motivations: ['Creating memorable experiences', 'Getting the best deal', 'Reducing travel stress'],
    behaviors: ['Searches weeks in advance and tracks prices', 'Reads reviews and looks at photos', 'Screenshots booking confirmations', 'Books on desktop, checks on mobile'],
    tools: ['Booking sites', 'Maps', 'Airline apps', 'Email'],
    sections: { Explore: ['Destinations', 'Deals', 'Inspiration'], Trips: ['Upcoming', 'Past', 'Itinerary'], Bookings: ['Flights', 'Stays', 'Experiences'], Help: ['Change a booking', 'Contact support', 'Travel advice'] },
    nouns: { item: 'booking', action: 'book' },
  },
  food: {
    keys: ['recipe', 'meal', 'food', 'restaurant', 'cooking', 'kitchen', 'diet', 'nutrition', 'menu', 'delivery'],
    goals: ['Decide what to eat without decision fatigue', 'Eat healthier on a realistic budget', 'Waste less food', 'Cook with what is already at home'],
    frustrations: ['Recipes buried under long stories', 'Ingredient lists that need special shops', 'Planning meals takes too long', 'Forgetting items at the supermarket'],
    motivations: ['Health and energy', 'Saving money', 'Enjoying time with family over food'],
    behaviors: ['Saves recipes but rarely cooks them', 'Shops weekly with a list', 'Follows food creators on social media', 'Cooks the same few meals'],
    tools: ['Recipe apps', 'Notes app', 'Supermarket app', 'Instagram'],
    sections: { Recipes: ['Browse', 'Saved', 'Collections'], 'Meal plan': ['This week', 'Planner', 'History'], Groceries: ['Shopping list', 'Pantry'], Profile: ['Preferences', 'Diet & allergies', 'Settings'] },
    nouns: { item: 'recipe', action: 'cook' },
  },
  saas: {
    keys: ['team', 'project', 'saas', 'dashboard', 'productivity', 'crm', 'workspace', 'collaboration', 'hr', 'admin', 'analytics', 'software', 'platform', 'tool', 'app', 'inbox', 'freelance', 'agency'],
    goals: ['Keep the team aligned without extra meetings', 'Spend less time on admin', 'See status at a glance', 'Onboard new colleagues quickly'],
    frustrations: ['Information spread across too many tools', 'Notifications that bury what matters', 'Setup that requires IT help', 'Reports that take hours to compile'],
    motivations: ['Looking organised and in control', 'Shipping work on time', 'Helping the team succeed'],
    behaviors: ['Starts the day by triaging notifications', 'Keeps a personal to-do list outside the tool', 'Shares screenshots in chat', 'Uses keyboard shortcuts heavily'],
    tools: ['Slack', 'Google Workspace', 'Spreadsheets', 'Project management tool'],
    sections: { Home: ['Overview', 'My tasks', 'Activity'], Projects: ['All projects', 'Board', 'Timeline'], Reports: ['Dashboards', 'Exports'], Settings: ['Workspace', 'Members', 'Billing', 'Integrations'] },
    nouns: { item: 'task', action: 'manage' },
  },
};
const GENERIC: Pack = {
  keys: [],
  goals: ['Get the job done quickly and correctly', 'Feel confident about each decision', 'Avoid repeating the same work', 'Find help when needed'],
  frustrations: ['Too many steps for simple tasks', 'Unclear next steps', 'Having to re-enter the same information', 'Slow or unhelpful support'],
  motivations: ['Saving time', 'Feeling in control', 'Being seen as competent'],
  behaviors: ['Skims rather than reads', 'Asks colleagues before searching docs', 'Uses mobile for quick checks, desktop for real work', 'Abandons tasks that feel risky'],
  tools: ['Email', 'Phone', 'Search engine', 'Spreadsheets'],
  sections: { Home: ['Overview', 'Recent activity'], Explore: ['Browse', 'Search'], Account: ['Profile', 'Settings', 'Notifications'], Help: ['Help centre', 'Contact us'] },
  nouns: { item: 'task', action: 'complete' },
};
function packFor(text: string): Pack {
  const w = text.toLowerCase();
  let best: Pack = GENERIC, score = 0;
  for (const p of Object.values(PACKS)) {
    const s = p.keys.reduce((n, k) => n + (w.includes(k) ? 1 : 0), 0);
    if (s > score) { score = s; best = p; }
  }
  return best;
}

const FIRST = ['Sara', 'Daniel', 'Priya', 'Mateo', 'Aisha', 'Jonas', 'Mei', 'Omar', 'Lucia', 'Kwame', 'Hannah', 'Ravi', 'Elena', 'Tom', 'Yuki', 'Noah', 'Fatima', 'Leo', 'Grace', 'Arjun'];
const LAST = ['Ahmed', 'Okafor', 'Sharma', 'García', 'Müller', 'Chen', 'Kowalski', 'Haddad', 'Silva', 'Mensah', 'Novak', 'Patel', 'Rossi', 'Kim', 'Johansson', 'Dubois', 'Tanaka', 'Hughes'];
const CITIES = ['Leeds, UK', 'Austin, USA', 'Bengaluru, India', 'Berlin, Germany', 'Toronto, Canada', 'Lisbon, Portugal', 'Melbourne, Australia', 'Nairobi, Kenya', 'Madrid, Spain', 'Singapore', 'Amsterdam, Netherlands', 'Chennai, India'];

/* ---------- generators ---------- */
function persona(r: R, inp: Record<string, string>) {
  const who = clean(inp.who || 'a typical user');
  const ctx = `${who} ${inp.product ?? ''}`;
  const p = packFor(ctx);
  const ageMatch = who.match(/(\d{2})[\s-]*(?:years?|yrs?|y\/o|-year)/i) ?? who.match(/\b(\d{2})\b/);
  const age = ageMatch ? Number(ageMatch[1]) : 24 + Math.floor(r() * 30);
  const role = cap(clean(who.replace(/\b\d{2}[\s-]*(years?[\s-]*old|yrs?|y\/o|-year-old)?\b/gi, '').replace(/^(a|an|the)\s+/i, '').replace(/\s*(at|in|for)\s+.*/i, (m) => m)) || 'User');
  const goals = pickN(r, p.goals, 4), frustrations = pickN(r, p.frustrations, 4);
  const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
  return {
    name, age, role, location: pick(r, CITIES),
    quote: `${cap(goals[0].replace(/\.$/, ''))} — that’s what really matters to me.`,
    bio: (() => { const [b1, b2] = pickN(r, p.behaviors, 2); return `${name.split(' ')[0]} is ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${lower1(role)}${inp.product ? ` who uses ${clean(inp.product)}` : ''}. ${cap(lower1(b1))} and ${lower1(b2)}. Their biggest worry: ${lower1(frustrations[0])}.`; })(),
    goals, frustrations, motivations: pickN(r, p.motivations, 3), behaviors: pickN(r, p.behaviors, 3), tools: pickN(r, p.tools, 4),
    techSavviness: 2 + Math.floor(r() * 3),
  };
}

function journey(r: R, inp: Record<string, string>) {
  const scenario = clean(inp.scenario || 'complete their goal');
  const who = clean(inp.persona || 'the user');
  const p = packFor(`${scenario} ${who}`);
  const goal = lower1(scenario.replace(/^(to|getting|get)\s+/i, (m) => (/getting/i.test(m) ? 'get ' : '')));
  const stages = [
    { name: 'Realise the need', actions: [`Notices they need to ${goal}`, 'Talks to friends or colleagues'], thoughts: ['Where do I even start?', 'How long will this take?'], emotion: 'neutral', painPoints: ['No clear starting point'], opportunities: ['Show a simple “how it works” overview'] },
    { name: 'Research options', actions: ['Searches online and compares options', 'Reads reviews'], thoughts: ['Which one can I trust?', 'What will it really cost?'], emotion: 'neutral', painPoints: ['Information overload', 'Unclear pricing'], opportunities: ['Transparent comparison and pricing up front'] },
    { name: 'Sign up / start', actions: ['Creates an account', 'Enters personal details'], thoughts: ['Why do they need all this?', 'Hope I don’t make a mistake'], emotion: 'frustrated', painPoints: ['Long forms', 'Re-entering known information'], opportunities: ['Progressive sign-up and smart defaults'] },
    { name: cap(`${p.nouns.action} / complete`), actions: [`Completes the main step to ${goal}`, 'Uploads or confirms details'], thoughts: ['Did that work?', 'What happens next?'], emotion: 'frustrated', painPoints: ['Errors with unclear messages', 'No progress indicator'], opportunities: ['Inline validation and a clear progress tracker'] },
    { name: 'Wait & follow up', actions: ['Checks status', 'Contacts support'], thoughts: ['Is anyone working on this?'], emotion: 'neutral', painPoints: ['Silence after submitting', 'Slow support replies'], opportunities: ['Proactive status updates by email or SMS'] },
    { name: 'Outcome', actions: [`Achieves the goal: ${goal}`, 'Shares the experience'], thoughts: ['That was easier than expected', 'I’d recommend this'], emotion: 'delighted', painPoints: ['Next steps are unclear after success'], opportunities: ['Celebrate success and suggest a helpful next step'] },
  ];
  // nudge some wording with pack-specific frustrations
  stages[1].painPoints.push(pick(r, p.frustrations));
  stages[3].painPoints[0] = pick(r, p.frustrations);
  return { title: cap(scenario), stages };
}

function sitemap(r: R, inp: Record<string, string>) {
  const product = clean(inp.product || 'Product');
  const p = packFor(`${product} ${inp.features ?? ''}`);
  const feats = (inp.features ?? '').split(/\n|,/).map(clean).filter(Boolean);
  const nodes: { id: string; label: string; parentId: string | null; note: string }[] = [{ id: 'root', label: cap(product.split(/\s+(with|for|that)\s+/i)[0]), parentId: null, note: '' }];
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + nodes.length;
  const sections = feats.length ? Object.fromEntries(feats.slice(0, 7).map((f) => [cap(f), ['Overview', 'Details', 'Settings']])) : p.sections;
  for (const [sec, pages] of Object.entries(sections)) {
    const id = slug(sec);
    nodes.push({ id, label: sec, parentId: 'root', note: '' });
    for (const pg of pages) nodes.push({ id: slug(pg), label: pg, parentId: id, note: '' });
  }
  if (!Object.keys(sections).some((s) => /account|profile|settings/i.test(s))) {
    nodes.push({ id: 'account', label: 'Account', parentId: 'root', note: 'Profile, settings and billing' });
    ['Profile', 'Settings'].forEach((pg) => nodes.push({ id: slug(pg), label: pg, parentId: 'account', note: '' }));
  }
  void r;
  return { title: `${nodes[0].label} sitemap`, nodes };
}

function hmw(r: R, inp: Record<string, string>) {
  const problem = clean(inp.problem || 'Users struggle to complete the task');
  const subj = (problem.match(/^(new |first-time |busy |)([a-z ]+?)(s)?\s+(feel|are|struggle|can't|cannot|don't|do not|find|get|have|lose|forget|need|want)/i)?.[0] ?? '').split(/\s+(feel|are|struggle|can't|cannot|don't|do not|find|get|have|lose|forget|need|want)/i)[0] || 'users';
  const pain = lower1(problem.replace(/\.$/, ''));
  const s = lower1(subj);
  const all = [
    ['Remove the pain', `How might we remove the moments where ${pain}?`, ['Map and cut the worst step', 'Add a safety net for mistakes']],
    ['Amplify the good', `How might we make the parts that already work for ${s} even better?`, ['Double down on the favourite feature', 'Make success more visible']],
    ['Flip it', `How might we turn this problem into a moment ${s} actually enjoy?`, ['Gamify progress', 'Add a small delight at the end']],
    ['Question the assumption', `How might we achieve the same outcome without the step that causes the problem?`, ['Automate it', 'Do it for them by default']],
    ['Go analogous', `How might we borrow from how great hosts welcome guests to help ${s}?`, ['A personal welcome guide', 'Anticipate needs before they ask']],
    ['Change the status quo', `How might we make the current process obsolete for ${s}?`, ['One-click alternative', 'Pre-filled smart defaults']],
    ['Focus on emotion', `How might we help ${s} feel confident instead of anxious?`, ['Reassuring progress cues', 'Clear “what happens next”']],
    ['Involve others', `How might we let peers or colleagues support ${s} at the right moment?`, ['Buddy system', 'Shareable checklists']],
    ['Break it down', `How might we split this into smaller, easier steps for ${s}?`, ['Step-by-step flow', 'Save and resume later']],
  ];
  return { problem, statements: pickN(r, all, 8).map(([angle, h, ideas]) => ({ angle, hmw: h as string, ideas })) };
}

function affinity(_r: R, inp: Record<string, string>, docText?: string) {
  const raw = `${inp.notes ?? ''}\n${docText ?? ''}`;
  let notes = raw.split(/\n+/).map((s) => clean(s.replace(/^[-*•\d.)\s]+/, ''))).filter((s) => s.length > 2);
  if (notes.length < 4) notes = sentences(raw);
  notes = [...new Set(notes)].slice(0, 120);
  if (notes.length === 0) return { clusters: [] };
  const { vecs } = tfidf(notes);
  const groups = cluster(vecs, 7, 0.12);
  return {
    clusters: groups.map((g) => {
      const texts = g.map((i) => notes[i]);
      const terms = groupLabel(texts, notes);
      const theme = terms.length ? cap(terms.join(' & ')) : 'Other';
      const neg = texts.filter((t) => /\b(slow|hard|confus|frustrat|annoy|hate|can't|cannot|difficult|broken|error|fail|lost|unclear|expensive|too many|too long|bug)/i.test(t)).length;
      const insight = `${texts.length} note${texts.length > 1 ? 's' : ''} about ${terms.join(' and ') || 'this topic'}${neg > texts.length / 2 ? ' — mostly pain points worth prioritising' : neg ? ' — a mix of needs and frustrations' : ' — mostly needs and positive signals'}.`;
      return { theme, insight, notes: texts.map((t) => (t.length > 140 ? t.slice(0, 137) + '…' : t)) };
    }),
  };
}

function copyGen(r: R, inp: Record<string, string>) {
  const screen = clean(inp.screen || 'screen');
  const s = screen.toLowerCase();
  const p = packFor(`${screen} ${inp.audience ?? ''}`);
  const thing = (s.match(/(?:for|of)\s+(?:a|an|the)?\s*([a-z ]+)$/)?.[1] ?? p.nouns.item).trim();
  type V = { label: string; headline: string; body: string; primaryCta: string; secondaryCta: string };
  let variants: V[];
  if (/empty|no data|nothing/.test(s)) variants = [
    { label: 'Direct', headline: `No ${thing}s yet`, body: `Your ${thing}s will appear here. Create your first one to get started.`, primaryCta: `Create ${thing}`, secondaryCta: 'Learn how' },
    { label: 'Warm', headline: 'A fresh start', body: `This is where your ${thing}s will live. Add one now — it only takes a minute.`, primaryCta: `Add a ${thing}`, secondaryCta: 'See an example' },
    { label: 'Playful', headline: 'It’s quiet in here…', body: `Too quiet. Let’s fix that with your first ${thing}.`, primaryCta: 'Let’s go', secondaryCta: 'Maybe later' },
  ];
  else if (/error|fail|404|wrong/.test(s)) variants = [
    { label: 'Direct', headline: 'Something went wrong', body: 'We couldn’t complete that. Check your connection and try again.', primaryCta: 'Try again', secondaryCta: 'Contact support' },
    { label: 'Warm', headline: 'Sorry about that', body: 'That didn’t work on our side. Your work is safe — please try again in a moment.', primaryCta: 'Try again', secondaryCta: 'Go back' },
    { label: 'Playful', headline: 'Well, that wasn’t supposed to happen', body: 'We tripped over a cable. Give it another go?', primaryCta: 'Retry', secondaryCta: 'Take me home' },
  ];
  else if (/sign ?up|register|onboard|welcome/.test(s)) variants = [
    { label: 'Direct', headline: 'Create your account', body: `Start managing your ${thing}s in minutes. No credit card needed.`, primaryCta: 'Get started', secondaryCta: 'I have an account' },
    { label: 'Warm', headline: 'Welcome aboard', body: `We’ll set things up together — it takes about two minutes.`, primaryCta: 'Let’s begin', secondaryCta: 'Skip for now' },
    { label: 'Playful', headline: 'Hello, new friend', body: `Your ${thing}s are about to get a lot easier.`, primaryCta: 'Count me in', secondaryCta: 'Show me around first' },
  ];
  else if (/pric|plan|upgrade|subscri/.test(s)) variants = [
    { label: 'Direct', headline: 'Choose your plan', body: 'Simple pricing. Change or cancel anytime.', primaryCta: 'Start free trial', secondaryCta: 'Compare plans' },
    { label: 'Warm', headline: 'Find the plan that fits', body: 'Start free and upgrade only when you need more.', primaryCta: 'Try it free', secondaryCta: 'Talk to us' },
    { label: 'Playful', headline: 'Pick your power level', body: 'From side project to world domination.', primaryCta: 'Power up', secondaryCta: 'See what’s included' },
  ];
  else if (/success|confirm|done|complete|thank/.test(s)) variants = [
    { label: 'Direct', headline: `Your ${thing} is confirmed`, body: 'We’ve sent the details to your email.', primaryCta: 'View details', secondaryCta: 'Back to home' },
    { label: 'Warm', headline: 'All done — nice work!', body: 'Everything is set. We’ll let you know if anything changes.', primaryCta: 'Continue', secondaryCta: 'Share' },
    { label: 'Playful', headline: 'High five! 🙌', body: `That ${thing} is sorted. Time for a coffee.`, primaryCta: 'What’s next?', secondaryCta: 'Done' },
  ];
  else variants = [
    { label: 'Direct', headline: cap(`${p.nouns.action} ${thing}s faster`), body: `Everything you need to ${p.nouns.action} your ${thing}s in one place.`, primaryCta: 'Get started', secondaryCta: 'Learn more' },
    { label: 'Warm', headline: 'Less busywork, more progress', body: `We handle the details so you can focus on what matters.`, primaryCta: 'Try it now', secondaryCta: 'See how it works' },
    { label: 'Playful', headline: `Your ${thing}s, minus the chaos`, body: 'Finally, a tool that keeps up with you.', primaryCta: 'Show me', secondaryCta: 'Not yet' },
  ];
  if (inp.tone && /formal|professional/i.test(inp.tone)) variants = variants.filter((v) => v.label !== 'Playful');
  return {
    variants,
    microcopy: [
      { element: 'Search placeholder', text: `Search ${thing}s` },
      { element: 'Required field error', text: 'Please fill this in to continue' },
      { element: 'Save confirmation', text: 'Saved' },
      { element: 'Delete confirmation', text: `Delete this ${thing}? You can’t undo this.` },
      { element: 'Loading', text: `Loading your ${thing}s…` },
    ],
    tips: pickN(r, ['Lead with the benefit, not the feature', 'Use the words your users use — avoid internal jargon', 'Make buttons say what they do (verb + noun)', 'Keep error messages blameless and say how to fix them', 'Front-load the important words; people skim'], 3),
  };
}

function summarize(_r: R, inp: Record<string, string>, docText?: string) {
  const text = `${inp.content ?? ''}\n${docText ?? ''}`.trim();
  const sents = sentences(text);
  if (!sents.length) return { summary: 'There was not enough text to summarize.', themes: [], insights: [], recommendations: [], quotes: [] };
  const { vecs } = tfidf(sents);
  // centrality score: similarity to the rest of the document
  const score = vecs.map((v, i) => vecs.reduce((s, w, j) => (i === j ? s : s + cosine(v, w)), 0) / Math.max(1, vecs.length - 1));
  const top = score.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const summary = top.slice(0, Math.min(4, sents.length)).map(([, i]) => i).sort((a, b) => a - b).map((i) => sents[i]).join(' ');
  const k = Math.max(1, Math.min(6, Math.round(Math.sqrt(sents.length / 2))));
  const groups = cluster(vecs, Math.min(k, sents.length), 0.2).filter((g) => g.length);
  const themes = groups.slice(0, 6).map((g) => {
    const texts = g.map((i) => sents[i]);
    const best = [...g].sort((a, b) => score[b] - score[a]).slice(0, 3).map((i) => sents[i]);
    return { theme: cap(groupLabel(texts, sents).join(' & ') || 'General'), evidence: best.map((t) => (t.length > 160 ? t.slice(0, 157) + '…' : t)) };
  });
  const painRe = /\b(slow|hard|confus|frustrat|annoy|hate|difficult|broken|error|fail|lost|unclear|expensive|too many|too long|bug|problem|issue|struggl|can't|cannot|wish)/i;
  const insights = sents.filter((s) => painRe.test(s)).sort((a, b) => score[sents.indexOf(b)] - score[sents.indexOf(a)]).slice(0, 5);
  const quotes = (text.match(/[“"]([^”"]{12,200})[”"]/g) ?? []).map((q) => q.replace(/^[“"]|[”"]$/g, '')).slice(0, 4);
  return {
    summary,
    themes,
    insights: insights.length ? insights : top.slice(4, 8).map(([, i]) => sents[i]),
    recommendations: themes.slice(0, 4).map((t) => `Investigate and address “${t.theme.toLowerCase()}” — it came up ${groups[themes.indexOf(t)]?.length ?? 1} time(s).`),
    quotes,
  };
}

function topicOf(text: string) {
  const t = clean(text).replace(/\.$/, '');
  const m = t.match(/(?:understand|learn|explore|discover|find out)\s+(?:how|why|what|whether)?\s*(.+)/i);
  return lower1(m ? m[1] : t);
}

function interview(_r: R, inp: Record<string, string>) {
  const topic = topicOf(inp.objective || 'their current workflow');
  const who = clean(inp.participants || 'participants');
  return {
    title: cap(topic.length > 60 ? topic.slice(0, 57) + '…' : topic),
    intro: `Thanks for taking the time to talk with us. We’re learning how people approach ${topic}. There are no right or wrong answers — we’re testing ideas, not you. Is it okay if I take notes and record audio for our team only?`,
    sections: [
      { title: 'Warm-up', questions: [{ question: 'Tell me a little about yourself and your role.', followUp: 'What does a typical week look like?' }, { question: `How does ${topic.split(' ').slice(0, 6).join(' ')} fit into your work or life?`, followUp: 'How often does that come up?' }] },
      { title: 'Current experience', questions: [{ question: 'Walk me through the last time you did this, step by step.', followUp: 'What happened just before and right after?' }, { question: 'What tools or people do you rely on?', followUp: 'Why those in particular?' }, { question: 'Which part takes the most time?', followUp: 'What do you do while you wait?' }] },
      { title: 'Pain points & workarounds', questions: [{ question: 'Tell me about a time this went wrong.', followUp: 'How did you resolve it? How did it make you feel?' }, { question: 'Have you created any workarounds or shortcuts?', followUp: 'Can you show me?' }, { question: 'If you could change one thing, what would it be?', followUp: 'Why that above everything else?' }] },
      { title: 'Needs & motivations', questions: [{ question: 'What does a great outcome look like for you?', followUp: 'How would you know you achieved it?' }, { question: `What would make you trust a new solution for this?`, followUp: 'What would make you stop using one?' }] },
      { title: 'Wrap-up', questions: [{ question: 'Is there anything we didn’t ask that we should have?', followUp: 'Who else should we talk to?' }] },
    ],
    closing: `That’s everything — thank you, this was really helpful. We’re speaking with other ${who} too and will use what we learn to improve the experience.`,
  };
}

function brief(r: R, inp: Record<string, string>) {
  const project = clean(inp.project || 'New design project');
  const p = packFor(project);
  const title = cap(project.split(/[.\n]/)[0]);
  const cons = (inp.constraints ?? '').split(/\n|;/).map(clean).filter(Boolean);
  return {
    title: title.length > 70 ? title.slice(0, 67) + '…' : title,
    overview: `This project will ${lower1(project.replace(/\.$/, ''))}. The aim is a simpler, more trustworthy experience that measurably improves outcomes for users and the business.`,
    problem: `Users struggle because ${lower1(pick(r, p.frustrations))}, which leads to drop-off, support requests and lost trust.`,
    goals: [`Improve task completion for the core ${p.nouns.item} flow`, 'Reduce time-on-task and support contacts', pick(r, p.goals), 'Create reusable components for future work'],
    audience: ['Primary: frequent users who complete the core task weekly', 'Secondary: first-time users evaluating the product', 'Internal: support and operations teams'],
    inScope: ['Research synthesis and journey mapping', `Redesign of the core ${p.nouns.item} flow`, 'Responsive web designs and prototype', 'Usability testing with 5–8 users'],
    outOfScope: cons.length ? ['Anything outside the constraints listed below'] : ['Backend or API changes', 'Brand identity redesign', 'Native mobile apps'],
    deliverables: ['Research summary & personas', 'User journey map', 'Wireframes and high-fidelity designs', 'Interactive prototype', 'Design specs & handoff'],
    milestones: [{ name: 'Discovery & research', when: 'Week 1–2' }, { name: 'Concepts & wireframes', when: 'Week 3' }, { name: 'High-fidelity design', when: 'Week 4–5' }, { name: 'Usability testing', when: 'Week 6' }, { name: 'Iteration & handoff', when: 'Week 7' }],
    successMetrics: ['Task completion rate', 'Time on task', 'Conversion / drop-off at key steps', 'Customer satisfaction (CSAT)'],
    risks: [...cons.map((c) => `Constraint: ${c}`), 'Limited access to real users for research', 'Scope creep from stakeholder requests'].slice(0, 5),
  };
}

function questionnaire(_r: R, inp: Record<string, string>) {
  const project = clean(inp.project || 'your project');
  const who = clean(inp.stakeholders || 'you');
  const web = /web|site|app|platform|store|shop/i.test(project);
  return {
    title: `${cap(project)} — discovery questionnaire`,
    intro: `Thank you for helping us shape ${lower1(project)}. Please answer as openly as you can — there are no wrong answers. It takes about 15 minutes. (For: ${who})`,
    sections: [
      { title: 'Business & goals', questions: [{ question: 'Briefly describe your organisation and what makes it different.', type: 'long', options: [] }, { question: 'What is the main goal of this project?', type: 'long', options: [] }, { question: 'How will you measure success six months after launch?', type: 'long', options: [] }, { question: 'What is the most important outcome?', type: 'choice', options: ['More leads / sales', 'Better customer experience', 'Lower operating costs', 'Stronger brand', 'Other'] }] },
      { title: 'Audience', questions: [{ question: 'Who are your primary customers or users?', type: 'long', options: [] }, { question: 'What problems do they come to you to solve?', type: 'long', options: [] }, { question: 'How do they find you today?', type: 'choice', options: ['Search', 'Social media', 'Word of mouth', 'Ads', 'Other'] }] },
      { title: 'Competition & inspiration', questions: [{ question: 'Who are your main competitors?', type: 'short', options: [] }, { question: 'Share 2–3 examples you admire and why.', type: 'long', options: [] }] },
      { title: 'Brand & content', questions: [{ question: 'Describe your brand personality in three words.', type: 'short', options: [] }, { question: 'Do you have brand guidelines, logo files and photography?', type: 'choice', options: ['Yes, all of them', 'Some', 'No'] }, { question: 'Who will write and maintain the content?', type: 'short', options: [] }] },
      ...(web ? [{ title: 'Technical', questions: [{ question: 'Do you have an existing site, domain or platform?', type: 'short', options: [] }, { question: 'Which features are must-haves?', type: 'long', options: [] }, { question: 'Any systems we need to integrate with?', type: 'short', options: [] }] }] : []),
      { title: 'Timeline & budget', questions: [{ question: 'Is there a fixed launch date or event?', type: 'short', options: [] }, { question: 'What budget range have you allocated?', type: 'choice', options: ['Under 5k', '5k–15k', '15k–50k', '50k+', 'Not sure yet'] }, { question: 'How urgent is this project?', type: 'scale', options: [] }, { question: 'Who makes the final decisions?', type: 'short', options: [] }] },
    ],
  };
}

/* ---------- chat: built-in UX knowledge base + document search ---------- */
const KB: { keys: string[]; answer: string }[] = [
  { keys: ['usability test', 'usability testing', 'test', 'testing', 'validate'], answer: 'Usability testing in 5 steps:\n\n1. Define 3–5 tasks that reflect real goals (“Find and book a 30-minute appointment next week”).\n2. Recruit 5 participants per user group — this finds most major issues.\n3. Ask people to think aloud; don’t help or lead. Use neutral prompts: “What are you thinking?”\n4. Measure task success, time on task, errors and a confidence rating (1–7).\n5. Synthesize: list issues, rate severity (frequency × impact) and fix the top ones before retesting.\n\nTip: a clickable prototype is enough; you don’t need finished visuals.' },
  { keys: ['persona', 'personas'], answer: 'Good personas are based on research, not assumptions:\n\n• Interview 5–10 users and look for patterns in goals, behaviours and frustrations.\n• Build 2–4 personas around distinct goals, not demographics.\n• Include: goal, context of use, key frustrations, motivations and a realistic quote.\n• Keep them visible and use them in decisions: “Would Sara understand this?”\n\nUse the User persona tool to draft one, then refine it with real data.' },
  { keys: ['journey', 'journey map', 'customer journey'], answer: 'To build a journey map:\n\n1. Pick one persona and one scenario with a clear start and end.\n2. List stages chronologically (aware → consider → act → use → follow up).\n3. For each stage capture actions, thoughts, emotions, pain points and opportunities.\n4. Mark the emotional low points — these are your best opportunities.\n5. Validate with real users or support data.\n\nThe User journey map tool creates a ready-to-edit board.' },
  { keys: ['navigation', 'information architecture', 'ia', 'menu', 'sitemap', 'card sort'], answer: 'Improving navigation / IA:\n\n• Run an open card sort (15+ participants) to learn how users group content.\n• Draft a sitemap, then validate it with a tree test (“Where would you find…?”).\n• Keep top-level items to 5–7, labelled with users’ words.\n• Put the most frequent tasks one click away; bury rarely used settings.\n• Measure success rate and directness in tree tests before visual design.' },
  { keys: ['onboarding', 'first time', 'activation', 'signup', 'sign up'], answer: 'Effective onboarding:\n\n• Get people to their first success (“aha moment”) as fast as possible.\n• Ask only for information you need now; collect the rest later.\n• Prefer learning by doing (empty states, inline tips) over long tours.\n• Show progress (1 of 3) and let users skip.\n• Track activation: the % of new users who complete the key action within a week.' },
  { keys: ['form', 'forms', 'input', 'field', 'checkout'], answer: 'Form best practices:\n\n• One column, labels above fields, logical order.\n• Ask for less: every field must earn its place.\n• Validate inline after the field loses focus, with specific, blameless errors.\n• Use the right input types (email, tel, numeric keyboards) and autofill.\n• Show what is optional rather than marking everything required.\n• For checkout: guest checkout, clear total cost early, progress indicator.' },
  { keys: ['accessibility', 'a11y', 'wcag', 'contrast', 'screen reader'], answer: 'Accessibility essentials (WCAG 2.2 AA):\n\n• Text contrast at least 4.5:1 (3:1 for large text and UI parts).\n• Everything works with a keyboard, with a visible focus indicator.\n• Meaningful alt text; labels on every form field.\n• Don’t rely on colour alone to convey meaning.\n• Touch targets at least 24×24 px (44 px recommended).\n• Respect reduced motion and allow text resizing to 200%.' },
  { keys: ['interview', 'interviews', 'questions', 'user research'], answer: 'Running user interviews:\n\n• Start with a clear research question, then write open, non-leading questions.\n• Ask about past behaviour (“Tell me about the last time…”) rather than opinions about the future.\n• Follow up with “Why?” and “Can you show me?”; get comfortable with silence.\n• Talk to 5–8 people per segment; synthesize together right after each session.\n\nThe User interviews tool generates a full guide.' },
  { keys: ['metric', 'metrics', 'kpi', 'measure', 'success'], answer: 'Useful UX metrics:\n\n• Behavioural: task success, time on task, error rate, conversion, retention.\n• Attitudinal: SUS, CSAT, NPS, confidence ratings.\n• Use the HEART framework (Happiness, Engagement, Adoption, Retention, Task success) with goals → signals → metrics.\n• Always pair a number with a qualitative “why”.' },
  { keys: ['prioritize', 'prioritise', 'priority', 'roadmap', 'backlog'], answer: 'Prioritising UX work:\n\n• Score issues by frequency × severity × reach.\n• Use an impact/effort matrix: do quick wins first, plan big bets, drop low-impact work.\n• RICE (Reach, Impact, Confidence, Effort) works well for features.\n• Tie priorities to a measurable goal so trade-offs are easier to discuss.' },
  { keys: ['survey', 'questionnaire'], answer: 'Writing a good survey:\n\n• One goal per survey; keep it under 10 minutes.\n• Ask one thing per question, avoid leading wording and double negatives.\n• Use balanced scales (5 or 7 points) and include “Not applicable”.\n• Put sensitive or demographic questions at the end.\n• Pilot with 2–3 people before sending.' },
  { keys: ['affinity', 'synthesis', 'synthesize', 'insights'], answer: 'Synthesizing research:\n\n1. Write one observation per note (quote, behaviour or pain point).\n2. Cluster notes bottom-up by similarity, not predefined categories.\n3. Name each cluster with a statement (“People don’t trust fees they can’t see”).\n4. Turn clusters into insights and “How might we…” questions.\n\nTry the Affinity mapping and Summarize tools on your notes.' },
  { keys: ['copy', 'microcopy', 'writing', 'content', 'button', 'label'], answer: 'UX writing tips:\n\n• Be clear first, clever second.\n• Buttons: verb + noun (“Save changes”, not “OK”).\n• Errors: what happened, why, and how to fix it — never blame the user.\n• Front-load key words; people scan.\n• Use your users’ vocabulary and keep terminology consistent.' },
  { keys: ['dark pattern', 'ethic', 'trust'], answer: 'Building trust and avoiding dark patterns:\n\n• Make costs, renewals and cancellation clear and easy.\n• Use honest defaults; don’t pre-tick consent or upsells.\n• Make “No” as easy as “Yes”.\n• Explain why you need data and how it’s used.' },
  { keys: ['mobile', 'responsive', 'touch'], answer: 'Mobile UX essentials:\n\n• Design for one-handed use: primary actions within thumb reach.\n• Large touch targets (44 px+) with spacing.\n• Short forms with the right keyboards and autofill.\n• Prioritise content; progressive disclosure over cramming.\n• Test on real devices and slow networks.' },
  { keys: ['design system', 'component', 'tokens', 'consistency'], answer: 'Starting a design system:\n\n• Audit existing UI and list repeated patterns.\n• Define tokens first (colour, type, spacing, radius) — use Variables in Figmy.\n• Build core components (button, input, card) with variants and properties.\n• Document usage with do’s and don’ts, and keep design and code in sync.' },
];

function chatAnswer(question: string, docText?: string) {
  const q = question.toLowerCase();
  if (docText) {
    const passages = docText.replace(/\r/g, '').split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/).map(clean).filter((p) => p.length > 30);
    const qWords = new Set(words(q).map(stem));
    const scored = passages.map((p) => { const ws = words(p).map(stem); const hit = ws.filter((w) => qWords.has(w)).length; return [hit / Math.sqrt(ws.length + 1), p] as const; }).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 4);
    if (/summar|overview|main points|key points|tl;?dr/.test(q) || !scored.length) {
      const s = summarize(() => 0.5, { content: docText });
      return `${scored.length ? '' : 'I couldn’t find passages that match your question directly, so here is an overview of the document.\n\n'}Summary:\n${s.summary}\n\nMain themes:\n${s.themes.map((t) => `• ${t.theme}`).join('\n')}${s.insights.length ? `\n\nNotable points:\n${s.insights.slice(0, 3).map((i) => `• ${i}`).join('\n')}` : ''}`;
    }
    return `Here is what your document says about that:\n\n${scored.map(([, p]) => `“${p.length > 400 ? p.slice(0, 397) + '…' : p}”`).join('\n\n')}`;
  }
  let best: { keys: string[]; answer: string } | null = null, score = 0;
  for (const e of KB) { const s = e.keys.reduce((n, k) => n + (q.includes(k) ? k.length : 0), 0); if (s > score) { score = s; best = e; } }
  if (best) return best.answer;
  return 'I can help with UX research and design practice — for example usability testing, personas, journey maps, information architecture, onboarding, forms, accessibility, interviews, surveys, metrics, prioritisation, UX writing and design systems.\n\nTry asking: “How do I run a usability test?” or “How can I improve my onboarding?” You can also attach a document and ask questions about it.';
}

/** Run a Research Kit tool with the built-in engine. */
export function runLocal(req: ResearchRequest): ResearchResult {
  const docText = req.document?.text;
  if (req.document?.pdfBase64 && !docText) throw new Error('The built-in engine reads .txt, .md and .csv files. For PDFs, copy the text into a .txt file, or switch to Claude in Settings.');
  const seed = hash(JSON.stringify(req.inputs) + req.tool);
  const r = rng(seed);
  const inp = req.inputs ?? {};
  const need = (k: string, label: string) => { if (!clean(inp[k] ?? '') && !docText) throw new Error(`Please fill in "${label}"`); };
  switch (req.tool) {
    case 'persona': need('who', 'Who is this user?'); return { tool: req.tool, data: persona(r, inp) };
    case 'journey': need('scenario', 'Scenario / goal'); return { tool: req.tool, data: journey(r, inp) };
    case 'sitemap': need('product', 'Product'); return { tool: req.tool, data: sitemap(r, inp) };
    case 'hmw': need('problem', 'User problem or insight'); return { tool: req.tool, data: hmw(r, inp) };
    case 'affinity': need('notes', 'Notes, quotes or observations'); return { tool: req.tool, data: affinity(r, inp, docText) };
    case 'copy': need('screen', 'Screen or element'); return { tool: req.tool, data: copyGen(r, inp) };
    case 'summarize': need('content', 'Raw data, transcript or sticky notes'); return { tool: req.tool, data: summarize(r, inp, docText) };
    case 'interview': need('objective', 'Research objective'); return { tool: req.tool, data: interview(r, inp) };
    case 'brief': need('project', 'Project'); return { tool: req.tool, data: brief(r, inp) };
    case 'questionnaire': need('project', 'Project type'); return { tool: req.tool, data: questionnaire(r, inp) };
    case 'chat':
    case 'docchat': {
      const last = [...(req.messages ?? [])].reverse().find((m) => m.role === 'user');
      if (!last) throw new Error('Ask a question first');
      if (req.tool === 'docchat' && !docText) throw new Error(req.document?.pdfBase64 ? 'The built-in engine can’t read PDFs. Attach a .txt or .md file, or switch to Claude in Settings.' : 'Attach a document to chat with');
      return { tool: req.tool, text: chatAnswer(last.content, docText) };
    }
  }
}
