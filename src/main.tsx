import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

/** Shows a readable error instead of a blank page if rendering crashes. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ font: '14px Inter, system-ui, sans-serif', padding: 32, maxWidth: 640, margin: '10vh auto' }}>
        <h2>Figmy hit an error</h2>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#e5484d' }}>{this.state.error.message}</pre>
        <p>Your work is autosaved in this browser. Reload to continue.</p>
        <button onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Offline support for the web build (ignored inside Electron / dev)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}

// Scripting / test hook: window.figmy.store is the editor store (zustand)
import { useEditor } from './store/store';
(window as unknown as { figmy: unknown }).figmy = { store: useEditor };
