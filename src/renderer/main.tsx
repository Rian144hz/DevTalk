import '@fontsource-variable/public-sans';
import '@fontsource-variable/jetbrains-mono';
import './design-system/tokens.css';
import './design-system/base.css';
import './design-system/components.css';
import './app/app.css';
import './screens/screens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyStartTheme } from './lib/useTheme';

// Before the first frame, so the splash opens on the right ground.
applyStartTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
