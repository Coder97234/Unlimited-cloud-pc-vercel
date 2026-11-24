import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/manrope/wght.css';
import App from './App.tsx';
import { analyticsEnabled, startAnalytics } from './lib/analytics.ts';
import './styles.css';
import './workspace.css';
import { styleEarlyAccess } from './lib/early-access.ts';

styleEarlyAccess();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

if (analyticsEnabled()) startAnalytics();
