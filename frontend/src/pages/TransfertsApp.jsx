import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { Transfer as TransferIcon } from '../components/AppIcons';
import { API_URL, authHeaders, C, Chip } from '../components/picking/pickingUi';
import { SHOPS } from '../components/boutique/shops';

/**
 * Transferts de stock — /transferts, droit `transferts` (27/11/2026).
 *
 * Le site donne aux boutiques, les boutiques donnent au site. On compose un
 * brouillon (scan ou recherche), puis on ENVOIE : le stock sort tout de suite de
 * l'origine, et une commande « en attente de réception » est créée chez le
 * destinataire. Le stock n'entre qu'à la validation de cette réception, là où
 * elle se fait déjà : Boutique › Commandes, ou l'app Réception pour le site.
 * Coût = coût d'achat du site, figé à l'envoi (refacturation, export CSV).
 */

const TEAL = '#0F766E';
const TEAL_L = '#CCFBF1';
const SHOP_BY_ID = Object.fromEntries(Object.values(SHOPS).map((s) => [s.id, s]));
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const money = (v) => (v == null ? '—' : eur.format(v));
const when = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const parisToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const monthStart = () => `${parisToday().slice(0, 8)}01`;
const errText = (e) => e?.response?.data?.error || e?.message || 'Erreur';

const btn = (variant = 'primary') => ({
  padding: '9px 16px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  border: variant === 'ghost' ? `1px solid ${C.greyB}` : 'none',
  background: variant === 'primary' ? TEAL : variant === 'danger' ? C.red : C.white,
  color: variant === 'ghost' ? C.dark : C.white,
});
const small = { padding: '5px 10px', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${C.greyB}`, background: C.white, color: C.dark };
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${C.greyB}` };
const td = { padding: '9px 12px', fontSize: 13.5, color: C.dark, borderBottom: `1px solid ${C.greyB}`, verticalAlign: 'middle' };
const panel = { background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 14, padding: 18 };
const field = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 14, fontFamily: 'inherit', background: C.white };

const Banner = ({ kind, children, onClose }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13.5,
    background: kind === 'error' ? C.redL : C.greenL, color: kind === 'error' ? C.red : C.green, whiteSpace: 'pre-line',
  }}>
    <span style={{ flex: 1 }}>{children}</span>
    {onClose && <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}>×</button>}
  </div>
);

/** État affiché d'un transfert : brouillon, sorties, commande, réception. */
const stateOf = (t) => {
  if (t.status === 'draft') return { label: 'Brouillon', color: C.greyT, bg: C.grey };
  if (t.out_errors > 0) return { label: 'Sortie de stock en erreur', color: C.red, bg: C.redL };
  if (t.order_status === 'error') return { label: 'Commande non créée', color: C.red, bg: C.redL };
  if (t.out_pending > 0) return { label: 'Sortie de stock en cours', color: C.amber, bg: C.amberL };
  if (t.reception === 'received') return { label: 'Reçu', color: C.green, bg: C.greenL };
  if (t.reception === 'partial') return { label: 'Réception partielle', color: C.blue, bg: C.blueL };
  if (t.reception === 'cancelled') return { label: 'Commande annulée', color: C.red, bg: C.redL };
  return { label: 'En attente de réception', color: TEAL, bg: TEAL_L };
};

const OUT = {
  queued: { label: 'En file', color: C.amber, bg: C.amberL },
  sending: { label: 'Envoi…', color: C.amber, bg: C.amberL },
  sent: { label: 'Sortie faite', color: C.green, bg: C.greenL },
  error: { label: 'Erreur', color: C.red, bg: C.redL },
};

/** Où se fait la réception de ce transfert. */
const receptionPlace = (t) => {
  if (t.direction === 'site_to_shop') {
    const s = SHOP_BY_ID[t.warehouse_id];
    return { to: `/boutique/${s?.slug}/commandes`, label: `Boutique ${s?.label} › Commandes` };
  }
  return { to: '/reception', label: 'app Réception (site)' };
};

