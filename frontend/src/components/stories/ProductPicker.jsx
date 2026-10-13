import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = { grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisTF: '#2a2e38', blanc: '#FFFFFF', rouge: '#DE2020', story: '#E11D48' };

/**
 * Choix d'un produit WooCommerce par recherche (nom, SKU ou numéro), comme
 * pour les emplacements des widgets. `value` = { id, title } ou null.
 * Le style global peint les boutons en blanc : chaque bouton fixe sa couleur.
 */
const ProductPicker = ({ value, onChange, placeholder = 'Chercher un produit (nom, SKU ou ID)…' }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (query.trim().length < 2) { setResults([]); return undefined; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${API_URL}/stories/products/search`, { params: { q: query.trim() } });
        setResults(res.data.data || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query]);

  if (value?.id) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8, background: C.grisTL }}>
        <span style={{ flex: 1, fontSize: 13, color: C.grisTF }}>
          {value.title || `Produit #${value.id}`}
          <span style={{ color: C.grisM, fontSize: 11 }}> · #{value.id}</span>
        </span>
        <button type="button" onClick={() => onChange(null)}
          style={{ padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.rouge, cursor: 'pointer', fontSize: 11 }}>
          Changer
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8, fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc }} />
      {(results.length > 0 || loading) && (
        <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 8, maxHeight: 240, overflowY: 'auto', boxShadow: '0 6px 18px rgba(0,0,0,.12)' }}>
          {loading && results.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: C.grisM }}>Recherche…</div>}
          {results.map((r) => (
            <div key={r.wp_product_id} onClick={() => { onChange({ id: Number(r.wp_product_id), title: r.post_title }); setQuery(''); setResults([]); }}
              style={{ padding: '7px 10px', fontSize: 13, color: C.grisTF, cursor: 'pointer', borderBottom: `1px solid ${C.grisTL}` }}>
              {r.post_title}
              <span style={{ color: C.grisM, fontSize: 11 }}> · #{r.wp_product_id} · {r.product_type}{r.post_status !== 'publish' ? ` · ${r.post_status}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductPicker;
