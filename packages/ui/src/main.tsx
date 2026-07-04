import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installFontLoadingTimeout } from './styles/fonts';
import './styles/index.css';

// Kick off the 3s font-loading timeout (Requirement 1.4). Non-blocking: text
// renders immediately via font-display: swap; this only decides whether to lock
// in the system fallback if the brand fonts are slow/unavailable.
void installFontLoadingTimeout();

const container = document.getElementById('root');
if (!container) {
    throw new Error('Root container #root not found');
}

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
