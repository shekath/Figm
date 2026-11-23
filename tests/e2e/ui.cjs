// UI smoke test: drawing tools, booleans, variables, prototype presenter, export dialog, AI connector panel.
const { chromium } = require('playwright');
const BASE = process.env.FIGMY_URL || 'http://127.0.0.1:4390';
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
      localStorage.setItem('figmy:autolive', 'off');
    } catch {
      /* sandboxed frames (export preview) have no storage */
    }
  });
  await p.goto(BASE);
  await p.click('text=Sample file');
  await p.waitForTimeout(300);
  const count = () => p.evaluate(() => Object.keys(window.figmy.store.getState().doc.nodes).length);

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
  assert(await p.evaluate(() => Object.values(window.figmy.store.getState().doc.nodes).some((n) => n.text?.content === 'Hello')), 'text typed');

  await p.keyboard.press('p');
  for (const [x, y] of [[1060, 450], [1130, 520], [1060, 590], [1060, 450]]) await p.mouse.click(x, y);
  assert(await p.evaluate(() => Object.values(window.figmy.store.getState().doc.nodes).some((n) => n.type === 'path' && n.closed)), 'pen path closed');

  // boolean via the design panel button
  await p.evaluate(() => {
    const s = window.figmy.store.getState();
    const ids = Object.values(s.doc.nodes)
      .filter((n) => !n.parentId && ((n.type === 'rect' && n.name === 'Rectangle') || (n.type === 'ellipse' && n.name === 'Ellipse')))
      .map((n) => n.id);
    s.select(ids.slice(-2));
  });
  await p.click('button[title^="Subtract"]');
  assert(await p.evaluate(() => { const s = window.figmy.store.getState(); return s.doc.nodes[s.selection[0]]?.name === 'Subtract'; }), 'subtract button creates boolean result');
  await p.keyboard.press('Control+z');
  assert(await p.evaluate(() => !Object.values(window.figmy.store.getState().doc.nodes).some((n) => n.name === 'Subtract')), 'undo restores shapes');

  // variables editor
  await p.evaluate(() => window.dispatchEvent(new Event('figmy:variables')));
  await p.click('.vx >> text=Create collection');
  await p.click('.vx-createbtn');
  await p.click('.vx-menu >> text=Color');
  await p.click('.vx button[title="Add mode"]');
  assert(await p.evaluate(() => { const v = window.figmy.store.getState().doc.variables[0]; return v.variables.length === 1 && v.modes.length === 2; }), 'variables editor creates collection, variable and mode');
  await p.click('.vx-createbtn');
  await p.click('.vx-menu >> text=Color');
  await p.hover('.vx-row >> nth=1');
  await p.click('.vx-row >> nth=1 >> .vx-link >> nth=0');
  await p.click('.vx-aliaslist button >> nth=0');
  assert(await p.evaluate(() => { const v = window.figmy.store.getState().doc.variables[0].variables[1]; return typeof Object.values(v.values)[0] === 'object'; }), 'variables editor links a variable to another (alias)');
  await p.click('.vx button[title="Close (Esc)"]');

  // colour picker: a drag in the colour square sticks after release; gradient stops take their own colours
  await p.evaluate(() => { const s = window.figmy.store.getState(); const id = Object.values(s.doc.nodes).find((n) => (n.type === 'rect' || n.type === 'ellipse') && n.fills[0]?.kind === 'solid').id; s.select([id]); s.set({ mode: 'design' }); });
  await p.click('.paint .swatch');
  const sv = await p.locator('.cp-sv').boundingBox();
  await p.mouse.move(sv.x + sv.width * 0.8, sv.y + sv.height * 0.2);
  await p.mouse.down();
  await p.mouse.move(sv.x + sv.width * 0.9, sv.y + sv.height * 0.1, { steps: 3 });
  await p.mouse.up();
  const picked = await p.evaluate(() => { const s = window.figmy.store.getState(); return s.doc.nodes[s.selection[0]].fills[0].color; });
  assert(/^#[0-9a-f]{6}$/.test(picked) && parseInt(picked.slice(1, 3), 16) > 150 && parseInt(picked.slice(5, 7), 16) < 120, `picked colour is kept after releasing the drag (${picked})`);
  await p.click('.cp-kinds button[title="Linear"]');
  await p.click('.cp-stop >> nth=1');
  const sv2 = await p.locator('.cp-sv').boundingBox();
  await p.mouse.click(sv2.x + sv2.width - 2, sv2.y + sv2.height - 2);
  const stops = await p.evaluate(() => { const s = window.figmy.store.getState(); return s.doc.nodes[s.selection[0]].fills[0].stops.map((x) => x.color); });
  assert(stops.length === 2 && stops[0] !== stops[1] && parseInt(stops[1].slice(1, 3), 16) < 16 && parseInt(stops[0].slice(1, 3), 16) > 150, `gradient stop colours are independent (${stops.join(', ')})`);
  await p.keyboard.press('Escape');

  // draw mode: brush stroke becomes a filled shape; sizing menu adds a min width
  await p.click('.mode-btn[title^="Draw"]');
  await p.click('.draw-tool[title^="Brush"]');
  await p.mouse.move(420, 520); await p.mouse.down();
  for (let i = 0; i <= 12; i++) await p.mouse.move(420 + i * 10, 520 + Math.sin(i / 2) * 20);
  await p.mouse.up();
  assert(await p.evaluate(() => { const s = window.figmy.store.getState(); const n = s.doc.nodes[s.selection[0]]; return n?.name === 'Brush' && n.closed && n.fillRule === 'nonzero' && n.fills.length === 1; }), 'brush stroke creates a filled shape');
  await p.keyboard.press('Escape');
  await p.click('.mode-btn[title^="Design"]');
  await p.click('.size-field .size-mode >> nth=0');
  await p.click('.sizing-menu >> text=Add min width');
  assert(await p.evaluate(() => { const s = window.figmy.store.getState(); return s.doc.nodes[s.selection[0]].minW > 0; }), 'sizing menu adds a min width');

  // motion mode: drag at the playhead records a position keyframe; presets add tracks
  await p.evaluate(() => { const s = window.figmy.store.getState(); const id = Object.values(s.doc.nodes).find((n) => n.type === 'rect' || n.type === 'ellipse')?.id; s.select([id]); });
  await p.click('.mode-btn[title^="Motion"]');
  assert(await p.isVisible('.timeline'), 'motion mode shows the timeline');
  await p.evaluate(() => window.figmy.store.getState().set({ motionTime: 800 }));
  await p.evaluate(() => { const s = window.figmy.store.getState(); s.setKeyframe(s.selection, 'opacity', 0.3); });
  await p.click('.section button[title="Add an animation preset"]');
  await p.click('.mp-presets >> text=Spin');
  assert(await p.evaluate(() => { const s = window.figmy.store.getState(); const t = s.doc.nodes[s.selection[0]].motion.tracks; return t.opacity.length === 2 && t.rotation.length === 2; }), 'keyframes and presets create animation tracks');
  assert(await p.isVisible('.tl-key'), 'timeline shows keyframes');
  await p.click('.mode-btn[title^="Design"]');

  // prototype overlay in the presenter
  await p.evaluate(() => {
    const st = () => window.figmy.store.getState();
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
