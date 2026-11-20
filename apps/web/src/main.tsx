import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthGate } from './features/auth/AuthGate';
import { ToastProvider } from './components/Toast';
import { NewVersionBanner } from './components/NewVersionBanner';
import './app/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <NewVersionBanner />
      <AuthGate />
    </ToastProvider>
  </StrictMode>,
);
