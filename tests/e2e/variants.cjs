// E2E: component variants, instance properties and interactive components (editor, presenter, HTML export).
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
      /* sandboxed frame */
    }
  });
  await p.goto(BASE);
  await p.click('text=New design file');
  await p.waitForTimeout(200);

  // Build two switch states as components (Off / On), then combine them through the UI menu.
  const ids = await p.evaluate(() => {
    const s = () => window.figmy.store.getState();
    const mk = (name, x, color, knobX) => {
      const comp = { id: 'c' + name, type: 'component', name, parentId: null, children: [], x, y: 0, w: 120, h: 60, rotation: 0, opacity: 1, blend: 'normal', visible: true, locked: false, fills: [{ id: 'f' + name, kind: 'solid', color, opacity: 1, visible: true }], strokes: [], effects: [], radius: 30, clip: true };
      s().addNode(comp);
      const knob = { id: 'k' + name, type: 'ellipse', name: 'Knob', parentId: null, children: [], x: x + knobX, y: 6, w: 48, h: 48, rotation: 0, opacity: 1, blend: 'normal', visible: true, locked: false, fills: [{ id: 'kf' + name, kind: 'solid', color: '#ffffff', opacity: 1, visible: true }], strokes: [], effects: [], radius: 0 };
      s().addNode(knob, comp.id);
      return comp.id;
    };
    return [mk('Off', 0, '#cccccc', 6), mk('On', 300, '#22c55e', 66)];
  });
  await p.evaluate((ids) => window.figmy.store.getState().select(ids), ids);
  await p.keyboard.press('Control+Alt+Shift+K');
  const setId = await p.evaluate(() => window.figmy.store.getState().selection[0]);
  assert(await p.evaluate((id) => window.figmy.store.getState().doc.nodes[id].isComponentSet, setId), 'Combine as variants creates a component set');
  assert(await p.isVisible('text=Component set'), 'component set panel shown');

  // Interactions: click on Off → change to On (smart animate), click on On → Off; place an instance in a screen.
  await p.evaluate(([off, on]) => {
    const s = () => window.figmy.store.getState();
    s().updateNodes([off], { prototype: [{ trigger: 'click', action: 'change-to', targetId: on, animation: 'smart-animate', easing: 'ease-out', duration: 250 }] });
    s().updateNodes([on], { prototype: [{ trigger: 'click', action: 'change-to', targetId: off, animation: 'smart-animate', easing: 'ease-out', duration: 250 }] });
    const screen = { id: 'screen', type: 'frame', name: 'Settings', parentId: null, children: [], x: 0, y: 300, w: 400, h: 300, rotation: 0, opacity: 1, blend: 'normal', visible: true, locked: false, fills: [{ id: 'sf', kind: 'solid', color: '#ffffff', opacity: 1, visible: true }], strokes: [], effects: [], radius: 0, clip: true };
    s().addNode(screen);
    s().createInstance(off, 0, 0);
    const inst = s().selection[0];
    s().reparent([inst], 'screen');
    s().updateNodes([inst], { x: 40, y: 340 });
    s().mutate((d) => { d.pages[0].startFrameId = 'screen'; });
    s().select([inst]);
  }, ids);

  // Instance panel: switch variant via the dropdown, then back
  await p.waitForSelector('text=Instance');
  await p.selectOption('.panel.right select >> nth=0', 'On');
  const instId = await p.evaluate(() => window.figmy.store.getState().selection[0]);
  assert((await p.evaluate((id) => window.figmy.store.getState().doc.nodes[id].componentId, instId)) === ids[1], 'instance variant dropdown swaps to On');
  await p.selectOption('.panel.right select >> nth=0', 'Off');
  assert((await p.evaluate((id) => window.figmy.store.getState().doc.nodes[id].componentId, instId)) === ids[0], 'and back to Off');

  // Presenter: clicking the instance toggles its variant (interactive component)
  await p.evaluate(() => window.figmy.store.getState().set({ selection: [] }));
  await p.keyboard.press('Control+Alt+Enter');
  await p.waitForSelector('.present-stage');
  const bb = await (await p.$('.present-stage')).boundingBox();
  const k = bb.width / 400;
  const knobX = () =>
    p.evaluate(() => {
      const circles = [...document.querySelectorAll('.present-stage ellipse')];
      const c = circles.find((e) => e.getAttribute('fill') === '#ffffff');
      return c ? c.getBoundingClientRect().x : null;
    });
  const before = await knobX();
  await p.mouse.click(bb.x + 100 * k, bb.y + 70 * k);
  await p.waitForTimeout(120);
  const mid = await knobX();
  await p.waitForTimeout(400);
  const after = await knobX();
  assert(after > before + 30 * k, `click changes Off → On (knob moved ${Math.round(before)} → ${Math.round(after)})`);
  assert(mid > before && mid < after, 'smart animate interpolates the knob mid-transition');
  await p.mouse.click(bb.x + 100 * k, bb.y + 70 * k);
  await p.waitForTimeout(450);
  assert(Math.abs((await knobX()) - before) < 2, 'second click changes back to Off');

  // Hover interaction: "while hovering" variant change reverts on leave
  await p.keyboard.press('Escape');
  await p.evaluate(([off, on]) => {
    const s = window.figmy.store.getState();
    s.updateNodes([off], { prototype: [{ trigger: 'hover', action: 'change-to', targetId: on, animation: 'instant', duration: 0 }] });
    s.updateNodes([on], { prototype: [] });
  }, ids);
  await p.keyboard.press('Control+Alt+Enter');
  await p.waitForSelector('.present-stage');
  const base = await knobX();
  await p.mouse.move(bb.x + 100 * k, bb.y + 70 * k);
  await p.waitForTimeout(150);
  const hovered = await knobX();
  await p.mouse.move(bb.x + 380 * k, bb.y + 280 * k);
  await p.waitForTimeout(150);
  const left = await knobX();
  assert(hovered > base + 30 * k && Math.abs(left - base) < 2, 'while hovering switches to On and reverts on leave');
  await p.keyboard.press('Escape');

  // HTML export: clicking the instance switches variants in the exported page
  await p.evaluate(([off, on]) => {
    const s = window.figmy.store.getState();
    s.updateNodes([off], { prototype: [{ trigger: 'click', action: 'change-to', targetId: on, animation: 'dissolve', duration: 100 }] });
    s.updateNodes([on], { prototype: [{ trigger: 'click', action: 'change-to', targetId: off, animation: 'dissolve', duration: 100 }] });
  }, ids);
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('figmy:export', { detail: { format: 'html' } })));
  await p.waitForSelector('.export-preview iframe');
  await p.selectOption('.export-options select >> nth=0', 'frames');
  const frame = p.frameLocator('.export-preview iframe');
  const onClass = async () => frame.locator('[data-instance] > .vx-on').getAttribute('data-variant');
  const v0 = await onClass();
  await frame.locator('[data-instance]').click();
  await p.waitForTimeout(250);
  const v1 = await onClass();
  assert(v0 === `v-${ids[0]}` && v1 === `v-${ids[1]}`, `exported HTML switches variant on click (${v0} → ${v1})`);

  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
