import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/store';
import { actions } from '../actions';
import { Icon, type IconName } from './icons';
import type { Mode, Tool } from '../types';
import { CollabBar } from '../collab/CollabUI';
import { AccountBadge } from '../auth/LoginUI';
import { DrawBar, DrawToolButtons, PathEditBar } from './DrawTools';

const MENU: { title: string; items: (string | '-')[] }[] = [
  { title: 'File', items: ['home', 'new', 'open', 'save', 'saveAs', 'newFromTemplate', '-', 'importFiles', 'figmaImport', 'export', 'exportHtml', 'exportSelection', 'exportSvg', 'exportPdf', '-', 'saveVersion'] },
  { title: 'Edit', items: ['undo', 'redo', '-', 'copy', 'cut', 'paste', 'duplicate', 'delete', '-', 'selectAll'] },
  { title: 'View', items: ['zoomIn', 'zoomOut', 'zoom100', 'zoomFit', 'zoomSel', '-', 'toggleGrid', 'toggleRulers', 'toggleOutlines', 'toggleUI', '-', 'variables'] },
  { title: 'Object', items: ['group', 'ungroup', 'frameSelection', 'autoLayout', '-', 'component', 'combineVariants', 'addVariant', 'detach', 'mask', '-', 'union', 'subtract', 'intersect', 'exclude', 'flatten', '-', 'bringFront', 'bringForward', 'sendBackward', 'sendBack', '-', 'flipH', 'flipV', 'toggleVisible', 'toggleLock'] },
  { title: 'Arrange', items: ['alignLeft', 'alignHCenter', 'alignRight', 'alignTop', 'alignVCenter', 'alignBottom', '-', 'distributeH', 'distributeV', 'tidy'] },
  { title: 'Share', items: ['share', 'connectAI'] },
  { title: 'Plugins', items: ['researchKit'] },
  { title: 'Help', items: ['shortcuts'] },
];

