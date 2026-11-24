import { useEffect, useState } from 'react';
import { useEditor } from './store/store';
import { Canvas } from './canvas/Canvas';
import { Toolbar, ToolDock } from './panels/Toolbar';
import { ContextBar, CommandPalette } from './panels/QuickUI';
import { LeftPanel } from './panels/LeftPanel';
import { RightPanel } from './panels/RightPanel';
import { Timeline } from './panels/Timeline';
import { ResearchKit } from './panels/ResearchKit';
import { Presenter } from './Presenter';
import { ContextMenu, ShortcutsDialog, Toast } from './Overlays';
import { Home } from './Home';
import { VariablesModal } from './panels/Variables';
import { FigmaImportDialog } from './panels/FigmaImport';
import { ExportDialog } from './panels/ExportDialog';
import { ShareDialog } from './collab/CollabUI';
import { goLive, leaveLive } from './collab/client';
import { serverBase } from './collab/config';
import { initAuth, useAuth } from './auth/auth';
import { LoginScreen } from './auth/LoginUI';
import { useCollab } from './collab/client';
import { useShortcuts } from './useShortcuts';
import { actions, saveToLibrary } from './actions';
import { desktop, parseDocument } from './lib/platform';

/** Escape closes the topmost dialog (as clicking its dimmed background would), before any canvas shortcut runs. */
function useEscapeClosesDialogs() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.cp, .vx-menu, .sizing-menu, .palette')) return;
      const backs = document.querySelectorAll<HTMLElement>('.modal-backdrop');
      const top = backs[backs.length - 1];
      if (!top) return;
      e.stopPropagation();
      e.preventDefault();
      const close = top.querySelector<HTMLElement>('header button.btn, header .icon-btn[title^="Close"], button[title^="Close"]');
      if (close && /close|done/i.test(close.textContent + ' ' + (close.title ?? ''))) close.click();
      else top.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

export function App() {
  useEscapeClosesDialogs();
  const [view, setView] = useState<'home' | 'editor'>('home');
  const [theme, setThemeState] = useState(() => {
    try {
      return localStorage.getItem('figmy:theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    } catch {
      return 'light';
    }
  });
  const setTheme = (t: string) => {
    setThemeState(t);
    try {
      localStorage.setItem('figmy:theme', t);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const presenting = useEditor((s) => s.presenting);
  const mode = useEditor((s) => s.mode);
  const name = useEditor((s) => s.doc.name);
  const dirty = useEditor((s) => s.dirty);
  const authMode = useAuth((s) => s.mode);
  const authRequired = useAuth((s) => s.required);
  const account = useAuth((s) => s.user);
  const gated = authRequired && !account;
  useShortcuts(view === 'editor' && !gated);

  useEffect(() => {
    initAuth();
  }, []);
  // collaborators see your Google name
  useEffect(() => {
    if (account) useCollab.getState().setMe({ name: account.name });
  }, [account]);

  // home navigation
  useEffect(() => {
    const h = () => setView('home');
    const e = () => setView('editor');
    window.addEventListener('figmy:home', h);
    window.addEventListener('figmy:open-editor', e);
    return () => {
      window.removeEventListener('figmy:home', h);
      window.removeEventListener('figmy:open-editor', e);
    };
  }, []);

  // join a shared file from a link (?room=…)
  useEffect(() => {
    const room = new URLSearchParams(location.search).get('room');
    if (room && /^[a-zA-Z0-9_-]{1,64}$/.test(room)) {
      setView('editor');
      goLive({ room, seed: false });
    }
  }, []);

  // auto-connect the open file to a reachable Figmy server (collaboration + AI connector)
  const fileId = useEditor((s) => s.fileId);
  useEffect(() => {
    if (view !== 'editor') {
      leaveLive();
      return;
    }
    let auto = true;
    try {
      auto = localStorage.getItem('figmy:autolive') !== 'off';
    } catch {
      /* ignore */
    }
    if (!auto) return;
    let cancelled = false;
    serverBase().then((b) => {
      if (b && !cancelled) goLive();
    });
    return () => {
      cancelled = true;
    };
  }, [view, fileId]);

  // window title
  useEffect(() => {
    document.title = view === 'home' ? 'Figmy' : `${dirty ? '● ' : ''}${name} — Figmy`;
    desktop?.setTitle(view === 'home' ? 'Figmy' : name, dirty);
  }, [name, dirty, view]);

  // autosave to the local library shortly after changes (every 1.5 s while dirty)
  useEffect(() => {
    if (view !== 'editor') return;
    const t = setInterval(() => {
      if (useEditor.getState().dirty) saveToLibrary();
    }, 1500);
    return () => clearInterval(t);
  }, [view]);

  // desktop bridge: native menu + "open with"
  useEffect(() => {
    if (!desktop) return;
    const off1 = desktop.onMenu((a) => {
      if (actions[a]) {
        if (a === 'new' || a === 'open') setView('editor');
        actions[a].run();
      }
    });
    const off2 = desktop.onOpenPath(async (path) => {
      const text = await desktop!.readFile(path);
      if (!text) return;
      try {
        useEditor.getState().setDoc(parseDocument(text), { filePath: path });
        setView('editor');
        setTimeout(() => useEditor.getState().zoomToFit(), 0);
      } catch (e) {
        useEditor.getState().notify('Could not open: ' + (e as Error).message);
      }
    });
    desktop.confirmClose(() => !useEditor.getState().dirty || confirm('You have unsaved changes. Quit anyway?'));
    return () => {
      off1();
      off2();
    };
  }, []);

  // web: warn before leaving with unsaved changes
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty && view === 'editor') {
        saveToLibrary();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [view]);

  if (authMode === 'loading')
    return (
      <div className="login-screen">
        <p className="muted">Loading…</p>
      </div>
    );
  if (gated)
    return (
      <>
        <LoginScreen />
        <Toast />
      </>
    );

  if (view === 'home')
    return (
      <>
        <Home onOpen={() => setView('editor')} />
        <FigmaImportDialog />
        <Toast />
      </>
    );

  return (
    <div className="app">
      <Toolbar theme={theme} setTheme={setTheme} />
      <div className="workspace">
        <LeftPanel />
        <div className="canvas-wrap">
          <Canvas />
          <ToolDock />
          <ContextBar />
        </div>
        <RightPanel />
      </div>
      {mode === 'motion' && <Timeline />}
      {presenting && <Presenter />}
      <ContextMenu />
      <ShortcutsDialog />
      <CommandPalette />
      <VariablesModal />
      <ResearchKit />
      <FigmaImportDialog />
      <ExportDialog />
      <ShareDialog />
      <Toast />
    </div>
  );
}
