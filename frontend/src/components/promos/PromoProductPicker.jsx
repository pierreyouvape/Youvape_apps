import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  promo: '#DB2777', vert: '#4AB866', rouge: '#DE2020', orange: '#E28F00',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const eur = (v) => (v === null || v === undefined ? '—'
  : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €');
const int = (v) => new Intl.NumberFormat('fr-FR').format(parseInt(v, 10) || 0);
const marginColor = (p) => (p === null || p === undefined ? C.grisM : p < 0 ? C.rouge : p < 15 ? C.orange : C.vert);

/**
 * Sélecteur de produits d'une opération promo.
 *
 * Ne liste que des unités vendables (produits simples, variations, bundles) :
 * ce sont elles qui portent un prix, un stock et un coût. Les produits déjà
 * présents dans l'opération sont exclus côté serveur.
 */
export default function PromoProductPicker({ operationId, onClose, onAdd }) {
  const [q, setQ] = useState('');
  // Valeur encodée « type:valeur » pour n'avoir qu'un menu marques + sous-marques.
  const [brandSel, setBrandSel] = useState('');
  const [brands, setBrands] = useState([]);
  const [inStockOnly, setInStockOnly] = useState(true);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const debounce = useRef(null);

  useEffect(() => {
    axios.get(`${API_URL}/promos/products/brands`)
      .then((res) => setBrands(res.data.data || []))
      .catch(() => setBrands([]));
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const [selType, ...selRest] = brandSel.split(':');
      const selValue = selRest.join(':');
      const res = await axios.get(`${API_URL}/promos/products/search`, {
        params: {
          q,
          brand: selType === 'brand' ? selValue : undefined,
          subBrand: selType === 'sub_brand' ? selValue : undefined,
          inStockOnly: inStockOnly ? 1 : 0,
          excludeOperationId: operationId, limit: 150,
        },
      });
      setRows(res.data.data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [q, brandSel, inStockOnly, operationId]);

  // Recherche à la frappe, temporisée.
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(fetchRows, 300);
    return () => clearTimeout(debounce.current);
  }, [fetchRows]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const toggleAll = () => setSelected((s) => {
    const allIds = rows.map((r) => r.wp_product_id);
    const everySelected = allIds.every((id) => s.has(id));
    const n = new Set(s);
    allIds.forEach((id) => (everySelected ? n.delete(id) : n.add(id)));
    return n;
  });

  const confirm = async () => {
    setAdding(true);
    try {
      await onAdd([...selected]);
      onClose();
    } finally {
      setAdding(false);
    }
  };

  const inputStyle = {
    padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
    fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
  };
  const th = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.grisM, borderBottom: `2px solid ${C.grisCL}`, position: 'sticky', top: 0, background: C.blanc, zIndex: 2, whiteSpace: 'nowrap' };
  const thR = { ...th, textAlign: 'right' };
  const td = { padding: '8px 10px', fontSize: 13, color: C.grisTF, borderBottom: `1px solid ${C.grisCL}` };
  const tdR = { ...td, textAlign: 'right', fontFamily: 'monospace' };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div style={{ background: C.blanc, borderRadius: 16, width: 'min(1100px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.grisCL}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.grisTF, flex: 1 }}>Ajouter des produits</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, color: C.grisM, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '14px 22px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', borderBottom: `1px solid ${C.grisCL}` }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher (nom, SKU, marque)…" style={{ ...inputStyle, flex: 1, minWidth: 240 }} />
          <select value={brandSel} onChange={(e) => setBrandSel(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
            <option value="">Toutes les marques</option>
            {brands.map((b) => (
              <option key={`${b.type}:${b.parent || ''}:${b.value}`} value={`${b.type}:${b.value}`}>
                {b.type === 'sub_brand' ? `\u00A0\u00A0↳ ${b.value}` : b.value} ({b.nb})
              </option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.grisTF, cursor: 'pointer' }}>
            <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
            En stock uniquement
          </label>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: 30, color: C.grisM, fontSize: 13 }}>Recherche…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 30, color: C.grisM, fontSize: 13 }}>Aucun produit trouvé.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 36 }}>
                    <input type="checkbox" onChange={toggleAll}
                      checked={rows.length > 0 && rows.every((r) => selected.has(r.wp_product_id))} />
                  </th>
                  <th style={th}>Produit</th>
                  <th style={thR}>Stock</th>
                  <th style={thR}>Ventes 30 j</th>
                  <th style={thR}>Prix achat HT</th>
                  <th style={thR}>Prix vente TTC</th>
                  <th style={thR}>Tarif remisé</th>
                  <th style={thR}>Marge actuelle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const checked = selected.has(r.wp_product_id);
                  return (
                    <tr key={r.wp_product_id} onClick={() => toggle(r.wp_product_id)}
                      style={{ cursor: 'pointer', background: checked ? '#FDF2F8' : undefined }}>
                      <td style={td}>
                        <input type="checkbox" checked={checked} onChange={() => toggle(r.wp_product_id)}
                          onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{r.display_name}</div>
                        <div style={{ fontSize: 11, color: C.grisM, fontFamily: 'monospace' }}>
                          {r.sku}{r.brand ? ` · ${r.brand}` : ''}{r.sub_brand ? ` › ${r.sub_brand}` : ''}
                        </div>
                      </td>
                      <td style={{ ...tdR, color: r.stock <= 0 ? C.rouge : C.grisTF }}>{int(r.stock)}</td>
                      <td style={tdR}>{int(r.sales_30d)}</td>
                      <td style={tdR}>{eur(r.cost_price)}</td>
                      <td style={tdR}>{eur(r.price)}</td>
                      <td style={{ ...tdR, color: r.discounted_price ? C.orange : C.grisM }}>
                        {r.discounted_price ? eur(r.discounted_price) : '—'}
                      </td>
                      <td style={{ ...tdR, color: marginColor(r.current_margin_pct) }}>
                        {r.current_margin_pct === null ? '—' : `${r.current_margin_pct} %`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '14px 22px', borderTop: `1px solid ${C.grisCL}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: C.grisM, flex: 1 }}>
            {selected.size} produit{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisTF, fontSize: 13, cursor: 'pointer' }}>
            Annuler
          </button>
          <button onClick={confirm} disabled={selected.size === 0 || adding}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: C.promo, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: selected.size === 0 || adding ? 0.5 : 1 }}>
            {adding ? 'Ajout…' : `Ajouter${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
