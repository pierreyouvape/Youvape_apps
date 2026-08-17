import { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE (alignée Rapport / SAV) ───────────────────── */
const C = {
  primary: '#135E84', accent: '#E28F00', accentL: '#FDF3E2',
  green: '#16A34A', greenL: '#DCFCE7', red: '#DC2626', redL: '#FEE2E2',
  orange: '#EA580C', orangeL: '#FFEDD5',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#111827', white: '#FFFFFF',
  zebra: '#F4F7F9', // alternance des lignes — assez marqué pour suivre une ligne
};                  // sur toute sa largeur, assez discret pour ne pas concurrencer
                    // les fonds de statut du comptage.

const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

const fmtDate = (s) => {
  if (!s) return '—';
  // Les dates sont stockées en heure locale Paris : pas de new Date() sur la chaîne
  // brute, on découpe (cf. utils/dateUtils du reste de l'app).
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : '—';
};

const PREF_KEY = 'yv.reception.askBarcodeType';

/* ─── PETITS COMPOSANTS ─────────────────────────────────── */
function Th({ children, align = 'left', width }) {
  return <th style={{ padding: '12px 16px', textAlign: align, width, fontWeight: 700, color: C.greyT,
    fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3,
    borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children, align = 'left', bold, color, style }) {
  return <td style={{ padding: '12px 16px', textAlign: align, color: color || C.dark,
    fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 14, ...style }}>{children}</td>;
}
function Btn({ children, onClick, variant = 'primary', disabled, small, title, style }) {
  const variants = {
    primary: { background: C.primary, color: '#fff', border: 'none' },
    accent:  { background: C.accent, color: '#fff', border: 'none' },
    ghost:   { background: '#fff', color: C.primary, border: `1px solid ${C.greyB}` },
    danger:  { background: '#fff', color: C.red, border: `1px solid ${C.red}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      ...variants[variant], padding: small ? '5px 11px' : '9px 17px', borderRadius: 8,
      fontWeight: 600, fontSize: small ? 12.5 : 13.5,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      whiteSpace: 'nowrap', ...style,
    }}>{children}</button>
  );
}
/**
 * Vignette produit. Plus grande qu'ailleurs dans l'app (100 px contre 40) : en
 * réception, la photo sert à identifier physiquement l'article qu'on a en main.
 * D'où aussi `contain` plutôt que `cover` — à cette taille un recadrage masquerait
 * l'étiquette, donc le dosage, qui est souvent le seul écart entre deux références.
 */
function Thumb({ src, alt, size = 100 }) {
  const base = { width: size, height: size, borderRadius: 8, flexShrink: 0 };
  if (!src) {
    return <div style={{ ...base, background: C.greyB, display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', color: C.greyM,
      fontSize: Math.round(size / 3) }}>?</div>;
  }
  return <img src={src} alt={alt || ''} loading="lazy"
    style={{ ...base, objectFit: 'contain', border: `1px solid ${C.greyB}`,
      background: '#fff', padding: 3 }} />;
}

/**
 * Emplacement de rangement dans l'entrepôt principal. Stocké en base et rafraîchi
 * chaque nuit depuis BMS : aucun appel réseau ici, la donnée arrive avec le détail.
 */
function Location({ value }) {
  if (value) {
    return <span style={{ display: 'inline-block', padding: '4px 9px', borderRadius: 6,
      background: C.grey, border: `1px solid ${C.greyB}`, fontSize: 13, fontWeight: 700,
      color: C.primary, letterSpacing: 0.4, whiteSpace: 'nowrap' }}>{value}</span>;
  }
  return <span style={{ color: C.greyM, fontSize: 13 }}>—</span>;
}

function Badge({ children, color, bg }) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999,
    fontSize: 11.5, fontWeight: 700, color, background: bg, whiteSpace: 'nowrap' }}>{children}</span>;
}
function Modal({ title, children, onClose, width = 560 }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.white, borderRadius: 14, width: '100%',
        maxWidth: width, maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.greyB}` }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.primary }}>{title}</h3>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>
  );
}

