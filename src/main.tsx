import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {App} from './App';
import {StoreProvider} from './data/store';
// Leaflet's styles first, so the cockpit's own map styles come after and win.
import 'leaflet/dist/leaflet.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/ui.css';
import './styles/instruments.css';
import './styles/hud.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <App />
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
);
