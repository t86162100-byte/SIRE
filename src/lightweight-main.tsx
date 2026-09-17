import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LightweightMarketChart from './LightweightMarketChart';
import './index.css';

const candles = Array.from({ length: 220 }, (_, index) => {
  const epoch = Math.floor(Date.now() / 1000) - (220 - index) * 3600;
  const base = 100 + Math.sin(index / 9) * 4 + index * 0.035;
  const open = base + Math.sin(index * 1.7) * 0.7;
  const close = base + Math.cos(index * 1.3) * 0.8;
  const high = Math.max(open, close) + 0.55 + (index % 4) * 0.08;
  const low = Math.min(open, close) - 0.55 - (index % 3) * 0.08;
  return { epoch, open, high, low, close, volume: 1000 + index * 4 };
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LightweightMarketChart candles={candles} />
  </StrictMode>,
);
