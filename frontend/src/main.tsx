import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { captureInstallPrompt } from './pages/PhonePage/pwa';
import './styles/reset.css';
import './styles/index.scss';

// Before React: Chrome can offer to install before the phone page mounts.
captureInstallPrompt();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// The service worker only shows push notifications; it caches nothing.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
