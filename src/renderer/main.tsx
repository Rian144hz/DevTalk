import '@fontsource-variable/public-sans';
import '@fontsource-variable/jetbrains-mono';
import './design-system/tokens.css';
import './design-system/base.css';
import './app/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
