import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { StoreProvider } from './lib/store';
import { registerServiceWorker } from './lib/sw';
import { initInstall } from './lib/install';

initInstall();
registerServiceWorker();

// Экран загрузки из index.html убираем после первого кадра React
requestAnimationFrame(() => {
  window.dispatchEvent(new Event('polovinka:ready'));
  // Приложение поднялось — защита от бесконечной перезагрузки при обновлении больше не нужна
  try {
    sessionStorage.removeItem('polovinka.chunkReload');
    sessionStorage.removeItem('polovinka.bootRetry');
  } catch {
    /* пусто */
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