const STATUS_LABEL = {
  sent:      { label: 'Envoyée',   color: '#1D4ED8', bg: '#DBEAFE' },
  // « Attendue » et non « Confirmée » : le statut traduit l'état `expected` de BMS,
  // pas un accusé de réception du fournisseur. Même libellé que l'app d'achat.
  confirmed: { label: 'Attendue', color: C.primary, bg: '#E0F2FE' },
  partial:   { label: 'Partielle', color: C.orange,  bg: C.orangeL },
};

/* ─── ÉCRAN 1 — LISTE ───────────────────────────────────── */
function OrdersList({ token, onOpen }) {
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API_URL}/reception/suppliers`, authHeaders(token))
      .then(r => setSuppliers(r.data.data || [])).catch(() => {});
  }, [token]);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (supplierId) p.set('supplier_id', supplierId);
    if (search.trim()) p.set('search', search.trim());
    const t = setTimeout(() => {
      axios.get(`${API_URL}/reception/orders?${p}`, authHeaders(token))
        .then(r => setOrders(r.data.data || []))
        .catch(() => setOrders([]))
        .finally(() => setLoading(false));
    }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [token, supplierId, search]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: C.primary, margin: 0 }}>Réception</h1>
        <p style={{ color: C.greyT, margin: '4px 0 0', fontSize: 13.5 }}>
          Commandes fournisseur en attente de réception.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${C.greyB}`,
            fontSize: 13.5, color: C.dark, background: '#fff', minWidth: 220 }}>
          <option value="">Tous les fournisseurs</option>
          {suppliers.map(s => (
            <option key={s.id} value={s.id}>{s.name} ({s.nb_orders})</option>
          ))}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un n° de commande…"
          style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${C.greyB}`,
            fontSize: 13.5, minWidth: 260, flex: 1, maxWidth: 380 }} />
      </div>

      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>N° de commande</Th>
                <Th>Fournisseur</Th>
                <Th>Statut</Th>
                <Th align="right">Lignes</Th>
                <Th align="right">Attendu</Th>
                <Th align="right">Reçu</Th>
                <Th>Livraison prévue</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><Td align="center" style={{ padding: 40, color: C.greyT }}>Chargement…</Td></tr>
              )}
              {!loading && orders.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: C.greyT, fontSize: 14 }}>
                  Aucune commande en attente de réception.
                </td></tr>
              )}
              {!loading && orders.map((o, idx) => {
                const st = STATUS_LABEL[o.status] || { label: o.status, color: C.greyT, bg: C.grey };
                return (
                  <tr key={o.id} onClick={() => onOpen(o.id)}
                    style={{ cursor: 'pointer', background: idx % 2 === 1 ? C.zebra : C.white }}>
                    <Td bold color={C.primary}>{o.order_number}</Td>
                    <Td>{o.supplier_name}</Td>
                    <Td><Badge color={st.color} bg={st.bg}>{st.label}</Badge></Td>
                    <Td align="right">{o.nb_lines}</Td>
                    <Td align="right" bold>{o.qty_expected}</Td>
                    <Td align="right" color={o.qty_received > 0 ? C.orange : C.greyM}>{o.qty_received}</Td>
                    <Td>{fmtDate(o.expected_date || o.order_date)}</Td>
                    <Td align="right"><Btn small variant="ghost">Ouvrir</Btn></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── ÉCRAN 2 — DÉTAIL ──────────────────────────────────── */
function OrderDetail({ order, items, onBack, onStart }) {
  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <Btn variant="ghost" small onClick={onBack} style={{ marginBottom: 16 }}>← Retour</Btn>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexWrap: 'wrap', gap: 14, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 23, fontWeight: 800, color: C.primary, margin: 0 }}>
            {order.order_number}
          </h1>
          <p style={{ color: C.greyT, margin: '4px 0 0', fontSize: 13.5 }}>
            {order.supplier_name} · {items.length} ligne{items.length > 1 ? 's' : ''} ·
            {' '}livraison prévue le {fmtDate(order.expected_date || order.order_date)}
          </p>
        </div>
        <Btn variant="accent" onClick={onStart}>Réceptionner</Btn>
      </div>

      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th width={116} />
                <Th>Produit</Th>
                <Th>Réf. fournisseur</Th>
                <Th>Emplacement</Th>
                <Th align="right">Commandé</Th>
                <Th align="right">Par pack</Th>
                <Th align="right">Total unités</Th>
                <Th align="right">Déjà reçu</Th>
                <Th align="right">Reste</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.id} style={{ background: idx % 2 === 1 ? C.zebra : C.white }}>
                  <Td><Thumb src={it.image_url} alt={it.name} /></Td>
                  <Td>
                    {it.name}
                    {it.pack_qty > 1 && (
                      <span style={{ marginLeft: 8 }}>
                        <Badge color={C.accent} bg={C.accentL}>carton de {it.pack_qty}</Badge>
                      </span>
                    )}
                  </Td>
                  <Td color={C.greyT}>{it.supplier_sku || it.sku || '—'}</Td>
                  <Td><Location value={it.shelf_location} /></Td>
                  <Td align="right">{it.qty_ordered}</Td>
                  <Td align="right" color={it.units_per_qty > 1 ? C.accent : C.greyM}>
                    {it.units_per_qty > 1 ? `× ${it.units_per_qty}` : '—'}
                  </Td>
                  <Td align="right" bold>{it.qty_expected}</Td>
                  <Td align="right" color={it.qty_received > 0 ? C.orange : C.greyM}>{it.qty_received}</Td>
                  <Td align="right" bold color={it.qty_remaining > 0 ? C.dark : C.green}>{it.qty_remaining}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── ÉCRAN 3 — COMPTAGE ────────────────────────────────── */
function CountingScreen({ token, order, items, onBack, onReload }) {
  // counts : { [itemId]: nombre d'unités comptées lors de CETTE réception }
  const [counts, setCounts] = useState(() =>
    Object.fromEntries(items.map(i => [i.id, 0])));
  const [askType, setAskType] = useState(() => localStorage.getItem(PREF_KEY) !== 'off');
  const [scanBuffer, setScanBuffer] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [typeModal, setTypeModal] = useState(null);    // { item, barcode, packQty }
  const [unknownModal, setUnknownModal] = useState(null); // { barcode }
  const [diffModal, setDiffModal] = useState(false);
  const [motifs, setMotifs] = useState({});            // { [itemId]: 'reliquat'|'solde'|'manquant' }

  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const toggleAsk = () => {
    setAskType(prev => {
      const next = !prev;
      localStorage.setItem(PREF_KEY, next ? 'on' : 'off');
      return next;
    });
  };

  const flash = (msg, isError) => {
    if (isError) { setError(msg); setMessage(null); setTimeout(() => setError(null), 3500); }
    else { setMessage(msg); setError(null); setTimeout(() => setMessage(null), 2000); }
  };

  const addCount = useCallback((itemId, delta) => {
    setCounts(prev => ({ ...prev, [itemId]: Math.max(0, (prev[itemId] || 0) + delta) }));
  }, []);

  const setCount = useCallback((itemId, value) => {
    setCounts(prev => ({ ...prev, [itemId]: Math.max(0, parseInt(value) || 0) }));
  }, []);

  // Résolution d'un scan, côté client : les codes-barres sont embarqués dans la
  // commande, donc un bip n'entraîne aucun aller-retour réseau.
  const handleScan = useCallback((code) => {
    const value = String(code).trim();
    if (!value) return;
    const list = itemsRef.current;

    let found = null, matched = null;
    for (const it of list) {
      const bc = (it.barcodes || []).find(b => String(b.barcode).trim() === value);
      if (bc) { found = it; matched = bc; break; }
    }

    if (!found) {
      // Code inconnu de cette commande : l'opérateur choisit la ligne concernée.
      setUnknownModal({ barcode: value });
      return;
    }

    if (matched.type === 'pack') {
      const step = parseInt(matched.quantity) || 1;
      addCount(found.id, step);
      flash(`${found.name} — pack de ${step}`);
      return;
    }

    // Code typé « unité » sur un produit acheté au carton : seul cas ambigu.
    if (found.ambiguous && askType) {
      setTypeModal({ item: found, barcode: value, packQty: found.pack_qty });
      return;
    }

    addCount(found.id, 1);
    flash(`${found.name} — +1`);
  }, [addCount, askType]);

  // Capture clavier globale (douchette) — ignorée quand on saisit dans un champ
  // ou qu'une pop-up est ouverte.
  useEffect(() => {
    const blocked = () => typeModal || unknownModal || diffModal;
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || blocked()) return;
      if (e.key === 'Enter') {
        setScanBuffer(buf => { if (buf) handleScan(buf); return ''; });
        e.preventDefault();
      } else if (e.key.length === 1) {
        setScanBuffer(buf => buf + e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleScan, typeModal, unknownModal, diffModal]);

  // Enregistre durablement le type d'un code-barre (requalification unité <-> pack)
  const persistBarcode = async (wpProductId, barcode, type, quantity) => {
    try {
      await axios.post(`${API_URL}/products/${wpProductId}/barcodes`,
        { barcode, type, ...(type === 'pack' ? { quantity } : {}) }, authHeaders(token));
      onReload();
    } catch {
      flash('Le type du code-barre n\'a pas pu être enregistré', true);
    }
  };

  // Le fond d'une ligne porte l'état de son comptage : il prime sur le zébrage, qui
  // ne s'applique donc qu'aux lignes encore vierges. Sinon l'alternance viendrait
  // concurrencer le signal orange/vert/rouge, qui est l'information utile ici.
  const rowColors = (it, idx) => {
    const counted = counts[it.id] || 0;
    const target = it.qty_remaining;
    if (counted === 0) return { background: idx % 2 === 1 ? C.zebra : C.white };
    if (counted > target) return { background: C.redL };
    if (counted === target) return { background: C.greenL };
    return { background: C.orangeL };
  };

  const missing = items.filter(i => (counts[i.id] || 0) < i.qty_remaining);
  const surplus = items.filter(i => (counts[i.id] || 0) > i.qty_remaining);
  const totalCounted = items.reduce((s, i) => s + (counts[i.id] || 0), 0);
  const totalExpected = items.reduce((s, i) => s + i.qty_remaining, 0);
  const allMotifsSet = missing.every(i => motifs[i.id]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <Btn variant="ghost" small onClick={onBack} style={{ marginBottom: 16 }}>← Retour</Btn>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 23, fontWeight: 800, color: C.primary, margin: 0 }}>
            Comptage — {order.order_number}
          </h1>
          <p style={{ color: C.greyT, margin: '4px 0 0', fontSize: 13.5 }}>
            {order.supplier_name} · {totalCounted} / {totalExpected} unités comptées
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5,
            color: C.greyT, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={askType} onChange={toggleAsk} />
            Demander le type au scan
          </label>
          <Btn variant="accent" onClick={() => setDiffModal(true)} disabled={totalCounted === 0}>
            Valider
          </Btn>
        </div>
      </div>

      {/* Zone de scan */}
      <div style={{ background: C.primary, color: '#fff', borderRadius: 12, padding: '16px 20px',
        marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {scanBuffer ? `Scan : ${scanBuffer}` : 'Scannez un article — ou saisissez les quantités à la main'}
        </div>
        {message && <Badge color={C.green} bg="#fff">{message}</Badge>}
        {error && <Badge color={C.red} bg="#fff">{error}</Badge>}
      </div>

      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th width={116} />
                <Th>Produit</Th>
                <Th>Emplacement</Th>
                <Th align="right">Attendu</Th>
                <Th align="center" width={230}>Compté</Th>
                <Th align="right">Écart</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const counted = counts[it.id] || 0;
                const ecart = counted - it.qty_remaining;
                return (
                  <tr key={it.id} style={rowColors(it, idx)}>
                    <Td><Thumb src={it.image_url} alt={it.name} /></Td>
                    <Td>
                      {it.name}
                      {it.pack_qty > 1 && (
                        <span style={{ marginLeft: 8 }}>
                          <Badge color={C.accent} bg={C.accentL}>carton de {it.pack_qty}</Badge>
                        </span>
                      )}
                      <div style={{ fontSize: 11.5, color: C.greyT, marginTop: 2 }}>
                        {it.supplier_sku || it.sku}
                      </div>
                    </Td>
                    <Td><Location value={it.shelf_location} /></Td>
                    <Td align="right" bold>
                      {it.qty_remaining}
                      {/* L'ecran de comptage reste lean : la decomposition est rappelee
                          sous le total plutot qu'en colonnes, pour ne pas encombrer
                          l'ecran de travail du scan. */}
                      {it.units_per_qty > 1 && (
                        <div style={{ fontSize: 11, fontWeight: 500, color: C.greyT, marginTop: 2 }}>
                          {it.qty_ordered} × {it.units_per_qty}
                        </div>
                      )}
                    </Td>
                    <Td align="center">
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                        <Btn small variant="ghost" title="Remettre à zéro"
                          onClick={() => setCount(it.id, 0)}>Rien</Btn>
                        <input type="number" min="0" value={counted}
                          onChange={e => setCount(it.id, e.target.value)}
                          style={{ width: 74, padding: '6px 8px', textAlign: 'center', fontSize: 14,
                            fontWeight: 700, borderRadius: 7, border: `1px solid ${C.greyB}` }} />
                        <Btn small variant="ghost" title="Tout réceptionner"
                          onClick={() => setCount(it.id, it.qty_remaining)}>Tout</Btn>
                      </div>
                    </Td>
                    <Td align="right" bold
                      color={ecart === 0 ? C.green : ecart > 0 ? C.red : C.orange}>
                      {ecart === 0 ? '—' : ecart > 0 ? `+${ecart}` : ecart}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pop-up : code typé unité sur un produit acheté au carton */}
      {typeModal && (
        <TypeModal
          data={typeModal}
          onClose={() => setTypeModal(null)}
          onChoose={async (type, qty) => {
            const step = type === 'pack' ? qty : 1;
            addCount(typeModal.item.id, step);
            await persistBarcode(typeModal.item.wp_product_id, typeModal.barcode, type, qty);
            flash(`${typeModal.item.name} — ${type === 'pack' ? `pack de ${qty}` : '+1'}`);
            setTypeModal(null);
          }}
        />
      )}

      {/* Pop-up : code-barre inconnu → choix de la ligne */}
      {unknownModal && (
        <UnknownModal
          barcode={unknownModal.barcode}
          items={items.filter(i => (counts[i.id] || 0) < i.qty_remaining)}
          onClose={() => setUnknownModal(null)}
          onAttach={async (item, type, qty) => {
            const step = type === 'pack' ? qty : 1;
            addCount(item.id, step);
            await persistBarcode(item.wp_product_id, unknownModal.barcode, type, qty);
            flash(`${item.name} — code rattaché`);
            setUnknownModal(null);
          }}
        />
      )}

      {/* Pop-up : écarts */}
      {diffModal && (
        <Modal title="Des différences ont été trouvées" onClose={() => setDiffModal(false)} width={680}>
          {missing.length === 0 && surplus.length === 0 ? (
            <p style={{ fontSize: 14, color: C.dark, margin: '0 0 18px' }}>
              Aucun écart — la réception correspond exactement à la commande.
            </p>
          ) : (
            <>
              {missing.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                    gap: 12, margin: '0 0 10px' }}>
                    <h4 style={{ fontSize: 13, fontWeight: 800, color: C.orange, margin: 0,
                      textTransform: 'uppercase', letterSpacing: 0.3 }}>
                      Manquants ({missing.length})
                    </h4>
                    {/* Une livraison partielle laisse des dizaines de lignes non livrées :
                        les basculer d'un coup en reliquat évite autant de menus déroulants. */}
                    <Btn small variant="ghost"
                      onClick={() => setMotifs(m => {
                        const next = { ...m };
                        missing.forEach(i => { if (!next[i.id]) next[i.id] = 'reliquat'; });
                        return next;
                      })}>
                      Tout en reliquat
                    </Btn>
                  </div>
                  {missing.map(it => (
                    <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                      padding: '9px 0', borderBottom: `1px solid ${C.greyB}` }}>
                      <div style={{ flex: 1, fontSize: 13.5 }}>
                        {it.name}
                        <span style={{ color: C.greyT }}>
                          {' '}— {counts[it.id] || 0} / {it.qty_remaining}
                          {' '}(manque {it.qty_remaining - (counts[it.id] || 0)})
                        </span>
                      </div>
                      <select value={motifs[it.id] || ''}
                        onChange={e => setMotifs(m => ({ ...m, [it.id]: e.target.value }))}
                        style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13,
                          border: `1px solid ${motifs[it.id] ? C.greyB : C.red}`, background: '#fff' }}>
                        <option value="">Motif…</option>
                        <option value="reliquat">Reliquat</option>
                        <option value="solde">Soldé</option>
                        <option value="manquant">Manquant</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
              {surplus.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 800, color: C.red, margin: '0 0 10px',
                    textTransform: 'uppercase', letterSpacing: 0.3 }}>Surplus</h4>
                  {surplus.map(it => (
                    <div key={it.id} style={{ padding: '9px 0', borderBottom: `1px solid ${C.greyB}`, fontSize: 13.5 }}>
                      {it.name}
                      <span style={{ color: C.greyT }}>
                        {' '}— {counts[it.id]} reçus pour {it.qty_remaining} attendus
                        {' '}(+{counts[it.id] - it.qty_remaining})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div style={{ background: C.accentL, border: `1px solid ${C.accent}`, borderRadius: 9,
            padding: '11px 14px', fontSize: 12.5, color: '#7C4A00', marginBottom: 18 }}>
            L'envoi vers BMS n'est pas encore activé : la conversion des lignes en carton
            reste à valider sur une commande de test. Le comptage n'est donc pas enregistré.
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setDiffModal(false)}>Recompter</Btn>
            <Btn variant="accent" disabled={!allMotifsSet} title={!allMotifsSet ? 'Renseignez un motif pour chaque manquant' : undefined}>
              Valider
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ─── POP-UP : unité ou pack ? ──────────────────────────── */
function TypeModal({ data, onClose, onChoose }) {
  const [qty, setQty] = useState(data.packQty || 1);
  return (
    <Modal title="Ce code-barre est celui de l'unité ou du carton ?" onClose={onClose}>
      <p style={{ fontSize: 14, color: C.dark, margin: '0 0 6px' }}>{data.item.name}</p>
      <p style={{ fontSize: 12.5, color: C.greyT, margin: '0 0 18px' }}>
        Code <strong>{data.barcode}</strong> · ce produit est acheté par carton de {data.packQty}.
        Votre réponse est enregistrée : la question ne sera plus posée.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn variant="ghost" onClick={() => onChoose('unit', 1)}>Unité (+1)</Btn>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn variant="accent" onClick={() => onChoose('pack', Math.max(1, parseInt(qty) || 1))}>
            Pack de
          </Btn>
          <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
            style={{ width: 82, padding: '8px 10px', textAlign: 'center', fontSize: 14, fontWeight: 700,
              borderRadius: 7, border: `1px solid ${C.greyB}` }} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── POP-UP : code-barre inconnu ───────────────────────── */
function UnknownModal({ barcode, items, onClose, onAttach }) {
  const [selected, setSelected] = useState(null);
  const [type, setType] = useState('unit');
  const [qty, setQty] = useState(1);
  const item = items.find(i => i.id === selected);

  useEffect(() => { if (item && item.pack_qty > 1) setQty(item.pack_qty); }, [item]);

  return (
    <Modal title="Code-barre inconnu" onClose={onClose} width={640}>
      <p style={{ fontSize: 12.5, color: C.greyT, margin: '0 0 16px' }}>
        Le code <strong style={{ color: C.dark }}>{barcode}</strong> n'est associé à aucun article
        de cette commande. Choisissez l'article concerné — le code sera enregistré pour les
        prochaines réceptions.
      </p>

      <div style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${C.greyB}`,
        borderRadius: 9, marginBottom: 16 }}>
        {items.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: C.greyT, fontSize: 13.5 }}>
            Tous les articles de cette commande sont déjà comptés.
          </div>
        )}
        {items.map(it => (
          <div key={it.id} onClick={() => setSelected(it.id)} style={{
            padding: '10px 14px', cursor: 'pointer', fontSize: 13.5,
            borderBottom: `1px solid ${C.greyB}`,
            background: selected === it.id ? C.accentL : '#fff',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Thumb src={it.image_url} alt={it.name} size={90} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: selected === it.id ? 700 : 400 }}>{it.name}</div>
              <div style={{ fontSize: 11.5, color: C.greyT }}>
                {it.supplier_sku || it.sku} · reste {it.qty_remaining}
                {it.pack_qty > 1 && ` · carton de ${it.pack_qty}`}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <select value={type} onChange={e => setType(e.target.value)}
          style={{ padding: '8px 11px', borderRadius: 7, border: `1px solid ${C.greyB}`, fontSize: 13.5 }}>
          <option value="unit">Code unité</option>
          <option value="pack">Code pack</option>
        </select>
        {type === 'pack' && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: C.greyT }}>
            Quantité par pack
            <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
              style={{ width: 82, padding: '7px 9px', textAlign: 'center', fontSize: 14, fontWeight: 700,
                borderRadius: 7, border: `1px solid ${C.greyB}` }} />
          </label>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
        <Btn variant="accent" disabled={!item}
          onClick={() => onAttach(item, type, Math.max(1, parseInt(qty) || 1))}>
          Rattacher
        </Btn>
      </div>
    </Modal>
  );
}

