// UI smoke test: drawing tools, booleans, variables, prototype presenter, export dialog, AI connector panel.
const { chromium } = require('playwright');
const BASE = process.env.VECTURA_URL || 'http://127.0.0.1:4390';
const assert = (c, m) => {
  if (!c) {
    console.error('FAIL:', m);
    process.exitCode = 1;
  } else console.log('ok -', m);
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/WebSocket/.test(m.text()) && errs.push(m.text()));
  await p.addInitScript(() => {
    try {
      localStorage.setItem('vectura:autolive', 'off');
    } catch {
      /* sandboxed frames (export preview) have no storage */
    }
  });
  await p.goto(BASE);
  await p.click('text=Sample file');
  await p.waitForTimeout(300);
  const count = () => p.evaluate(() => Object.keys(window.vectura.store.getState().doc.nodes).length);

  const n0 = await count();
  for (const [key, x] of [['r', 900], ['o', 1000]]) {
    await p.keyboard.press(key);
    await p.mouse.move(x, 300);
    await p.mouse.down();
    await p.mouse.move(x + 90, 380, { steps: 4 });
    await p.mouse.up();
  }
  assert((await count()) === n0 + 2, 'rectangle + ellipse drawn');

  await p.keyboard.press('t');
  await p.mouse.click(900, 620);
  await p.waitForTimeout(80);
  await p.keyboard.type('Hello');
  await p.keyboard.press('Escape');
  assert(await p.evaluate(() => Object.values(window.vectura.store.getState().doc.nodes).some((n) => n.text?.content === 'Hello')), 'text typed');

  await p.keyboard.press('p');
  for (const [x, y] of [[1060, 450], [1130, 520], [1060, 590], [1060, 450]]) await p.mouse.click(x, y);
  assert(await p.evaluate(() => Object.values(window.vectura.store.getState().doc.nodes).some((n) => n.type === 'path' && n.closed)), 'pen path closed');

  // boolean via the design panel button
  await p.evaluate(() => {
    const s = window.vectura.store.getState();
    const ids = Object.values(s.doc.nodes)
      .filter((n) => !n.parentId && ((n.type === 'rect' && n.name === 'Rectangle') || (n.type === 'ellipse' && n.name === 'Ellipse')))
      .map((n) => n.id);
    s.select(ids.slice(-2));
  });
  await p.click('button[title^="Subtract"]');
  assert(await p.evaluate(() => { const s = window.vectura.store.getState(); return s.doc.nodes[s.selection[0]]?.name === 'Subtract'; }), 'subtract button creates boolean result');
  await p.keyboard.press('Control+z');
  assert(await p.evaluate(() => !Object.values(window.vectura.store.getState().doc.nodes).some((n) => n.name === 'Subtract')), 'undo restores shapes');

  // variables editor
  await p.evaluate(() => window.dispatchEvent(new Event('vectura:variables')));
  await p.click('text=+ Collection');
  await p.click('text=+ Color');
  await p.click('.variables-modal button[title="Add mode"]');
  assert(await p.evaluate(() => { const v = window.vectura.store.getState().doc.variables[0]; return v.variables.length === 1 && v.modes.length === 2; }), 'variables editor creates collection, variable and mode');
  await p.click('.variables-modal >> text=Close');

  // prototype overlay in the presenter
  await p.evaluate(() => {
    const st = () => window.vectura.store.getState();
    const frame = st().page().children.find((id) => st().doc.nodes[id].type === 'frame');
    st().select([frame]);
    st().duplicate(0);
    const copy = st().selection[0];
    st().moveBy([copy], 500, 0);
    st().rename(copy, 'Details');
    st().updateNodes([copy], { h: 260 }); // a bottom sheet smaller than the screen
    const card = st().doc.nodes[frame].children.map((c) => st().doc.nodes[c]).find((n) => n.name === 'Card 1');
    st().updateNodes([card.id], { prototype: [{ trigger: 'click', action: 'overlay', targetId: copy, animation: 'move-in', direction: 'up', easing: 'ease-out', duration: 200, overlay: { position: 'bottom', closeOnOutside: true, background: 'rgba(0,0,0,.4)' } }] });
    st().set({ selection: [] });
  });
  await p.keyboard.press('Control+Alt+Enter');
  await p.waitForSelector('.present-stage');
  const bb = await (await p.$('.present-stage')).boundingBox();
  const k = bb.height / 720;
  await p.mouse.click(bb.x + 200 * k, bb.y + 300 * k);
  await p.waitForTimeout(400);
  assert((await p.$$('.present-overlay')).length === 1, 'overlay opens from prototype click');
  await p.mouse.click(bb.x + 5, bb.y + 5);
  await p.waitForTimeout(400);
  assert((await p.$$('.present-overlay')).length === 0, 'overlay closes on outside click');
  await p.keyboard.press('Escape');

  // export dialog
  await p.keyboard.press('Control+Shift+e');
  await p.waitForSelector('.export-preview iframe');
  const srcdoc = await p.evaluate(() => document.querySelector('.export-preview iframe').getAttribute('srcdoc'));
  assert(srcdoc.includes('Good morning') && srcdoc.includes('vx-stage'), 'HTML export preview renders design');
  await p.click('.seg >> text=SVG');
  assert(!!(await p.waitForSelector('.img-preview svg')), 'SVG preview');

  // share dialog / AI connector panel
  await p.click('.export-modal >> text=Close');
  await p.click('.share-btn');
  await p.click('text=Connect AI (MCP)');
  assert(await p.isVisible('text=MCP server URL'), 'AI connector instructions shown');

  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
