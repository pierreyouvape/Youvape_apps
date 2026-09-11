import { useState } from 'react';
import axios from 'axios';
import { formatPrice } from '../../utils/formatNumber';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

/**
 * Réfs d'un fournisseur pour un produit (fiche produit, onglet Fournisseurs).
 *
 * Un produit (simple ou déclinaison) peut avoir plusieurs réfs chez un même
 * fournisseur — unité, pack de 50, promo 4+1… — chacune avec son conditionnement
 * et son prix HT DU PACK. Une réf ne désigne qu'un produit : saisir une réf déjà
 * portée ailleurs demande confirmation avant de la déplacer (409 REF_TAKEN).
 */
const th = { padding: '8px', textAlign: 'left', color: '#6b7280', fontWeight: 500 };
const td = { padding: '4px 8px', verticalAlign: 'top' };
const input = { padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px' };
const btn = (bg, color = '#fff') => ({
  padding: '4px 10px', backgroundColor: bg, color, border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer'
});
const linkBtn = { padding: 0, background: 'none', border: 'none', color: '#135E84', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' };

const EMPTY = { supplier_sku: '', label: '', pack_qty: 1, pack_price: '' };

const unitPriceOf = (packPrice, packQty) => {
  const p = parseFloat(packPrice);
  const q = parseInt(packQty, 10);
  if (!Number.isFinite(p) || !(q >= 1)) return null;
  return p / q;
};

const SupplierRefsTable = ({ supplier, headers, onChanged }) => {
  const [drafts, setDrafts] = useState({});   // clé → champs modifiés
  const [adding, setAdding] = useState({});   // productId → ligne d'ajout ouverte
  const [busy, setBusy] = useState(false);

  const rows = supplier.is_variable_parent
    ? (supplier.variations || []).map(v => ({
        productId: v.variation_id, label: v.variation_label, refs: v.refs || [], bmsPack: v.pack_qty,
      }))
    : [{ productId: supplier.product_id, label: null, refs: supplier.refs || [], bmsPack: supplier.pack_qty }];

  const valueOf = (key, ref, field) => {
    const d = drafts[key];
    if (d && d[field] !== undefined) return d[field];
    return ref ? (ref[field] ?? '') : EMPTY[field];
  };
  const setField = (key, field, value) =>
    setDrafts(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [field]: value } }));
  const clearDraft = (key) => setDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });

  // Enregistre ; sur une réf déjà portée par un autre produit, demande puis rejoue avec move.
  const persist = async (key, send) => {
    setBusy(true);
    try {
      try {
        await send(false);
      } catch (err) {
        const data = err.response?.data;
        if (err.response?.status !== 409 || data?.code !== 'REF_TAKEN') throw err;
        const owner = `${data.owner.post_title}${data.owner.sku ? ` (${data.owner.sku})` : ''}`;
        if (!confirm(`${data.error}.\n\nUne réf. fournisseur ne désigne qu'un seul produit.\nLa déplacer ici ? Elle sera retirée de :\n${owner}`)) return false;
        await send(true);
      }
      clearDraft(key);
      await onChanged();
      return true;
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de l\'enregistrement de la réf.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveNew = async (productId) => {
    const key = `new_${productId}`;
    const d = { ...EMPTY, ...(drafts[key] || {}) };
    if (!String(d.supplier_sku).trim()) { alert('Saisissez la référence fournisseur.'); return; }
    const ok = await persist(key, (move) => axios.post(`${API_URL}/purchases/supplier-refs`, {
      supplier_id: supplier.id, product_id: productId, ...d, move,
    }, { headers }));
    if (ok) setAdding(prev => ({ ...prev, [productId]: false }));
  };

  const saveRef = (ref) => {
    const key = `ref_${ref.id}`;
    if (drafts[key]?.supplier_sku !== undefined && !String(drafts[key].supplier_sku).trim()) {
      alert('La référence ne peut pas être vide : utilisez « Supprimer ».');
      return;
    }
    persist(key, (move) => axios.put(`${API_URL}/purchases/supplier-refs/${ref.id}`, { ...drafts[key], move }, { headers }));
  };

  const deleteRef = async (ref) => {
    if (!confirm(`Supprimer la réf. ${ref.supplier_sku} ?`)) return;
    setBusy(true);
    try {
      await axios.delete(`${API_URL}/purchases/supplier-refs/${ref.id}`, { headers });
      clearDraft(`ref_${ref.id}`);
      await onChanged();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setBusy(false);
    }
  };

  const renderFields = (key, ref) => {
    const unit = unitPriceOf(valueOf(key, ref, 'pack_price'), valueOf(key, ref, 'pack_qty'));
    return (
      <>
        <td style={td}>
          <input type="text" value={valueOf(key, ref, 'supplier_sku')} placeholder="Réf."
            onChange={(e) => setField(key, 'supplier_sku', e.target.value)}
            style={{ ...input, width: '140px', fontFamily: 'monospace' }} />
        </td>
        <td style={td}>
          <input type="text" value={valueOf(key, ref, 'label') || ''} placeholder="Unité, pack 50, promo…"
            onChange={(e) => setField(key, 'label', e.target.value)}
            style={{ ...input, width: '150px' }} />
        </td>
        <td style={td}>
          <input type="number" min="1" step="1" value={valueOf(key, ref, 'pack_qty')}
            onChange={(e) => setField(key, 'pack_qty', e.target.value)}
            style={{ ...input, width: '64px' }} />
        </td>
        <td style={td}>
          <input type="number" min="0" step="0.01" value={valueOf(key, ref, 'pack_price') ?? ''}
            onChange={(e) => setField(key, 'pack_price', e.target.value)}
            style={{ ...input, width: '84px' }} />
        </td>
        <td style={{ ...td, paddingTop: '8px', color: '#6b7280', whiteSpace: 'nowrap' }}>
          {unit != null ? `${formatPrice(unit)} €` : '—'}
        </td>
      </>
    );
  };

  return (
    <div style={{ borderTop: '1px solid #e5e7eb', padding: '0 20px 16px', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            {supplier.is_variable_parent && <th style={{ ...th, paddingLeft: 0 }}>Déclinaison</th>}
            <th style={th}>Réf. fournisseur</th>
            <th style={th}>Libellé</th>
            <th style={th} title="Nombre d'unités de ce produit dans un article de cette réf.">Pack</th>
            <th style={th}>Prix HT du pack</th>
            <th style={th}>Prix unitaire</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const newKey = `new_${row.productId}`;
            const isAdding = !!adding[row.productId];
            const lines = [...row.refs.map(ref => ({ ref })), ...(isAdding ? [{ ref: null }] : [])];
            const labelCell = (rowSpan) => (
              <td rowSpan={rowSpan} style={{ ...td, paddingLeft: 0, paddingTop: '8px', color: '#374151' }}>
                {supplier.is_variable_parent && <div>{row.label}</div>}
                {row.bmsPack > 1 && (
                  <div style={{ fontSize: '11px', color: '#9ca3af' }}
                    title="Conditionnement imposé par l'association produit-fournisseur dans BMS : sert à convertir les quantités à l'envoi des commandes.">
                    BMS : pack de {row.bmsPack}
                  </div>
                )}
                {!isAdding && (
                  <button type="button" style={{ ...linkBtn, marginTop: '2px' }}
                    onClick={() => setAdding(prev => ({ ...prev, [row.productId]: true }))}>
                    + réf.
                  </button>
                )}
              </td>
            );

            if (lines.length === 0) {
              return (
                <tr key={row.productId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  {supplier.is_variable_parent ? labelCell(1) : null}
                  <td style={{ ...td, paddingTop: '8px', color: '#9ca3af' }} colSpan={5}>
                    Aucune réf.
                    {!supplier.is_variable_parent && (
                      <button type="button" style={{ ...linkBtn, marginLeft: '8px' }}
                        onClick={() => setAdding(prev => ({ ...prev, [row.productId]: true }))}>
                        + réf.
                      </button>
                    )}
                  </td>
                  <td style={td}></td>
                </tr>
              );
            }

            return lines.map(({ ref }, i) => {
              const key = ref ? `ref_${ref.id}` : newKey;
              const dirty = !!drafts[key];
              const last = i === lines.length - 1;
              return (
                <tr key={key} style={{ borderBottom: last ? '1px solid #f3f4f6' : 'none' }}>
                  {i === 0 && supplier.is_variable_parent && labelCell(lines.length)}
                  {renderFields(key, ref)}
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {ref ? (
                      <>
                        <button type="button" onClick={() => saveRef(ref)} disabled={busy || !dirty}
                          style={{ ...btn(dirty ? '#135E84' : '#d1d5db'), cursor: dirty ? 'pointer' : 'not-allowed', marginRight: '6px' }}>
                          Sauvegarder
                        </button>
                        <button type="button" onClick={() => deleteRef(ref)} disabled={busy}
                          style={btn('#fee2e2', '#dc2626')}>
                          Supprimer
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => saveNew(row.productId)} disabled={busy}
                          style={{ ...btn('#135E84'), marginRight: '6px' }}>
                          Ajouter
                        </button>
                        <button type="button" disabled={busy}
                          onClick={() => { clearDraft(newKey); setAdding(prev => ({ ...prev, [row.productId]: false })); }}
                          style={btn('#f3f4f6', '#374151')}>
                          Annuler
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
      {!supplier.is_variable_parent && (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px' }}>
          {rows[0].refs.length > 0 && !adding[rows[0].productId] && (
            <button type="button" style={linkBtn}
              onClick={() => setAdding(prev => ({ ...prev, [rows[0].productId]: true }))}>
              + Ajouter une réf.
            </button>
          )}
          {rows[0].bmsPack > 1 && (
            <span style={{ fontSize: '11px', color: '#9ca3af' }}
              title="Conditionnement imposé par l'association produit-fournisseur dans BMS : sert à convertir les quantités à l'envoi des commandes.">
              BMS : pack de {rows[0].bmsPack}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default SupplierRefsTable;
