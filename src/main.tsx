import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Pas de StrictMode : le double montage en dev recréerait inutilement
// les contextes WebGL et les canvas fabric.
createRoot(document.getElementById('root')!).render(<App />);