/* ─── APP ───────────────────────────────────────────────── */
export default function ReceptionApp() {
  const { token, permissions } = useContext(AuthContext);
  const [view, setView] = useState('list');       // list | detail | counting
  const [orderId, setOrderId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  const canRead = permissions?.reception?.read === true;

  const loadDetail = useCallback((id) => {
    setLoading(true);
    return axios.get(`${API_URL}/reception/orders/${id}`, authHeaders(token))
      .then(r => setDetail(r.data.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [token]);


  const openOrder = (id) => { setOrderId(id); setView('detail'); loadDetail(id); };

  if (permissions && !canRead) {
    return (
      <AppShell currentPath="/reception">
        <div style={{ padding: '40px 32px', color: C.greyT }}>
          Vous n'avez pas accès à l'application Réception. Contactez un administrateur.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell currentPath="/reception">
      {view === 'list' && <OrdersList token={token} onOpen={openOrder} />}

      {view !== 'list' && loading && (
        <div style={{ padding: 40, color: C.greyT }}>Chargement…</div>
      )}

      {view === 'detail' && !loading && detail && (
        <OrderDetail
          order={detail.order}
          items={detail.items}
          onBack={() => { setView('list'); setDetail(null); }}
          onStart={() => setView('counting')}
        />
      )}

      {view === 'counting' && !loading && detail && (
        <CountingScreen
          token={token}
          order={detail.order}
          items={detail.items}
          onBack={() => setView('detail')}
          onReload={() => loadDetail(orderId)}
        />
      )}
    </AppShell>
  );
}
