import { Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { Picking as PickingIcon } from '../components/AppIcons';
import { formatDate, formatDateUTC } from '../utils/dateUtils';
import { getCountryName } from '../utils/countries';
import CorrectionModal from '../components/picking/CorrectionModal';
import {
  API_URL, authHeaders, C, CORRECTION_TAGS, carrierKey, carrierLabel,
  CarrierLogo, CountryFlag, Chip, CountBadge,
} from '../components/picking/pickingUi';

/**
 * Picking — groupe « Prépa de commande ».
 *
 * Lot 1 : la liste des commandes à préparer et les vagues. Les commandes
 * viennent de BMS (ce qui reste à expédier), la disponibilité est calculée par
 * l'app (stock physique réparti par date de paiement), les vagues sont créées
 * par les règles (récapitulatif avant création) ou à la main.
 *
 * Choix d'écran tranchés avec Pierre le 28/09/2026 :
 *   - Bloquée = toujours manuel. Un problème d'adresse ou de point relais est un
 *     tag avec « Corriger » : la ligne reste dans son onglet, sans case à cocher ;
 *   - les partielles ne partent en vague qu'à la main ;
 *   - le tag « Ticket » est informatif, il ne bloque rien.
 */

const ORDER_TABS = [
  { key: 'en_cours', label: 'En cours' },
  { key: 'partielle', label: 'Partielle' },
  { key: 'hors_stock', label: 'Hors stock' },
  { key: 'bloquee', label: 'Bloquée' },
];

const WAVE_TABS = [
  { key: 'new', label: 'Nouvelles vagues' },
  { key: 'picking', label: 'En cours de picking' },
  { key: 'done', label: 'Terminées' },
];

const MAIN_KEY = 'yv.picking.main';

const readPref = (key, fallback) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const writePref = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* navigation privée */ }
};

const btn = (variant = 'ghost') => ({
  padding: '8px 14px', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
  border: variant === 'ghost' ? `1px solid ${C.greyB}` : 'none',
  background: variant === 'primary' ? C.violet : variant === 'danger' ? C.red : C.white,
  color: variant === 'ghost' ? C.dark : C.white,
});

const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${C.greyB}` };
const td = { padding: '10px 12px', fontSize: 13.5, color: C.dark, borderBottom: `1px solid ${C.greyB}`, verticalAlign: 'middle' };

const Tabs = ({ tabs, active, counts, onChange, big }) => (
  <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.greyB}`, marginBottom: 16, flexWrap: 'wrap' }}>
    {tabs.map(t => {
      const on = t.key === active;
      return (
        <button key={t.key} onClick={() => onChange(t.key)} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: big ? '10px 18px' : '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
          fontSize: big ? 15.5 : 14, fontWeight: on ? 700 : 500, color: on ? C.violet : C.greyT,
          borderBottom: `3px solid ${on ? C.violet : 'transparent'}`, marginBottom: -1,
        }}>
          {t.label}
          {counts && <CountBadge n={counts[t.key] ?? 0} active={on} />}
        </button>
      );
    })}
  </div>
);

const Modal = ({ children, onClose }) => (
  <div onClick={onClose} style={{
    position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  }}>
    <div onClick={e => e.stopPropagation()} style={{
      background: C.white, borderRadius: 14, width: '100%', maxWidth: 480, padding: 22,
      boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
    }}>{children}</div>
  </div>
);

const Banner = ({ kind, children, onClose }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13.5,
    background: kind === 'error' ? C.redL : C.greenL, color: kind === 'error' ? C.red : C.green,
  }}>
    <span style={{ flex: 1 }}>{children}</span>
    {onClose && <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}>×</button>}
  </div>
);

// ── Onglet Commandes ────────────────────────────────────────────────────────