const unitOf = (direction) => (direction === 'site_to_shop' ? 'article(s) du site' : 'pièce(s) boutique');

// ── Liste ───────────────────────────────────────────────────────────────────

const NEW_CHOICES = [
  ...Object.values(SHOPS).map((s) => ({ direction: 'site_to_shop', shop: s.slug, label: `Site → ${s.label}` })),
  ...Object.values(SHOPS).map((s) => ({ direction: 'shop_to_site', shop: s.slug, label: `${s.label} → site` })),
];

function ListView({ token, canWrite, setMessage }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [filters, setFilters] = useState({ shop: '', direction: '', from: monthStart(), to: parisToday() });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
      const { data } = await axios.get(`${API_URL}/transferts?${params}`, authHeaders(token));
      setRows(data);
    } catch (e) {
      setMessage({ kind: 'error', text: errText(e) });
    }
  }, [token, filters, setMessage]);
  useEffect(() => { load(); }, [load]);

  const create = async (choice) => {
    setCreating(true);
    try {
      const { data } = await axios.post(`${API_URL}/transferts`, { direction: choice.direction, shop: choice.shop }, authHeaders(token));
      navigate(`/transferts/${data.id}`);
    } catch (e) {
      setMessage({ kind: 'error', text: errText(e) });
    } finally {
      setCreating(false);
    }
  };

  const exportCsv = async () => {
    try {
      const res = await axios.get(`${API_URL}/transferts/export?from=${filters.from}&to=${filters.to}`, { ...authHeaders(token), responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transferts-${filters.from}-${filters.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage({ kind: 'error', text: 'Export impossible : vérifiez la période.' });
    }
  };

  const sent = (rows || []).filter((r) => r.status === 'sent');
  const totalHt = sent.reduce((s, r) => s + (r.total_ht || 0), 0);

  return (
    <>
      {canWrite && (
        <div style={{ ...panel, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.greyT, marginBottom: 10 }}>NOUVEAU TRANSFERT</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {NEW_CHOICES.map((c) => (
              <button key={`${c.direction}-${c.shop}`} disabled={creating} onClick={() => create(c)} style={btn(c.direction === 'site_to_shop' ? 'primary' : 'ghost')}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={filters.shop} onChange={(e) => setFilters({ ...filters, shop: e.target.value })} style={field}>
          <option value="">Toutes les boutiques</option>
          {Object.values(SHOPS).map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
        </select>
        <select value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })} style={field}>
          <option value="">Les deux sens</option>
          <option value="site_to_shop">Site → boutique</option>
          <option value="shop_to_site">Boutique → site</option>
        </select>
        <span style={{ fontSize: 13, color: C.greyT }}>Envoyés du</span>
        <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} style={field} />
        <span style={{ fontSize: 13, color: C.greyT }}>au</span>
        <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} style={field} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13.5, color: C.dark }}>{sent.length} envoyé(s) · <strong>{money(totalHt)} HT</strong></span>
        <button onClick={exportCsv} style={btn('ghost')}>Exporter (refacturation)</button>
      </div>

      <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Réf.</th><th style={th}>Sens</th><th style={th}>État</th><th style={th}>Lignes</th>
              <th style={th}>Quantité</th><th style={th}>Montant HT</th><th style={th}>Envoyé</th><th style={th}>Commande</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td style={td} colSpan={8}>Chargement…</td></tr>}
            {rows?.length === 0 && <tr><td style={{ ...td, color: C.greyT }} colSpan={8}>Aucun transfert sur cette période.</td></tr>}
            {(rows || []).map((t) => {
              const st = stateOf(t);
              return (
                <tr key={t.id} onClick={() => navigate(`/transferts/${t.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={td}><strong>{t.reference}</strong>{t.note && <div style={{ fontSize: 11.5, color: C.greyT }}>{t.note}</div>}</td>
                  <td style={td}>{t.label}</td>
                  <td style={td}><Chip color={st.color} bg={st.bg}>{st.label}</Chip></td>
                  <td style={td}>{t.lines}</td>
                  <td style={td}>{t.direction === 'site_to_shop' ? t.qty_site : t.qty_shop}</td>
                  <td style={td}>{t.status === 'sent' ? money(t.total_ht) : '—'}</td>
                  <td style={td}>{t.status === 'sent' ? <>{when(t.sent_at)}<div style={{ fontSize: 11.5, color: C.greyT }}>{t.sent_by_name}</div></> : <span style={{ color: C.greyT }}>créé {when(t.created_at)}</span>}</td>
                  <td style={td}>{t.order ? <>{t.order.reference}<div style={{ fontSize: 11.5, color: C.greyT }}>{t.order.received}/{t.order.ordered} reçu(s)</div></> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Saisie d'une ligne (brouillon) ──────────────────────────────────────────

function AddProduct({ token, transfer, onChanged, setMessage }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const qtyRef = useRef(null);

  const lookup = async (code) => {
    const v = String(code || '').trim();
    if (!v) return;
    setBusy(true);
    try {
      const { data } = await axios.get(`${API_URL}/transferts/${transfer.id}/lookup?q=${encodeURIComponent(v)}`, authHeaders(token));
      setFound(data);
      if (data.product) {
        const start = data.product.inDraft
          ? (transfer.direction === 'site_to_shop' ? data.product.inDraft.qty_site : data.product.inDraft.qty_shop) + (data.qty || 1) * (transfer.direction === 'site_to_shop' ? 1 : data.product.per)
          : (data.qty || 1) * (transfer.direction === 'site_to_shop' ? 1 : data.product.per);
        setQty(String(start));
        setTimeout(() => qtyRef.current?.select(), 0);
      }
    } catch (e) {
      setFound(null);
      setMessage({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const pick = async (id) => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API_URL}/transferts/${transfer.id}/lookup?q=${encodeURIComponent(id)}`, authHeaders(token));
      // Un SKU exact renvoie la fiche ; sinon on reste sur la liste
      if (data.product) {
        setFound(data);
        setQty(String(transfer.direction === 'site_to_shop' ? 1 : data.product.per));
      }
    } catch (e) {
      setMessage({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!found?.product) return;
    setBusy(true);
    try {
      await axios.put(`${API_URL}/transferts/${transfer.id}/lines/${found.product.id}`, { qty: Number(qty) }, authHeaders(token));
      setFound(null);
      setQ('');
      onChanged();
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e) {
      setMessage({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const p = found?.product;
  const isSiteOrigin = transfer.direction === 'site_to_shop';
  return (
    <div style={{ ...panel, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(q); } }}
          placeholder="Scannez un code-barres, ou tapez un SKU / un nom puis Entrée"
          style={{ ...field, flex: 1, fontSize: 15 }}
        />
        <button onClick={() => lookup(q)} disabled={busy} style={btn()}>Chercher</button>
      </div>

      {found && !p && (
        <div style={{ marginTop: 12 }}>
          {found.results.length === 0
            ? <div style={{ color: C.greyT, fontSize: 13.5 }}>Aucun produit trouvé.</div>
            : found.results.map((r) => (
              <div key={r.id} onClick={() => pick(r.sku || r.id)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 4px', borderBottom: `1px solid ${C.greyB}`, cursor: 'pointer' }}>
                {r.imageUrl ? <img src={r.imageUrl} alt="" style={{ width: 34, height: 34, objectFit: 'contain' }} /> : <span style={{ width: 34 }} />}
                <span style={{ flex: 1, fontSize: 13.5 }}>{r.name}<span style={{ color: C.greyT }}> · {r.sku}</span></span>
                {r.brand && <span style={{ fontSize: 12, color: C.greyT }}>{r.brand}</span>}
              </div>
            ))}
        </div>
      )}

      {p && (
        <div style={{ marginTop: 14, display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 8, border: `1px solid ${C.greyB}` }} />}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
            <div style={{ fontSize: 12.5, color: C.greyT }}>{p.sku}{p.brand ? ` · ${p.brand}` : ''} · coût site {money(p.unitCost)} HT</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              Caisse : {p.nx
                ? <strong>{p.nx.name}</strong>
                : <span style={{ color: C.red }}>{p.nxHow === 'ambiguous' ? 'plusieurs fiches possibles' : 'aucune fiche caisse'} — à rattacher ou créer dans Boutique › Catalogue caisse</span>}
            </div>
            {p.per > 1 && (
              <div style={{ fontSize: 13, marginTop: 4, color: C.amber }}>
                Le site vend ce produit par {p.per} : 1 article du site = {p.per} pièces boutique.
              </div>
            )}
            <div style={{ fontSize: 13, marginTop: 4, color: C.greyT }}>
              {isSiteOrigin
                ? (p.siteStock?.error
                  ? `Stock du site illisible (${p.siteStock.error})`
                  : `Libre au site : ${p.siteStock?.free ?? '—'} (physique ${p.siteStock?.physical ?? '—'}, réservé ${p.siteStock?.reserved ?? '—'})`)
                : `Stock en boutique : ${p.nx?.stock ?? '—'} (relu en direct à l'envoi)`}
              {p.inDraft && <> · déjà {isSiteOrigin ? p.inDraft.qty_site : p.inDraft.qty_shop} sur ce transfert</>}
            </div>
          </div>
          {p.nx && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                ref={qtyRef} type="number" min="1" step={isSiteOrigin ? 1 : p.per} value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
                style={{ ...field, width: 90, fontSize: 16, fontWeight: 700 }}
              />
              <span style={{ fontSize: 12.5, color: C.greyT }}>{unitOf(transfer.direction)}</span>
              <button onClick={save} disabled={busy} style={btn()}>{p.inDraft ? 'Mettre à jour' : 'Ajouter'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Fiche d'un transfert ────────────────────────────────────────────────────

function DetailView({ token, id, canWrite, setMessage }) {
  const navigate = useNavigate();
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/transferts/${id}`, authHeaders(token));
      setT(data);
      setNote(data.note || '');
    } catch (e) {
      setMessage({ kind: 'error', text: errText(e) });
    }
  }, [token, id, setMessage]);
  useEffect(() => { load(); }, [load]);

  // Sorties en cours : on relit jusqu'à ce qu'elles soient faites
  useEffect(() => {
    if (!t || t.status !== 'sent' || !t.out_pending) return undefined;
    const timer = setTimeout(load, 4000);
    return () => clearTimeout(timer);
  }, [t, load]);

  const act = async (fn, okText) => {
    setBusy(true);
    try {
      const { data } = await fn();
      if (data && data.id) setT(data); else await load();
      if (okText) setMessage({ kind: 'ok', text: okText });
    } catch (e) {
      setMessage({ kind: 'error', text: errText(e) });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!t) return <p style={{ color: C.greyT }}>Chargement…</p>;
  const draft = t.status === 'draft';
  const editable = draft && canWrite;
  const st = stateOf(t);
  const place = receptionPlace(t);
  const isSiteOrigin = t.direction === 'site_to_shop';
  const estimate = t.items.reduce((s, i) => s + (draft ? (i.current_cost || 0) : (i.unit_cost_ht || 0)) * i.qty_site, 0);

  const setLine = (productId, qty) => act(() => axios.put(`${API_URL}/transferts/${t.id}/lines/${productId}`, { qty }, authHeaders(token)));
  const send = () => {
    const where = isSiteOrigin ? 'du stock du site' : `du stock de la boutique ${SHOP_BY_ID[t.warehouse_id]?.label}`;
    if (!window.confirm(`Envoyer ${t.reference} (${t.label}) ?\n\nLes ${t.items.length} produit(s) sortent tout de suite ${where}, et une commande attendra la réception dans ${place.label}.`)) return;
    act(() => axios.post(`${API_URL}/transferts/${t.id}/send`, {}, authHeaders(token)), 'Transfert envoyé : le stock sort de l\'origine, la commande attend sa réception.');
  };
  const cancel = async () => {
    if (!window.confirm('Abandonner ce brouillon ? Rien n\'a bougé dans les stocks.')) return;
    try {
      await axios.post(`${API_URL}/transferts/${t.id}/cancel`, {}, authHeaders(token));
      navigate('/transferts');
    } catch (e) {
      setMessage({ kind: 'error', text: errText(e) });
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/transferts')} style={btn('ghost')}>← Transferts</button>
        <h2 style={{ margin: 0, fontSize: 20, color: C.dark }}>{t.reference} · {t.label}</h2>
        <Chip color={st.color} bg={st.bg}>{st.label}</Chip>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13.5 }}>{draft ? 'Estimation' : 'Montant'} : <strong>{money(Math.round(estimate * 100) / 100)} HT</strong></span>
      </div>

      {draft ? (
        <div style={{ ...panel, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, color: C.greyT }}>
            Brouillon : rien ne bouge tant qu'il n'est pas envoyé. Quantités en <strong>{unitOf(t.direction)}</strong>.
          </span>
          <span style={{ flex: 1 }} />
          {editable && (
            <>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (facultatif)"
                onBlur={() => note !== (t.note || '') && act(() => axios.put(`${API_URL}/transferts/${t.id}`, { note }, authHeaders(token)))}
                style={{ ...field, width: 240 }} />
              <button onClick={cancel} disabled={busy} style={btn('ghost')}>Abandonner</button>
              <button onClick={send} disabled={busy || !t.items.length} style={btn()}>Envoyer le transfert</button>
            </>
          )}
        </div>
      ) : (
        <div style={{ ...panel, marginBottom: 16, fontSize: 13.5, lineHeight: 1.6 }}>
          <div>Envoyé le {when(t.sent_at)}{t.sent_by_name ? ` par ${t.sent_by_name}` : ''}{t.note ? ` · ${t.note}` : ''}.</div>
          {t.order_status === 'created' && t.order && (
            <div>
              Commande <strong>{t.order.reference}</strong> : {t.order.received}/{t.order.ordered} pièce(s) reçue(s).
              {t.reception !== 'received' && <> À réceptionner dans <Link to={place.to}>{place.label}</Link>.</>}
            </div>
          )}
          {t.order_status === 'pending' && <div style={{ color: C.amber }}>Commande de réception en cours de création…</div>}
          {t.order_status === 'error' && (
            <div style={{ marginTop: 6, padding: 10, borderRadius: 8, background: C.redL, color: C.red, whiteSpace: 'pre-line' }}>
              <strong>La commande de réception n'a pas été créée.</strong> Le stock est bien sorti de l'origine.{'\n'}{t.order_error}
              {canWrite && (
                <div style={{ marginTop: 8 }}>
                  <button disabled={busy} style={small}
                    onClick={() => act(() => axios.post(`${API_URL}/transferts/${t.id}/retry-order`, {}, authHeaders(token)), 'Commande créée.')}>
                    Réessayer de créer la commande
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {editable && <AddProduct token={token} transfer={t} onChanged={load} setMessage={setMessage} />}

      <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Produit</th><th style={th}>Fiche caisse</th>
              <th style={th}>Articles site</th><th style={th}>Pièces boutique</th>
              <th style={th}>Coût site HT</th><th style={th}>Total HT</th>
              <th style={th}>{draft ? (isSiteOrigin ? 'Stock site' : 'Stock boutique') : 'Sortie du stock'}</th>
              {editable && <th style={th} />}
            </tr>
          </thead>
          <tbody>
            {t.items.length === 0 && <tr><td style={{ ...td, color: C.greyT }} colSpan={8}>Aucun produit : scannez ou cherchez-en un ci-dessus.</td></tr>}
            {t.items.map((i) => {
              const cost = draft ? i.current_cost : i.unit_cost_ht;
              const out = OUT[i.out_status];
              return (
                <tr key={i.id}>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {i.image_url && <img src={i.image_url} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />}
                      <div>{i.name}<div style={{ fontSize: 11.5, color: C.greyT }}>{i.sku}</div></div>
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 12.5 }}>{i.nx_name || '—'}</td>
                  <td style={td}>
                    {editable && isSiteOrigin
                      ? <QtyInput value={i.qty_site} onSave={(v) => setLine(i.product_id, v)} disabled={busy} />
                      : i.qty_site}
                  </td>
                  <td style={td}>
                    {editable && !isSiteOrigin
                      ? <QtyInput value={i.qty_shop} onSave={(v) => setLine(i.product_id, v)} disabled={busy} />
                      : i.qty_shop}
                  </td>
                  <td style={td}>{money(cost)}{draft && <div style={{ fontSize: 11, color: C.greyT }}>figé à l'envoi</div>}</td>
                  <td style={td}>{cost == null ? '—' : money(Math.round(cost * i.qty_site * 100) / 100)}</td>
                  <td style={td}>
                    {draft
                      ? (isSiteOrigin ? (i.site_stock ?? '—') : (i.shop_stock ?? '—'))
                      : out && (
                        <div>
                          <Chip color={out.color} bg={out.bg}>{out.label}</Chip>
                          {i.out_status === 'error' && (
                            <div style={{ fontSize: 12, color: C.red, marginTop: 4, maxWidth: 320 }}>
                              {i.out_error}
                              {canWrite && (
                                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                  <button style={small} disabled={busy}
                                    onClick={() => act(() => axios.post(`${API_URL}/transferts/${t.id}/items/${i.id}/resolve`, { action: 'retry' }, authHeaders(token)))}>
                                    Réessayer
                                  </button>
                                  <button style={small} disabled={busy}
                                    onClick={() => window.confirm('Déclarer cette sortie faite à la main (dans BMS ou la caisse) ?')
                                      && act(() => axios.post(`${API_URL}/transferts/${t.id}/items/${i.id}/resolve`, { action: 'done' }, authHeaders(token)))}>
                                    Faite à la main
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                  </td>
                  {editable && (
                    <td style={td}>
                      <button style={small} disabled={busy} onClick={() => setLine(i.product_id, 0)}>Retirer</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function QtyInput({ value, onSave, disabled }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const commit = () => { if (Number(v) !== value && v !== '') onSave(Number(v)); };
  return (
    <input type="number" min="1" value={v} disabled={disabled}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      style={{ ...field, width: 76, padding: '5px 8px' }} />
  );
}

export default function TransfertsApp() {
  const { token, permissions, isSuperAdmin } = useContext(AuthContext);
  const canWrite = isSuperAdmin || permissions?.transferts?.write === true;
  const { id } = useParams();
  const [message, setMessage] = useState(null);

  return (
    <AppShell currentPath="/transferts">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 60px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, background: TEAL,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <TransferIcon size={24} color="#fff" />
            </span>
            <h1 style={{ margin: 0, fontFamily: "'Tilt Warp', cursive", fontSize: 26, fontWeight: 900, color: C.primary }}>
              Transferts de stock
            </h1>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: C.greyT }}>Le stock sort à l'envoi, il entre à la réception</span>
          </div>

          {message && <Banner kind={message.kind} onClose={() => setMessage(null)}>{message.text}</Banner>}

          {id
            ? <DetailView key={id} token={token} id={id} canWrite={canWrite} setMessage={setMessage} />
            : <ListView token={token} canWrite={canWrite} setMessage={setMessage} />}
        </div>
      </main>
    </AppShell>
  );
}
