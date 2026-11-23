import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Offline support for the web build (ignored inside Electron / dev)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}

// Scripting / test hook: window.figmy.store is the editor store (zustand)
import { useEditor } from './store/store';
(window as unknown as { figmy: unknown }).figmy = { store: useEditor };