const TOOLS: { group: { tool: Tool; icon: IconName; label: string; key: string }[] }[] = [
  { group: [{ tool: 'move', icon: 'move', label: 'Move', key: 'V' }, { tool: 'hand', icon: 'hand', label: 'Hand', key: 'H' }] },
  { group: [{ tool: 'frame', icon: 'frame', label: 'Frame', key: 'F' }, { tool: 'section', icon: 'section', label: 'Section', key: 'S' }] },
  {
    group: [
      { tool: 'rect', icon: 'rect', label: 'Rectangle', key: 'R' },
      { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
      { tool: 'line', icon: 'line', label: 'Line', key: 'L' },
      { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'Shift+L' },
      { tool: 'polygon', icon: 'polygon', label: 'Polygon', key: '' },
      { tool: 'star', icon: 'star', label: 'Star', key: '' },
      { tool: 'image', icon: 'image', label: 'Place image', key: 'Ctrl+Shift+K' },
    ],
  },
  { group: [{ tool: 'pen', icon: 'pen', label: 'Pen', key: 'P' }, { tool: 'pencil', icon: 'pencil', label: 'Pencil', key: 'Shift+P' }, { tool: 'brush', icon: 'brush', label: 'Brush', key: 'B' }] },
  { group: [{ tool: 'text', icon: 'text', label: 'Text', key: 'T' }, { tool: 'text-path', icon: 'textPath', label: 'Text on path', key: '' }] },
  { group: [{ tool: 'comment', icon: 'comment', label: 'Comment', key: 'C' }] },
];

export function Toolbar({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  const st = useEditor();
  const [menu, setMenu] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  return (
    <div className="toolbar" ref={ref}>
      <div className="tb-left">
        <button className="logo" title="Main menu" onClick={() => setMenu(menu ? null : 'File')}>
          <img src="./icon.svg" width={22} height={22} alt="" />
          <Icon name="chevronDown" size={12} />
        </button>
        {menu && (
          <div className="menubar-pop">
            <div className="menu-tabs">
              {MENU.map((m) => (
                <button key={m.title} className={menu === m.title ? 'active' : ''} onMouseEnter={() => setMenu(m.title)} onClick={() => setMenu(m.title)}>
                  {m.title}
                </button>
              ))}
            </div>
            <div className="menu-list">
              {MENU.find((m) => m.title === menu)!.items.map((id, i) =>
                id === '-' ? (
                  <hr key={i} />
                ) : (
                  <button
                    key={id}
                    onClick={() => {
                      setMenu(null);
                      actions[id].run();
                    }}
                  >
                    <span>{actions[id].label}</span>
                    <kbd>{actions[id].shortcut}</kbd>
                  </button>
                ),
              )}
            </div>
          </div>
        )}
        <div className="tb-sep" />
        <button className="tool" title="Undo (Ctrl+Z)" onClick={st.undo} disabled={!st.past.length}>
          <Icon name="undo" />
        </button>
        <button className="tool" title="Redo (Ctrl+Shift+Z)" onClick={st.redo} disabled={!st.future.length}>
          <Icon name="redo" />
        </button>
      </div>

      <div className="tb-center">
        <input
          className="doc-name"
          value={st.doc.name}
          onChange={(e) => st.mutate((d) => (d.name = e.target.value), false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          title="Rename file"
        />
        {st.dirty && <span className="dirty-dot" title="Unsaved changes" />}
      </div>

      <div className="tb-right">
        <div className="mode-switch" role="tablist">
          {(['design', 'prototype', 'motion', 'dev'] as const).map((m) => (
            <button key={m} className={st.mode === m ? 'active' : ''} onClick={() => st.set({ mode: m, tool: 'move', motionPlaying: false })}>
              {m === 'dev' ? <><Icon name="code" size={13} /> Dev</> : m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <button className="tool" title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button className="tool" title="Present (Ctrl+Alt+Enter)" onClick={() => st.set({ presenting: true })}>
          <Icon name="play" />
        </button>
        <CollabBar />
        <AccountBadge compact />
        <button className="tool" onClick={() => actions.save.run()} title="Save (Ctrl+S)">
          <Icon name="download" />
        </button>
        <ZoomMenu />
      </div>
    </div>
  );
}

function ZoomMenu() {
  const st = useEditor();
  const [open, setOpen] = useState(false);
  return (
    <div className="zoom-menu">
      <button className="zoom-btn" onClick={() => setOpen(!open)}>
        {Math.round(st.zoom * 100)}% <Icon name="chevronDown" size={10} />
      </button>
      {open && (
        <div className="flyout right" onMouseLeave={() => setOpen(false)}>
          {['zoomIn', 'zoomOut', 'zoomFit', 'zoomSel', 'zoom100'].map((id) => (
            <button
              key={id}
              onClick={() => {
                actions[id].run();
                setOpen(false);
              }}
            >
              <span>{actions[id].label}</span>
              <kbd>{actions[id].shortcut}</kbd>
            </button>
          ))}
          <hr />
          {[0.25, 0.5, 2, 4].map((z) => (
            <button key={z} onClick={() => { st.zoomTo(z); setOpen(false); }}>
              <span>{z * 100}%</span>
            </button>
          ))}
          <hr />
          {['toggleRulers', 'toggleGrid', 'toggleOutlines'].map((id) => (
            <button key={id} onClick={() => actions[id].run()}>
              <span>{actions[id].label}</span>
              <kbd>{actions[id].shortcut}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Floating tool dock at the bottom of the canvas. */
export function ToolDock() {
  const st = useEditor();
  const [flyout, setFlyout] = useState<number | null>(null);
  const [lastInGroup, setLastInGroup] = useState<Record<number, Tool>>({});
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setFlyout(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  const modes: { mode: Mode; icon: IconName; label: string; key: string }[] = [
    { mode: 'draw', icon: 'drawMode', label: 'Draw', key: 'Shift+B' },
    { mode: 'design', icon: 'designMode', label: 'Design', key: 'Shift+W' },
    { mode: 'prototype', icon: 'link', label: 'Prototype', key: 'Shift+E' },
    { mode: 'motion', icon: 'motion', label: 'Motion — keyframe animation', key: 'Shift+M' },
    { mode: 'dev', icon: 'code', label: 'Dev mode', key: 'Shift+D' },
  ];
  const setMode = (mode: Mode) => st.set({ mode, tool: 'move', motionPlaying: false, editingPathId: null });
  return (
    <>
    <DrawBar />
    <PathEditBar />
    <div className={`tool-dock ${st.mode === 'draw' ? 'draw' : ''}`} ref={ref} onPointerDown={(e) => e.stopPropagation()}>
        {st.mode !== 'dev' && TOOLS.map((g, gi) => {
            if (st.mode === 'draw' && g.group.some((t) => t.tool === 'pen')) return <DrawToolButtons key={gi} />;
            const current = g.group.find((t) => t.tool === st.tool) ?? g.group.find((t) => t.tool === lastInGroup[gi]) ?? g.group[0];
            const active = g.group.some((t) => t.tool === st.tool);
            return (
              <div key={gi} className="tool-group">
                <button className={`tool ${active ? 'active' : ''}`} title={`${current.label}${current.key ? ` (${current.key})` : ''}`} onClick={() => st.set({ tool: current.tool, editingPathId: null })}>
                  <Icon name={current.icon} />
                </button>
                {g.group.length > 1 && (
                  <button className={`tool-caret ${active ? 'active' : ''}`} title="More tools" onClick={() => setFlyout(flyout === gi ? null : gi)}>
                    <Icon name="chevronDown" size={10} />
                  </button>
                )}
                {flyout === gi && (
                  <div className="flyout up">
                    {g.group.map((t) => (
                      <button
                        key={t.tool}
                        className={st.tool === t.tool ? 'active' : ''}
                        onClick={() => {
                          st.set({ tool: t.tool });
                          setLastInGroup({ ...lastInGroup, [gi]: t.tool });
                          setFlyout(null);
                        }}
                      >
                        <Icon name={t.icon} /> <span>{t.label}</span> <kbd>{t.key}</kbd>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      {st.mode !== 'dev' && (
        <button className="tool" title="Research Kit — AI personas, journeys, sitemaps (Shift+I)" onClick={() => window.dispatchEvent(new CustomEvent('figmy:research'))}>
          <span className="rk-dock">✦</span>
        </button>
      )}
      {st.mode !== 'dev' && (
        <button className="tool" title="Quick actions (Ctrl+K)" onClick={() => window.dispatchEvent(new Event('figmy:palette'))}>
          <Icon name="search" />
        </button>
      )}
      <div className="dock-modes" role="tablist" aria-label="Mode">
        {modes.map((m) => (
          <button key={m.mode} role="tab" aria-selected={st.mode === m.mode} className={`mode-btn ${st.mode === m.mode ? 'on' : ''}`} title={`${m.label} (${m.key})`} onClick={() => setMode(m.mode)}>
            <Icon name={m.icon} />
          </button>
        ))}
      </div>
    </div>
    </>
  );
}
