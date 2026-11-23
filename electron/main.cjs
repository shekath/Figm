// Figmy desktop shell (Electron main process).
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let win = null;
let pendingOpen = null;
let allowClose = false;
let serverUrl = null;
let embedded = null;

/** Start (or reuse) the local Figmy server: collaboration + MCP connector for AI assistants. */
async function startEmbeddedServer() {
  const port = Number(process.env.FIGMY_PORT || 4317);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    if (r.ok && (await r.json()).app === 'figmy') {
      serverUrl = `http://127.0.0.1:${port}`;
      return;
    }
  } catch {
    /* not running */
  }
  const { startServer } = require(path.join(__dirname, '..', 'server-dist', 'app.cjs'));
  const opts = { host: '127.0.0.1', dataDir: path.join(app.getPath('userData'), 'server'), staticDir: path.join(__dirname, '..', 'dist'), log: (m) => console.log(m) };
  try {
    embedded = await startServer({ ...opts, port });
  } catch {
    embedded = await startServer({ ...opts, port: 0 }); // port taken by something else
  }
  serverUrl = embedded.url;
}

/** Only .figmy / .json files may be read through the bridge. */
const allowedDoc = (p) => typeof p === 'string' && /\.(figmy|vectura|json)$/i.test(p);

function fileFromArgv(argv) {
  return argv.slice(isDev ? 2 : 1).find((a) => allowedDoc(a) && !a.startsWith('-')) || null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    title: 'Figmy',
    backgroundColor: '#1e1e24',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // open external links in the default browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !(isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL))) e.preventDefault();
  });

  win.webContents.on('did-finish-load', () => {
    if (pendingOpen) {
      win.webContents.send('open-path', pendingOpen);
      pendingOpen = null;
    }
  });

  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('request-close');
  });
}

function send(action) {
  if (win) win.webContents.send('menu', action);
}

function buildMenu() {
  const item = (label, action, accelerator) => ({ label, accelerator, click: () => send(action) });
  const template = [
    {
      label: '&File',
      submenu: [
        item('New Design File', 'new', 'CmdOrCtrl+N'),
        item('Open…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'saveAs', 'CmdOrCtrl+Shift+S'),
        item('Save Version…', 'saveVersion', 'CmdOrCtrl+Alt+S'),
        { type: 'separator' },
        item('Import Images / SVG…', 'importFiles', 'CmdOrCtrl+Shift+K'),
        item('Import from Figma…', 'figmaImport'),
        item('Export…', 'export', 'CmdOrCtrl+Shift+E'),
        item('Export Design to HTML…', 'exportHtml'),
        item('Quick Export PNG @2x', 'exportSelection', 'CmdOrCtrl+Alt+E'),
        item('Export Selection as SVG', 'exportSvg'),
        item('Export Frames to PDF', 'exportPdf'),
        { type: 'separator' },
        item('Back to Files', 'home'),
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        item('Undo', 'undo', 'CmdOrCtrl+Z'),
        item('Redo', 'redo', 'CmdOrCtrl+Shift+Z'),
        { type: 'separator' },
        // native roles keep text fields working; the canvas listens for copy/paste events too
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        item('Duplicate', 'duplicate', 'CmdOrCtrl+D'),
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        item('Zoom In', 'zoomIn', 'CmdOrCtrl+='),
        item('Zoom Out', 'zoomOut', 'CmdOrCtrl+-'),
        item('Zoom to Fit', 'zoomFit', 'Shift+1'),
        item('Zoom to 100%', 'zoom100', 'Shift+0'),
        { type: 'separator' },
        item('Pixel Grid', 'toggleGrid'),
        item('Rulers', 'toggleRulers'),
        item('Outline Mode', 'toggleOutlines'),
        { type: 'separator' },
        item('Present Prototype', 'present', 'CmdOrCtrl+Alt+Enter'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }, { role: 'reload' }] : []),
      ],
    },
    {
      label: '&Object',
      submenu: [
        item('Group Selection', 'group'),
        item('Ungroup', 'ungroup'),
        item('Frame Selection', 'frameSelection'),
        item('Add Auto Layout', 'autoLayout'),
        { type: 'separator' },
        item('Create Component', 'component'),
        item('Detach Instance', 'detach'),
        item('Use as Mask', 'mask'),
        { type: 'separator' },
        item('Bring to Front', 'bringFront'),
        item('Send to Back', 'sendBack'),
      ],
    },
    {
      label: '&Help',
      submenu: [
        item('Share / Collaborate…', 'share'),
        item('Connect Claude / ChatGPT (MCP)…', 'connectAI'),
        { type: 'separator' },
        item('Keyboard Shortcuts', 'shortcuts'), { label: 'About Figmy', click: () => dialog.showMessageBox(win, { message: `Figmy ${app.getVersion()}`, detail: `Open-source vector design and prototyping tool.\n\nLocal server: ${serverUrl ?? 'not running'}\nMCP endpoint: ${serverUrl ? serverUrl + '/mcp' : '—'}` }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- IPC bridge ---------- */

const docFilters = [{ name: 'Figmy design', extensions: ['figmy', 'vectura'] }, { name: 'JSON', extensions: ['json'] }];

ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: docFilters });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  app.addRecentDocument(p);
  return { path: p, content: await fs.readFile(p, 'utf8') };
});

ipcMain.handle('read-file', async (_e, p) => {
  if (!allowedDoc(p)) return null;
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
});

ipcMain.handle('save-file', async (_e, p, content, suggestedName) => {
  let target = allowedDoc(p) ? p : null;
  if (!target) {
    const r = await dialog.showSaveDialog(win, { defaultPath: suggestedName, filters: docFilters });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  if (typeof content !== 'string') return null;
  await fs.writeFile(target, content, 'utf8');
  app.addRecentDocument(target);
  return target;
});

ipcMain.handle('export-file', async (_e, suggestedName, data, ext) => {
  const safeExt = String(ext).replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
  const r = await dialog.showSaveDialog(win, { defaultPath: suggestedName, filters: [{ name: safeExt.toUpperCase(), extensions: [safeExt] }] });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, Buffer.from(data));
  return r.filePath;
});

ipcMain.on('set-title', (_e, title, dirty) => {
  if (win) {
    win.setTitle(`${dirty ? '● ' : ''}${title}${title === 'Figmy' ? '' : ' — Figmy'}`);
    win.setDocumentEdited(!!dirty);
  }
});

ipcMain.handle('server-url', () => serverUrl);

ipcMain.on('close-ok', () => {
  allowClose = true;
  if (win) win.close();
});

/* ---------- lifecycle ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('open-path', f);
    }
  });

  app.whenReady().then(async () => {
    pendingOpen = fileFromArgv(process.argv);
    await startEmbeddedServer().catch((e) => console.error('[figmy] embedded server failed:', e));
    buildMenu();
    createWindow();
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });

  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (win) win.webContents.send('open-path', p);
    else pendingOpen = p;
  });

  app.on('before-quit', () => {
    if (embedded) embedded.close();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
