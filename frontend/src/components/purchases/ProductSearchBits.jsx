import { useState } from 'react';

/**
 * Vignette des listes de résultats de `GET /api/purchases/products/search`
 * (commande, réception, import PDF). Une image absente ou cassée laisse une
 * case grise.
 */
export function ProductThumb({ src, size = 40 }) {
  const [broken, setBroken] = useState(false);
  const box = {
    width: size, height: size, flexShrink: 0, borderRadius: 6,
    background: '#f3f4f6', border: '1px solid #eee', objectFit: 'contain',
  };
  if (!src || broken) return <div style={box} />;
  return <img src={src} alt="" loading="lazy" style={box} onError={() => setBroken(true)} />;
}
