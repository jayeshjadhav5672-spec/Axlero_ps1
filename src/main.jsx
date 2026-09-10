import React from 'react';
import { createRoot } from 'react-dom/client';
import Canvas from './components/canvas';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <main className="h-screen bg-slate-50 p-4 sm:p-6">
      <Canvas />
    </main>
  </React.StrictMode>,
);