function OrdersView({ token, canWrite, onWavesCreated, setMessage }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('en_cours');
  const [country, setCountry] = useState('');
  const [carrier, setCarrier] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [correcting, setCorrecting] = useState(null);
  const [blocking, setBlocking] = useState(null);
  const [blockReason, setBlockReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: d } = await axios.get(`${API_URL}/picking/orders`, authHeaders(token));
      setData(d);
      setSelected(prev => new Set([...prev].filter(n => d.orders.some(o => o.orderNumber === n && o.selectable))));
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    } finally {
      setLoading(false);
    }
  }, [token, setMessage]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await axios.post(`${API_URL}/picking/refresh`, {}, authHeaders(token));
      await load();
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    } finally {
      setRefreshing(false);
    }
  };

  const inTab = useMemo(() => (data?.orders || []).filter(o => o.bucket === tab), [data, tab]);

  // Les filtres ne proposent que ce qui est présent dans l'onglet, avec le nombre.
  const countryOptions = useMemo(() => {
    const m = new Map();
    inTab.forEach(o => m.set(o.country || '', (m.get(o.country || '') || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [inTab]);
  const carrierOptions = useMemo(() => {
    const m = new Map();
    inTab.forEach(o => {
      const k = carrierKey(o.carrier);
      const cur = m.get(k) || { label: carrierLabel(o.carrier), n: 0 };
      cur.n += 1;
      m.set(k, cur);
    });
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [inTab]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inTab.filter(o =>
      (!country || (o.country || '') === country)
      && (!carrier || carrierKey(o.carrier) === carrier)
      && (!q || o.orderNumber.includes(q) || (o.name || '').toLowerCase().includes(q))
    );
  }, [inTab, country, carrier, search]);

  const changeTab = (k) => {
    setTab(k);
    setCountry('');
    setCarrier('');
    setSelected(new Set());
  };

  const toggle = (n) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(n)) next.delete(n); else next.add(n);
    return next;
  });
  const selectable = shown.filter(o => o.selectable);
  const allChecked = selectable.length > 0 && selectable.every(o => selected.has(o.orderNumber));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectable.map(o => o.orderNumber)));

  const openPreview = async () => {
    setBusy(true);
    try {
      const { data: p } = await axios.get(`${API_URL}/picking/waves/preview`, authHeaders(token));
      setPreview(p);
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  };

  const created = (list) => {
    const n = list.reduce((s, w) => s + w.orders, 0);
    setMessage({ kind: 'ok', text: `${list.length} vague(s) créée(s) : ${list.map(w => w.waveNumber).join(', ')} — ${n} commande(s).` });
    setSelected(new Set());
    load();
    onWavesCreated();
  };

  const generate = async () => {
    setBusy(true);
    try {
      const { data: r } = await axios.post(`${API_URL}/picking/waves/generate`, {}, authHeaders(token));
      setPreview(null);
      created(r.created);
    } catch (err) {
      setPreview(null);
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  };

  const createManual = async () => {
    setBusy(true);
    try {
      const { data: r } = await axios.post(`${API_URL}/picking/waves/manual`, { orderNumbers: [...selected] }, authHeaders(token));
      created(r.created);
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
      load();
    } finally {
      setBusy(false);
    }
  };

  const submitBlock = async () => {
    try {
      await axios.post(`${API_URL}/picking/orders/${blocking.orderNumber}/block`, { reason: blockReason }, authHeaders(token));
      setBlocking(null);
      setBlockReason('');
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  };

  const unblock = async (o) => {
    try {
      await axios.delete(`${API_URL}/picking/orders/${o.orderNumber}/block`, authHeaders(token));
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  };

  if (loading) return <p style={{ color: C.greyT }}>Chargement des commandes…</p>;
  if (!data) return null;

  const nonSelectableReason = (o) => {
    if (o.blocked) return 'Commande bloquée';
    if (o.tags.length) return CORRECTION_TAGS[o.tags[0]];
    if (o.bmsWaveId) return `Déjà dans la vague BMS ${o.bmsWaveId}`;
    return 'Hors stock : pas de vague possible';
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, fontSize: 13, color: C.greyT, flexWrap: 'wrap' }}>
        <span>
          Relevé BMS : {data.syncedAt ? formatDateUTC(data.syncedAt) : 'jamais'} · actualisé toutes les 5 min (9h-19h, lun-ven)
        </span>
        <button onClick={refresh} disabled={refreshing} style={{ ...btn(), padding: '5px 12px', fontSize: 12.5 }}>
          {refreshing ? 'Actualisation…' : '↻ Actualiser'}
        </button>
      </div>
      {data.syncError && <Banner kind="error">{data.syncError}</Banner>}

      <Tabs tabs={ORDER_TABS} active={tab} counts={data.counts} onChange={changeTab} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={country} onChange={e => setCountry(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13.5 }}>
          <option value="">Tous les pays</option>
          {countryOptions.map(([cc, n]) => (
            <option key={cc || '-'} value={cc}>{cc ? getCountryName(cc) : 'Pays inconnu'} ({n})</option>
          ))}
        </select>
        <select value={carrier} onChange={e => setCarrier(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13.5 }}>
          <option value="">Tous les transporteurs</option>
          {carrierOptions.map(([k, v]) => <option key={k} value={k}>{v.label} ({v.n})</option>)}
        </select>
        <input
          value={search} onChange={e => setSearch(e.target.value)} placeholder="N° de commande ou nom"
          style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13.5, minWidth: 200 }}
        />
        <span style={{ flex: 1 }} />
        {canWrite && (
          <button onClick={openPreview} disabled={busy} style={btn('primary')}>Générer les vagues</button>
        )}
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 36 }}>
                {canWrite && <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={selectable.length === 0} />}
              </th>
              <th style={th}>Commande</th>
              <th style={th}>Client</th>
              <th style={th}>Pays</th>
              <th style={th}>Transporteur</th>
              <th style={th}>Payée le</th>
              <th style={th}>Articles</th>
              <th style={th}>Tags</th>
              {canWrite && <th style={th} />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: C.greyT, padding: 28 }}>Aucune commande dans cet onglet.</td></tr>
            )}
            {shown.map((o, i) => {
              const checked = selected.has(o.orderNumber);
              return (
                <tr key={o.orderNumber} style={{ background: checked ? C.rowSel : i % 2 ? C.zebra : C.white }}>
                  <td style={td}>
                    {canWrite && (
                      <input
                        type="checkbox" checked={checked} disabled={!o.selectable}
                        title={o.selectable ? '' : nonSelectableReason(o)}
                        onChange={() => toggle(o.orderNumber)}
                      />
                    )}
                  </td>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <Link to={`/orders/${o.orderNumber}`} style={{ color: C.primary, textDecoration: 'none' }}>{o.orderNumber}</Link>
                  </td>
                  <td style={td}>{o.name || <span style={{ color: C.greyM }}>—</span>}</td>
                  <td style={td}><CountryFlag code={o.country} /></td>
                  <td style={td}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <CarrierLogo carrier={o.carrier} />
                      <span style={{ fontSize: 11.5, color: C.greyT }}>{o.shippingMethod}</span>
                    </div>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDate(o.paidAt)}</td>
                  <td style={td}>
                    {o.missing > 0
                      ? <span title={`${o.missing} article(s) non couvert(s) par le stock`}>{o.items - o.missing}/{o.items}</span>
                      : o.items}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {o.tags.map(t => (
                        <Chip key={t} color={C.amber} bg={C.amberL}>
                          {CORRECTION_TAGS[t]}
                          {canWrite && t !== 'commande_absente' && (
                            <button onClick={() => setCorrecting(o)} style={{
                              marginLeft: 4, border: 'none', borderRadius: 999, padding: '1px 8px',
                              background: C.amber, color: C.white, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                            }}>Corriger</button>
                          )}
                        </Chip>
                      ))}
                      {o.tickets.map(t => (
                        <Link key={t.id} to={`/tickets/${t.id}`} style={{ textDecoration: 'none' }}>
                          <Chip color={C.blue} bg={C.blueL} title={`Ticket #${t.id} — ${t.status}`}>Ticket</Chip>
                        </Link>
                      ))}
                      {o.bmsWaveId && <Chip color={C.greyT} bg={C.greyB} title="Préparée dans BMS">Vague BMS {o.bmsWaveId}</Chip>}
                      {o.blocked && (
                        <Chip color={C.red} bg={C.redL} title={`Bloquée${o.blocked.by ? ` par ${o.blocked.by}` : ''} le ${formatDateUTC(o.blocked.at)}`}>
                          {o.blocked.reason}
                        </Chip>
                      )}
                    </div>
                  </td>
                  {canWrite && (
                    <td style={{ ...td, textAlign: 'right' }}>
                      {o.blocked
                        ? <button onClick={() => unblock(o)} style={{ ...btn(), padding: '4px 10px', fontSize: 12 }}>Débloquer</button>
                        : <button onClick={() => { setBlocking(o); setBlockReason(''); }} style={{ ...btn(), padding: '4px 10px', fontSize: 12 }}>Bloquer</button>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canWrite && selected.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 16, marginTop: 16, display: 'flex', alignItems: 'center', gap: 14,
          background: C.dark, color: C.white, borderRadius: 12, padding: '12px 18px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
        }}>
          <strong>{selected.size} commande(s) sélectionnée(s)</strong>
          <span style={{ flex: 1 }} />
          <button onClick={() => setSelected(new Set())} style={{ ...btn(), background: 'transparent', color: C.white, borderColor: '#4B5563' }}>Désélectionner</button>
          <button onClick={createManual} disabled={busy} style={btn('primary')}>Créer une vague</button>
        </div>
      )}

      {preview && (
        <Modal onClose={() => setPreview(null)}>
          <h2 style={{ margin: '0 0 12px', fontSize: 18, color: C.primary }}>Générer les vagues</h2>
          {preview.waves === 0 ? (
            <p style={{ fontSize: 14 }}>Aucune commande « En cours » libre ne correspond aux règles actives.</p>
          ) : (
            <>
              <p style={{ fontSize: 16, margin: '0 0 12px' }}>
                <strong>{preview.orders}</strong> commande(s) concernée(s), <strong>{preview.waves}</strong> vague(s).
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
                <tbody>
                  {preview.rules.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...td, fontWeight: 600 }}>{r.name} <span style={{ color: C.greyT, fontWeight: 400 }}>({r.prefix})</span></td>
                      <td style={td}>{r.orders} cmd</td>
                      <td style={{ ...td, color: C.greyT }}>{r.waveSizes.length} vague(s) : {r.waveSizes.join(' + ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button onClick={() => setPreview(null)} style={btn()}>Annuler</button>
            {preview.waves > 0 && <button onClick={generate} disabled={busy} style={btn('primary')}>Créer {preview.waves} vague(s)</button>}
          </div>
        </Modal>
      )}

      {blocking && (
        <Modal onClose={() => setBlocking(null)}>
          <h2 style={{ margin: '0 0 12px', fontSize: 18, color: C.primary }}>Bloquer la commande {blocking.orderNumber}</h2>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Motif (obligatoire)</label>
          <textarea
            value={blockReason} onChange={e => setBlockReason(e.target.value)} rows={3} autoFocus
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, padding: 10, borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 14 }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
            <button onClick={() => setBlocking(null)} style={btn()}>Annuler</button>
            <button onClick={submitBlock} disabled={!blockReason.trim()} style={btn('danger')}>Bloquer</button>
          </div>
        </Modal>
      )}

      {correcting && (
        <CorrectionModal
          order={correcting} token={token}
          onClose={() => setCorrecting(null)}
          onSaved={() => { setCorrecting(null); load(); }}
        />
      )}
    </>
  );
}

// ── Onglet Vagues ───────────────────────────────────────────────────────────

function WavesView({ token, canWrite, reloadKey, setMessage }) {
  const [tab, setTab] = useState('new');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: d } = await axios.get(`${API_URL}/picking/waves?tab=${tab}`, authHeaders(token));
      setData(d);
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  }, [tab, token, setMessage]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const toggleDetail = async (w) => {
    if (open === w.id) { setOpen(null); return; }
    setOpen(w.id);
    setDetail(null);
    try {
      const { data: d } = await axios.get(`${API_URL}/picking/waves/${w.id}`, authHeaders(token));
      setDetail(d);
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  };

  const cancel = async (w) => {
    if (!window.confirm(`Annuler la vague ${w.waveNumber} ? Ses ${w.orders} commande(s) redeviennent libres.`)) return;
    try {
      await axios.post(`${API_URL}/picking/waves/${w.id}/cancel`, {}, authHeaders(token));
      setMessage({ kind: 'ok', text: `Vague ${w.waveNumber} annulée.` });
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  };

  return (
    <>
      <Tabs tabs={WAVE_TABS} active={tab} counts={data?.counts} onChange={(k) => { setTab(k); setOpen(null); }} />
      <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Vague</th>
              <th style={th}>Créée le</th>
              <th style={th}>Par</th>
              <th style={th}>Origine</th>
              <th style={th}>Commandes</th>
              <th style={th}>Transporteurs</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={7} style={{ ...td, color: C.greyT }}>Chargement…</td></tr>}
            {data && data.waves.length === 0 && (
              <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: C.greyT, padding: 28 }}>Aucune vague.</td></tr>
            )}
            {data?.waves.map((w, i) => (
              <Fragment key={w.id}>
                <tr style={{ background: open === w.id ? C.rowSel : i % 2 ? C.zebra : C.white }}>
                  <td style={{ ...td, fontWeight: 700, fontFamily: 'monospace', fontSize: 14 }}>{w.waveNumber}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDateUTC(w.createdAt)}</td>
                  <td style={td}>{w.createdBy || '—'}</td>
                  <td style={td}>{w.ruleName || 'Manuelle'}</td>
                  <td style={td}>{w.orders}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      {w.carriers.map(c => <CarrierLogo key={`${c.carrierCode}:${c.accountCode}`} carrier={c} height={18} />)}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => toggleDetail(w)} style={{ ...btn(), padding: '4px 10px', fontSize: 12 }}>
                      {open === w.id ? 'Masquer' : 'Détail'}
                    </button>
                    {canWrite && w.status === 'new' && (
                      <button onClick={() => cancel(w)} style={{ ...btn(), padding: '4px 10px', fontSize: 12, marginLeft: 6, color: C.red }}>Annuler</button>
                    )}
                  </td>
                </tr>
                {open === w.id && (
                  <tr>
                    <td colSpan={7} style={{ ...td, background: C.grey, padding: '8px 16px 14px' }}>
                      {!detail ? 'Chargement…' : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <tbody>
                            {detail.orders.map(o => (
                              <tr key={o.orderNumber}>
                                <td style={{ ...td, width: 40, color: C.greyT }}>{o.position ?? ''}</td>
                                <td style={{ ...td, fontWeight: 600 }}>
                                  <Link to={`/orders/${o.orderNumber}`} style={{ color: C.primary, textDecoration: 'none' }}>{o.orderNumber}</Link>
                                </td>
                                <td style={td}>{o.name}</td>
                                <td style={td}><CountryFlag code={o.country} /></td>
                                <td style={td}><CarrierLogo carrier={o.carrier} height={18} /></td>
                                <td style={{ ...td, color: C.greyT }}>{o.shippingMethod}</td>
                                <td style={td}>{!o.stillToShip && <Chip color={C.green} bg={C.greenL}>Expédiée</Chip>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function PickingApp() {
  const { token, permissions, isSuperAdmin } = useContext(AuthContext);
  const canWrite = isSuperAdmin || permissions?.picking?.write === true;
  const [main, setMain] = useState(() => readPref(MAIN_KEY, 'orders'));
  const [message, setMessage] = useState(null);
  const [wavesReload, setWavesReload] = useState(0);

  const changeMain = (k) => { setMain(k); writePref(MAIN_KEY, k); };

  return (
    <AppShell currentPath="/picking">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 60px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, background: C.violet,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <PickingIcon size={24} color="#fff" />
            </span>
            <h1 style={{ margin: 0, fontFamily: "'Tilt Warp', cursive", fontSize: 26, fontWeight: 900, color: C.primary }}>
              Picking
            </h1>
          </div>

          {message && <Banner kind={message.kind} onClose={() => setMessage(null)}>{message.text}</Banner>}

          <Tabs
            big
            tabs={[{ key: 'orders', label: 'Commandes' }, { key: 'waves', label: 'Vagues' }]}
            active={main}
            onChange={changeMain}
          />

          {main === 'orders'
            ? <OrdersView token={token} canWrite={canWrite} setMessage={setMessage} onWavesCreated={() => setWavesReload(n => n + 1)} />
            : <WavesView token={token} canWrite={canWrite} reloadKey={wavesReload} setMessage={setMessage} />}
        </div>
      </main>
    </AppShell>
  );
}
