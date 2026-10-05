import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthGate } from './features/auth/AuthGate';
import { ToastProvider } from './components/Toast';
import './app/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <AuthGate />
    </ToastProvider>
  </StrictMode>,
);
