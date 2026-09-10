// Patch window.fetch so that tools or wrappers attempting to assign window.fetch do not fail with
// "Cannot set property fetch of #<Window> which has only a getter"
try {
  const target = typeof window !== 'undefined' ? window : globalThis;
  if (target) {
    const desc = Object.getOwnPropertyDescriptor(target, 'fetch');
    if (!desc || (desc.get && !desc.set)) {
      const nativeFetch = target.fetch;
      let currentFetch = typeof nativeFetch === 'function' ? nativeFetch.bind(target) : nativeFetch;
      Object.defineProperty(target, 'fetch', {
        get() {
          return currentFetch;
        },
        set(fn) {
          currentFetch = fn;
        },
        configurable: true,
        enumerable: true,
      });
    }
  }
} catch (e) {
  // Silent fallback
}

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
