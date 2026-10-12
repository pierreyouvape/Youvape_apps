import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import '../../pages/PurchasesApp.css'; // charte Gestion d'achat V2

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const NBSP = /[  ]/g;
const fmtInt = (v) => (parseInt(v, 10) || 0).toLocaleString('fr-FR').replace(NBSP, ' ');
const fmtEur = (v) => (v == null ? '-' : `${(parseFloat(v) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).replace(NBSP, ' ')} €`);
const round2 = (v) => Math.round(v * 100) / 100;

const SKEY = (slug) => `yv.boutique.import.${slug}.supplier`;
const loadSupplier = (slug) => { try { return localStorage.getItem(SKEY(slug)) || ''; } catch { return ''; } };
const saveSupplier = (slug, v) => { try { localStorage.setItem(SKEY(slug), v); } catch { /* ignore */ } };

// Provenance du rattachement d'une ligne (cf. nextoreImportModel.parseDocument)
const SOURCE = {
  boutique: { label: 'réf boutique', color: '#16a34a' },
  site: { label: 'proposé par le site', color: '#2563eb' },
};

/* ─── COMPOSANT ─────────────────────────────────────────── */
export default function ImportTab({ shop, token }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState(() => loadSupplier(shop.slug));
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);
  const [reference, setReference] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const [searchIdx, setSearchIdx] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const searchTimeout = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => {
    axios.get(`${API_URL}/nextore/${shop.slug}/import/suppliers`, auth)
      .then((res) => setSuppliers(res.data.suppliers || []))
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, [shop.slug, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseSupplier = (v) => { setSupplierId(v); saveSupplier(shop.slug, v); };

  const reset = () => {
    setData(null); setItems([]); setReference(''); setFile(null); setError('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const parse = async () => {
    if (!supplierId || !file) return;
    setParsing(true); setError(''); setResult(null);
    try {
      const form = new FormData();
      form.append('pdf', file);
      form.append('supplier_id', supplierId);
      const res = await axios.post(`${API_URL}/nextore/${shop.slug}/import/parse`, form, auth);
      setData(res.data);
      setItems(res.data.items);
      setReference(res.data.order_number || '');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur de lecture du document');
    } finally { setParsing(false); }
  };

  /* ─── Mapping manuel ─── */
  const search = (value, idx) => {
    setSearchTerm(value); setSearchIdx(idx);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (value.trim().length < 2) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/nextore/${shop.slug}/products/search?q=${encodeURIComponent(value)}&limit=20`, auth);
        setSearchResults(res.data.products || []);
      } catch { setSearchResults([]); }
    }, 300);
  };
  const openSearch = (idx) => { setSearchIdx(idx); setSearchTerm(''); setSearchResults([]); };
  const closeSearch = () => { setSearchIdx(null); setSearchTerm(''); setSearchResults([]); };

  // Comme le site : on choisit le produit, puis le nombre d'unités dans UN article
  // de la réf (proposé : réf boutique, sinon réf du site, sinon 1). La réf est
  // enregistrée aussitôt ; portée par un autre produit, elle est déplacée sur accord.
  const mapProduct = async (idx, productId) => {
    const it = items[idx];
    const body = {
      supplier_id: supplierId, product_id: productId, supplier_sku: it.supplier_sku,
      doc_qty: it.doc_qty, doc_price: it.doc_price, discount_percent: it.discount_percent,
      conversion: data.conversion,
    };
    try {
      let m = (await axios.post(`${API_URL}/nextore/${shop.slug}/import/map-line`, { ...body, pack_qty: null }, auth)).data;
      // Document déjà compté en pièces (e.tasty, Curieux…) : le conditionnement ne change rien
      if (!data.conversion.invertPackQty) {
        const answer = window.prompt(
          `Réf. ${it.supplier_sku || '(sans réf.)'} → ${m.product.name}\n\n` +
          'Combien d\'unités de ce produit dans UN article de cette réf. ?\n' +
          '(1 = vendu à l\'unité, 50 = pack de 50…)',
          String(m.pack),
        );
        if (answer === null) return;
        const pack = parseInt(answer, 10);
        if (!Number.isInteger(pack) || pack < 1 || String(pack) !== answer.trim()) {
          alert('Conditionnement invalide : un nombre entier supérieur ou égal à 1 est attendu.');
          return;
        }
        if (pack !== m.pack) m = (await axios.post(`${API_URL}/nextore/${shop.slug}/import/map-line`, { ...body, pack_qty: pack }, auth)).data;
      }
      let move = false;
      if (m.conflict) {
        const owner = `${m.conflict.name}${m.conflict.code ? ` (${m.conflict.code})` : ''}`;
        if (!window.confirm(
          `La réf. ${it.supplier_sku} est déjà associée à :\n${owner}\n\n` +
          'Une réf. fournisseur ne désigne qu\'un seul produit.\n' +
          `La déplacer sur ${m.product.name} ?`,
        )) return;
        move = true;
      }
      if (it.supplier_sku) {
        await axios.post(`${API_URL}/nextore/${shop.slug}/import/refs`, {
          supplier_id: supplierId, supplier_sku: it.supplier_sku, product_id: m.product.id, pack_qty: m.pack, move,
        }, auth);
      }
      setItems((prev) => prev.map((x, i) => (i !== idx ? x : {
        ...x, match_source: 'boutique', product: m.product, pack: m.pack, candidates: [],
        quantity: m.quantity, unit_cost: m.unit_cost, price_source: m.price_source,
      })));
      closeSearch();
    } catch (e) {
      alert(e.response?.data?.error || e.message || 'Erreur lors du rattachement');
    }
  };

  const setField = (idx, key, value) => setItems((prev) => prev.map((x, i) => (i !== idx ? x : { ...x, [key]: value })));

  /* ─── Totaux et remises de pied ─── */
  const sendable = items.filter((x) => x.product && x.quantity > 0);
  const unmapped = items.filter((x) => !x.product).length;
  const missingPrice = sendable.filter((x) => x.unit_cost == null || x.unit_cost === '').length;
  const linesTotal = sendable.reduce((a, x) => a + x.quantity * (parseFloat(x.unit_cost) || 0), 0);
  const discountTotal = (data?.discounts || []).reduce((a, d) => a + (parseFloat(d.amount) || 0), 0);
  // Remise de pied répartie au prorata du montant des lignes envoyées
  const discountFactor = linesTotal > 0 && discountTotal < 0 ? Math.max(0, (linesTotal + discountTotal) / linesTotal) : 1;

  const send = async () => {
    if (!window.confirm(`Créer la commande « ${reference} » (${sendable.length} lignes, ${fmtEur(round2(linesTotal * discountFactor))} HT) ?`)) return;
    setSending(true); setError('');
    try {
      const res = await axios.post(`${API_URL}/nextore/${shop.slug}/import/purchase`, {
        supplier_id: supplierId,
        reference_no: reference,
        lines: sendable.map((x) => ({
          product_id: x.product.id,
          quantity: parseInt(x.quantity, 10),
          unit_cost: Math.round(parseFloat(x.unit_cost) * discountFactor * 10000) / 10000,
          supplier_sku: x.supplier_sku,
          pack: x.pack,
          match_source: x.match_source,
        })),
      }, auth);
      setResult(res.data);
      reset();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur lors de la création de la commande');
    } finally { setSending(false); }
  };

  return (
    <div className="needs-tab" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div className="purchases-card">
        <div className="filters-bar">
          <div className="filter-group">
            <label>Fournisseur</label>
            <select value={supplierId} onChange={(e) => { chooseSupplier(e.target.value); reset(); }} disabled={parsing}>
              <option value="">Choisir…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label>Commande ou facture (PDF / CSV)</label>
            <input ref={fileInput} type="file" accept=".pdf,.csv,application/pdf,text/csv" onChange={(e) => setFile(e.target.files[0] || null)} />
          </div>
          <div className="filter-group">
            <label>&nbsp;</label>
            <button className="btn btn-primary" onClick={parse} disabled={!supplierId || !file || parsing}>{parsing ? 'Lecture…' : 'Lire le document'}</button>
          </div>
        </div>
        {error && <div style={{ marginTop: 12, color: '#dc2626', fontWeight: 600 }}>{error}</div>}
        {result && (
          <div style={{ marginTop: 12, color: '#16a34a', fontWeight: 600 }}>
            Commande « {result.reference} » créée ({result.lines} lignes) : elle se réceptionne dans Achat › Commandes, qui met le stock Nextore à jour.
          </div>
        )}
      </div>

      {data && (
        <div className="purchases-card">
          {[...(data.parse_warnings || []).map((w) => w.message), data.duplicate_warning].filter(Boolean).map((msg) => (
            <div key={msg} style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, marginBottom: 8, fontSize: 13 }}>{msg}</div>
          ))}

          <div className="filters-bar" style={{ marginBottom: 12 }}>
            <div className="filter-group">
              <label>Référence de la commande</label>
              <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, width: 220 }} />
            </div>
            {data.order_date && <div className="filter-group"><label>Date du document</label><div style={{ padding: '6px 0' }}>{data.order_date}</div></div>}
            <div style={{ marginLeft: 'auto', fontSize: 13, color: '#555', alignSelf: 'center' }}>
              {items.length} lignes · <span style={{ color: '#16a34a' }}>{items.length - unmapped} rattachées</span>
              {unmapped > 0 && <> · <span style={{ color: '#dc2626' }}>{unmapped} à mapper</span></>}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="purchases-table">
              <thead>
                <tr>
                  <th>Réf.</th>
                  <th>Désignation</th>
                  <th className="text-right">Qté doc.</th>
                  <th>Produit Nextore</th>
                  <th className="text-right">Pack</th>
                  <th className="text-right">Pièces</th>
                  <th className="text-right">Prix pièce HT</th>
                  <th className="text-right">Total HT</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x, i) => (
                  <tr key={i} style={{ background: !x.product ? '#fef2f2' : i % 2 ? '#f8fafc' : '#fff' }}>
                    <td><code style={{ fontSize: 12 }}>{x.supplier_sku || '-'}</code></td>
                    <td style={{ fontSize: 13 }}>{x.designation || '-'}</td>
                    <td className="text-right">{fmtInt(x.doc_qty)}</td>
                    <td style={{ minWidth: 260, position: 'relative' }}>
                      {x.product && searchIdx !== i ? (
                        <>
                          <div style={{ fontWeight: 500 }}>{x.product.name}</div>
                          <small style={{ color: '#666' }}>
                            {x.product.code || ''}{x.product.stock != null ? ` · stock ${fmtInt(x.product.stock)}` : ''}
                            {SOURCE[x.match_source] && <span style={{ color: SOURCE[x.match_source].color }}> · {SOURCE[x.match_source].label}</span>}
                            {' · '}<a href="#" onClick={(e) => { e.preventDefault(); openSearch(i); }}>changer</a>
                          </small>
                        </>
                      ) : (
                        <>
                          <input type="text" placeholder="Chercher un produit (nom, code, EAN)…" value={searchIdx === i ? searchTerm : ''}
                            onChange={(e) => search(e.target.value, i)} onFocus={() => { if (searchIdx !== i) openSearch(i); }}
                            style={{ width: '100%', padding: '5px 8px', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13 }} />
                          {x.candidates?.length > 0 && searchIdx !== i && (
                            <div style={{ fontSize: 12, marginTop: 4 }}>
                              Le site propose :{' '}
                              {x.candidates.map((c) => (
                                <button key={c.id} type="button" className="btn btn-secondary btn-sm" style={{ margin: '2px 4px 0 0' }} onClick={() => mapProduct(i, c.id)}>{c.name}</button>
                              ))}
                            </div>
                          )}
                          {searchIdx === i && (searchResults.length > 0 || x.product) && (
                            <div style={{ position: 'absolute', zIndex: 50, left: 0, right: 0, top: '100%', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto' }}>
                              {searchResults.map((p) => (
                                <div key={p.product_id} onClick={() => mapProduct(i, p.product_id)} style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                                  <small style={{ color: '#666' }}>{p.sku || ''}{p.barcode ? ` · ${p.barcode}` : ''} · stock {fmtInt(p.stock)}</small>
                                </div>
                              ))}
                              <div onClick={closeSearch} style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, color: '#6b7280', textAlign: 'center' }}>Fermer</div>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="text-right">{x.pack ?? '-'}</td>
                    <td className="text-right">
                      {x.product ? <input type="number" className="qty-input" min="0" value={x.quantity ?? ''} onChange={(e) => setField(i, 'quantity', parseInt(e.target.value, 10) || 0)} /> : '-'}
                    </td>
                    <td className="text-right">
                      {x.product ? (
                        <>
                          <input type="number" className="qty-input" min="0" step="0.0001" style={{ width: 90 }} value={x.unit_cost ?? ''}
                            onChange={(e) => { setField(i, 'unit_cost', e.target.value === '' ? null : parseFloat(e.target.value)); setField(i, 'price_source', 'saisi'); }} />
                          <div style={{ fontSize: 11, color: x.unit_cost == null ? '#dc2626' : '#6b7280' }}>{x.unit_cost == null ? 'aucun prix' : x.price_source}</div>
                        </>
                      ) : '-'}
                    </td>
                    <td className="text-right">{x.product && x.unit_cost != null ? fmtEur(round2(x.quantity * x.unit_cost)) : '-'}</td>
                  </tr>
                ))}
                {(data.discounts || []).map((d, i) => (
                  <tr key={`d${i}`} style={{ background: '#fefce8' }}>
                    <td colSpan={7} style={{ fontSize: 13 }}>{d.label} <small style={{ color: '#6b7280' }}>(remise de pied, répartie sur les prix des lignes envoyées)</small></td>
                    <td className="text-right">{fmtEur(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#555' }}>
              {unmapped > 0 && <div style={{ color: '#dc2626' }}>{unmapped} ligne(s) sans produit Nextore ne seront pas reprises.</div>}
              {missingPrice > 0 && <div style={{ color: '#dc2626' }}>{missingPrice} ligne(s) sans prix : à saisir avant l'envoi.</div>}
              {data.invoice_total_ht != null && <div>Total produits du document : {fmtEur(data.invoice_total_ht)} HT</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <strong>{fmtEur(round2(linesTotal * discountFactor))} HT</strong>
              <button className="btn btn-secondary" onClick={reset} disabled={sending}>Annuler</button>
              <button className="btn btn-primary" onClick={send} disabled={sending || !sendable.length || missingPrice > 0 || !reference.trim()}>
                {sending ? 'Création…' : `Créer la commande (${sendable.length} lignes)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
