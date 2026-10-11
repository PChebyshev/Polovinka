import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { StoreProvider } from './lib/store';
import { registerServiceWorker } from './lib/sw';
import { initInstall } from './lib/install';

initInstall();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
