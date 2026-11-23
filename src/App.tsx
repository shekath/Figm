import { useEffect, useState } from 'react';
import { useEditor } from './store/store';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './panels/Toolbar';
import { LeftPanel } from './panels/LeftPanel';
import { RightPanel } from './panels/RightPanel';
import { Presenter } from './Presenter';
import { ContextMenu, ShortcutsDialog, Toast } from './Overlays';
import { Home } from './Home';
import { VariablesModal } from './panels/Variables';
import { FigmaImportDialog } from './panels/FigmaImport';
import { ExportDialog } from './panels/ExportDialog';
import { ShareDialog } from './collab/CollabUI';
import { goLive, leaveLive } from './collab/client';
import { serverBase } from './collab/config';
import { useShortcuts } from './useShortcuts';
import { actions, saveToLibrary } from './actions';
import { desktop, parseDocument } from './lib/platform';

export function App() {
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
  const name = useEditor((s) => s.doc.name);
  const dirty = useEditor((s) => s.dirty);
  useShortcuts(view === 'editor');

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

  // autosave to the local library every 5 seconds when dirty
  useEffect(() => {
    if (view !== 'editor') return;
    const t = setInterval(() => {
      if (useEditor.getState().dirty) saveToLibrary();
    }, 5000);
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
        <Canvas />
        <RightPanel />
      </div>
      {presenting && <Presenter />}
      <ContextMenu />
      <ShortcutsDialog />
      <VariablesModal />
      <FigmaImportDialog />
      <ExportDialog />
      <ShareDialog />
      <Toast />
    </div>
  );
}
