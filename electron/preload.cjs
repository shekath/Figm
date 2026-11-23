// Exposes a narrow, typed bridge to the renderer. No Node APIs leak into the page.
const { contextBridge, ipcRenderer } = require('electron');

let closeCheck = () => true;
ipcRenderer.on('request-close', () => {
  if (closeCheck()) ipcRenderer.send('close-ok');
});

const subscribe = (channel) => (cb) => {
  const h = (_e, v) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('figmyDesktop', {
  isDesktop: true,
  serverUrl: () => ipcRenderer.invoke('server-url'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('open-file'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  saveFile: (p, content, name) => ipcRenderer.invoke('save-file', p, content, name),
  exportFile: (name, data, ext) => ipcRenderer.invoke('export-file', name, data, ext),
  onMenu: subscribe('menu'),
  onOpenPath: subscribe('open-path'),
  setTitle: (title, dirty) => ipcRenderer.send('set-title', title, dirty),
  confirmClose: (cb) => {
    closeCheck = cb;
  },
});
