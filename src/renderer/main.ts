import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@renderer/App';

const rootElement = document.getElementById('root');
if (!(rootElement instanceof HTMLElement)) {
  throw new Error('Elemento raiz nao encontrado: root');
}

createRoot(rootElement).render(createElement(App));

void bootstrapLegacyController();

async function bootstrapLegacyController(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

  await import('@renderer/legacy-main');
}
