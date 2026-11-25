// E2E: two browsers collaborate on one file; an MCP client edits it and both see the result.
const { chromium } = require('playwright');
const BASE = process.env.FIGMY_URL || 'http://127.0.0.1:4318';
const mcp = async (method, params, id = 1) => {
  const r = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  return r.json();
};
const tool = async (name, args) => {
  const r = await mcp('tools/call', { name, arguments: args });
  if (r.result?.isError) throw new Error(r.result.content[0].text);
  return JSON.parse(r.result.content[0].text);
};
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const open = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((n) => localStorage.setItem('figmy:me', JSON.stringify({ name: n, color: n === 'Ana' ? '#f24822' : '#0fa958' })), name);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    p.on('console', (m) => m.type() === 'error' && errs.push(name + ' console: ' + m.text()));
    return p;
  };
  const file = await tool('create_file', { name: 'E2E collab' });
  const A = await open('Ana');
  const B = await open('Ben');
  await A.goto(`${BASE}/?room=${file.fileId}`);
  await B.goto(`${BASE}/?room=${file.fileId}`);
  await A.waitForFunction(() => document.querySelector('.live-dot.live'));
  await B.waitForFunction(() => document.querySelector('.live-dot.live'));
  await A.waitForFunction(() => document.querySelectorAll('.avatars .avatar').length >= 2, null, { timeout: 5000 });
  assert(true, 'both editors live and see each other');

  // A draws a rectangle -> B gets it
  await A.keyboard.press('r');
  await A.mouse.move(500, 300); await A.mouse.down(); await A.mouse.move(640, 400, { steps: 4 }); await A.mouse.up();
  await B.waitForFunction(() => Object.values(window.figmy.store.getState().doc.nodes).some((n) => n.type === 'rect'), null, { timeout: 5000 });
  assert(true, 'rectangle drawn by Ana appears for Ben');

  // B moves it -> A sees new position
  const rectId = await B.evaluate(() => Object.values(window.figmy.store.getState().doc.nodes).find((n) => n.type === 'rect').id);
  await B.evaluate((id) => window.figmy.store.getState().updateNodes([id], { x: 1000, name: 'Moved by Ben' }), rectId);
  await A.waitForFunction((id) => window.figmy.store.getState().doc.nodes[id]?.x === 1000, rectId, { timeout: 5000 });
  assert(true, 'Ben’s edit syncs back to Ana');

  // concurrent edits on different properties of different nodes converge
  await A.evaluate(() => { const s = window.figmy.store.getState(); for (let i = 0; i < 20; i++) s.addNode({ ...JSON.parse(JSON.stringify(Object.values(s.doc.nodes)[0])), id: 'a' + i, name: 'A' + i, x: i * 10, parentId: null, children: [] }); });
  await B.evaluate(() => { const s = window.figmy.store.getState(); for (let i = 0; i < 20; i++) s.addNode({ ...JSON.parse(JSON.stringify(Object.values(s.doc.nodes)[0])), id: 'b' + i, name: 'B' + i, y: i * 10, parentId: null, children: [] }); });
  await A.waitForTimeout(800);
  const snap = (p) => p.evaluate(() => { const d = window.figmy.store.getState().doc; return JSON.stringify({ n: Object.keys(d.nodes).sort(), p: d.pages.map((x) => x.children.slice().sort()) }); });
  const [sa, sb] = [await snap(A), await snap(B)];
  assert(sa === sb && JSON.parse(sa).n.length === 41, 'concurrent inserts converge (41 nodes on both)');

  // AI via MCP builds a screen; both editors receive it
  const created = await tool('create_nodes', {
    fileId: file.fileId,
    nodes: [{ type: 'frame', name: 'AI Login', x: 0, y: 600, width: 390, height: 600, fill: '#ffffff', radius: 24,
      autoLayout: { direction: 'vertical', gap: 16, padding: 32, align: 'center' },
      children: [
        { type: 'text', text: 'Welcome back', fontSize: 28, fontWeight: 700, color: '#111111' },
        { type: 'rect', name: 'Email field', width: 326, height: 48, radius: 10, fill: '#f2f2f7' },
        { type: 'rect', name: 'Password field', width: 326, height: 48, radius: 10, fill: '#f2f2f7' },
        { type: 'frame', name: 'Button', width: 326, height: 52, radius: 12, fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#5b5bf7' }, { offset: 1, color: '#b44cf0' }] },
          autoLayout: { direction: 'horizontal', align: 'center', justify: 'center', padding: 14 }, children: [{ type: 'text', text: 'Sign in', color: '#fff', fontWeight: 600 }] },
      ] }],
  });
  const frameId = created.created[0].id;
  await A.waitForFunction((id) => !!window.figmy.store.getState().doc.nodes[id], frameId, { timeout: 5000 });
  await B.waitForFunction((id) => window.figmy.store.getState().doc.nodes[id]?.children.length === 4, frameId, { timeout: 5000 });
  assert(true, 'MCP create_nodes appears live in both editors');
  const kids = await A.evaluate((id) => { const d = window.figmy.store.getState().doc; return d.nodes[id].children.map((c) => [d.nodes[c].name, Math.round(d.nodes[c].y - d.nodes[id].y)]); }, frameId);
  assert(kids[1][1] > kids[0][1] && kids[2][1] > kids[1][1], 'auto layout stacked AI children vertically: ' + JSON.stringify(kids));

  // AI sees the user's selection
  await A.evaluate((id) => window.figmy.store.getState().select([id]), frameId);
  await A.waitForTimeout(300);
  const sel = await tool('get_selection', { fileId: file.fileId });
  assert(sel.users.some((u) => u.name === 'Ana' && u.selection[0]?.id === frameId), 'get_selection reports Ana’s selection');

  // AI updates + variables + boolean + interaction + export
  await tool('update_nodes', { fileId: file.fileId, updates: [{ id: frameId, fill: '#fafafa', name: 'Login' }] });
  await B.waitForFunction((id) => window.figmy.store.getState().doc.nodes[id]?.name === 'Login', frameId);
  assert(true, 'update_nodes syncs');
  await tool('set_variables', { fileId: file.fileId, collection: 'Theme', modes: ['Light', 'Dark'], variables: [{ name: 'surface', type: 'color', values: { Light: '#ffffff', Dark: '#1c1c1e' } }] });
  await tool('bind_variable', { fileId: file.fileId, nodeIds: [frameId], property: 'fill', variable: 'Theme/surface' });
  await tool('set_variable_mode', { fileId: file.fileId, collection: 'Theme', mode: 'Dark' });
  await A.waitForFunction((id) => window.figmy.store.getState().doc.nodes[id]?.fills[0]?.color === '#1c1c1e', frameId, { timeout: 5000 });
  assert(true, 'variable binding + dark mode applied live');
  const shapes = await tool('create_nodes', { fileId: file.fileId, nodes: [{ type: 'rect', x: 600, y: 600, width: 80, height: 80, fill: '#ff6b6b' }, { type: 'ellipse', x: 640, y: 640, width: 80, height: 80 }] });
  const boolRes = await tool('boolean_operation', { fileId: file.fileId, ids: shapes.created.map((c) => c.id), operation: 'subtract' });
  await B.waitForFunction((id) => window.figmy.store.getState().doc.nodes[id]?.rings?.length > 0, boolRes.id, { timeout: 5000 });
  assert(true, 'boolean subtract via MCP');
  const home = await tool('create_nodes', { fileId: file.fileId, nodes: [{ type: 'frame', name: 'Home', width: 390, height: 600, fill: '#eef' }] });
  const btn = kids.find(() => true) && (await A.evaluate((id) => { const d = window.figmy.store.getState().doc; return d.nodes[id].children.find((c) => d.nodes[c].name === 'Button'); }, frameId));
  await tool('add_interaction', { fileId: file.fileId, fromId: btn, targetId: home.created[0].id, animation: 'smart-animate', easing: 'gentle', duration: 500 });
  const html = await tool('export_html', { fileId: file.fileId, frameIds: [frameId] });
  assert(html.html.includes('Welcome back') && html.html.includes('data-links') && (html.html.match(/<section /g) || []).length === 2, 'export_html includes text, prototype link and destination screen');

  // undo on A must not revert AI/Ben changes
  const before = await A.evaluate(() => Object.keys(window.figmy.store.getState().doc.nodes).length);
  await A.evaluate(() => window.figmy.store.getState().undo());
  await A.waitForTimeout(300);
  const after = await A.evaluate((id) => ({ n: Object.keys(window.figmy.store.getState().doc.nodes).length, login: !!window.figmy.store.getState().doc.nodes[id] }), frameId);
  assert(after.login, `local undo keeps the AI-created screen (${before} → ${after.n} nodes)`);
  await A.waitForTimeout(500);
  assert((await snap(A)) === (await snap(B)), 'editors converged after undo');

  await A.screenshot({ path: process.env.SHOT || '/tmp/collab.png' });
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  if (errs.length) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
