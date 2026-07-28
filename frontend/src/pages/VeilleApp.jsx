import { useState, useEffect, useContext, useMemo, useCallback, Fragment } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  primary: '#135E84', accent: '#E28F00', accentL: '#FDF3E2',
  green: '#16A34A', red: '#DC2626', orange: '#EA580C', blue: '#2563EB',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#111827', white: '#FFFFFF',
};

const fmtEur = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = parseFloat(v);
  if (!isFinite(n)) return '—';
  return `${n.toFixed(2).replace('.', ',')} €`;
};

const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

/* ─── petits composants ──────────────────────────────────── */
function Th({ children, align = 'left' }) {
  return <th style={{ padding: '13px 18px', textAlign: align, fontWeight: 700, color: C.greyT, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children, align = 'left', color, bold, bg }) {
  return <td style={{ padding: '13px 18px', textAlign: align, color: color || C.dark, fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 14, background: bg }}>{children}</td>;
}
function Kpi({ value, label, color }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || C.primary }}>{value}</div>
      <div style={{ fontSize: 12.5, color: C.greyT, marginTop: 2 }}>{label}</div>
    </div>
  );
}
function Badge({ children, color, bg }) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color, background: bg, whiteSpace: 'nowrap' }}>{children}</span>;
}
function Btn({ children, onClick, variant = 'primary', disabled, small }) {
  const styles = {
    primary: { background: C.primary, color: '#fff', border: 'none' },
    accent: { background: C.accent, color: '#fff', border: 'none' },
    ghost: { background: '#fff', color: C.primary, border: `1px solid ${C.greyB}` },
    danger: { background: '#fff', color: C.red, border: `1px solid ${C.red}` },
  }[variant];
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...styles, padding: small ? '5px 10px' : '9px 16px', borderRadius: 8, fontWeight: 600,
      fontSize: small ? 12 : 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
      whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

/* Écart entre MON tarif remisé et le prix concurrent.
   Rouge = je suis plus cher, Vert = je suis moins cher, Gris = identique. */
function Ecart({ mine, comp }) {
  if (mine === null || mine === undefined || comp === null || comp === undefined) return <span style={{ color: C.greyM }}>—</span>;
  const m = parseFloat(mine), c = parseFloat(comp);
  const delta = m - c; // > 0 : je suis plus cher
  if (Math.abs(delta) < 0.005) return <Badge color={C.greyT} bg={C.grey}>= identique</Badge>;
  const pricier = delta > 0;
  return (
    <Badge color={pricier ? C.red : C.green} bg={pricier ? '#FEF2F2' : '#F0FDF4'}>
      {pricier ? '▲ +' : '▼ −'}{Math.abs(delta).toFixed(2).replace('.', ',')} € {pricier ? '(plus cher)' : '(moins cher)'}
    </Badge>
  );
}

function Variation({ current, previous }) {
  if (current === null || current === undefined || previous === null || previous === undefined) return <span style={{ color: C.greyM }}>—</span>;
  const cur = parseFloat(current), prev = parseFloat(previous);
  const delta = cur - prev;
  if (Math.abs(delta) < 0.005) return <Badge color={C.greyT} bg={C.grey}>=</Badge>;
  const up = delta > 0;
  const pct = prev ? (delta / prev) * 100 : 0;
  return (
    <Badge color={up ? C.red : C.green} bg={up ? '#FEF2F2' : '#F0FDF4'}>
      {up ? '▲' : '▼'} {delta > 0 ? '+' : ''}{delta.toFixed(2).replace('.', ',')} € ({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)
    </Badge>
  );
}

/* ─── historique (mini graphe) ───────────────────────────── */
function HistoryChart({ token, id }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    axios.get(`${API_URL}/competitors/${id}/history?limit=120`, authHeaders(token))
      .then(({ data }) => {
        const pts = data.filter(r => r.status === 'ok' && r.price != null).reverse()
          .map(r => ({ date: fmtDate(r.checked_at), prix: parseFloat(r.price) }));
        setData(pts);
      }).catch(() => setData([]));
  }, [id, token]);

  if (data === null) return <div style={{ padding: 16, color: C.greyT, fontSize: 13 }}>Chargement de l'historique…</div>;
  if (data.length < 2) return <div style={{ padding: 16, color: C.greyT, fontSize: 13 }}>Pas encore assez d'historique (relevés supplémentaires nécessaires).</div>;
  return (
    <div style={{ padding: '10px 16px 16px', background: C.grey }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT, marginBottom: 8 }}>Historique du prix</div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.greyB} />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} tickFormatter={(v) => `${v}€`} />
          <Tooltip formatter={(v) => fmtEur(v)} />
          <Line type="monotone" dataKey="prix" stroke={C.primary} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── page principale ────────────────────────────────────── */
export default function VeilleApp() {
  const { token } = useContext(AuthContext);
  const [rows, setRows] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [msg, setMsg] = useState(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);

  const loadDashboard = useCallback(async () => {
    const { data } = await axios.get(`${API_URL}/competitors/dashboard`, authHeaders(token));
    setRows(data);
  }, [token]);

  const loadConfig = useCallback(async () => {
    const { data } = await axios.get(`${API_URL}/competitors/config`, authHeaders(token));
    setConfig(data);
  }, [token]);

  useEffect(() => {
    (async () => {
      try { await Promise.all([loadDashboard(), loadConfig()]); }
      catch (e) { setMsg({ type: 'error', text: 'Erreur de chargement : ' + (e.response?.data?.error || e.message) }); }
      finally { setLoading(false); }
    })();
  }, [loadDashboard, loadConfig]);

  const runNow = async (notify) => {
    setRunning(true); setProgress({ done: 0, total: 0 });
    setMsg({ type: 'ok', text: 'Relevé lancé… récupération des prix en cours. Tu peux rester sur la page.' });
    try {
      await axios.post(`${API_URL}/competitors/run`, { notify }, authHeaders(token));
      // Le relevé tourne en arrière-plan : on suit la progression par polling.
      const poll = async () => {
        try {
          const { data } = await axios.get(`${API_URL}/competitors/run/status`, authHeaders(token));
          if (data.progress) setProgress(data.progress);
          if (data.running) { setTimeout(poll, 2000); return; }
          await loadDashboard();
          setProgress(null);
          if (data.error) {
            setMsg({ type: 'error', text: 'Erreur relevé : ' + data.error });
          } else if (data.result) {
            const r = data.result;
            const errTxt = r.errors?.length ? `, ${r.errors.length} en échec` : '';
            setMsg({ type: r.errors?.length ? 'warn' : 'ok', text: `Relevé terminé : ${r.ok}/${r.total} OK, ${r.changes} changement(s)${errTxt}.${notify ? ' Email envoyé si nouveautés.' : ''}` });
          }
          setRunning(false);
        } catch (e) {
          setMsg({ type: 'error', text: 'Erreur suivi relevé : ' + (e.response?.data?.error || e.message) });
          setRunning(false); setProgress(null);
        }
      };
      setTimeout(poll, 2000);
    } catch (e) {
      setMsg({ type: 'error', text: 'Erreur relevé : ' + (e.response?.data?.error || e.message) });
      setRunning(false); setProgress(null);
    }
  };

  const deleteRow = async (row) => {
    if (!window.confirm(`Retirer le suivi « ${row.product_name || row.sku} » chez ${row.competitor} ?`)) return;
    try { await axios.delete(`${API_URL}/competitors/${row.id}`, authHeaders(token)); await loadDashboard(); }
    catch (e) { setMsg({ type: 'error', text: 'Erreur suppression : ' + (e.response?.data?.error || e.message) }); }
  };

  /* KPIs */
  const kpis = useMemo(() => {
    const competitors = new Set(rows.map(r => r.competitor));
    const changes = rows.filter(r => r.previous_price != null && r.current_price != null && Math.abs(parseFloat(r.current_price) - parseFloat(r.previous_price)) >= 0.005).length;
    const errors = rows.filter(r => r.last_status === 'error').length;
    const pricier = rows.filter(r => r.my_price != null && r.current_price != null && parseFloat(r.my_price) - parseFloat(r.current_price) > 0.005).length;
    return { suivis: rows.length, competitors: competitors.size, changes, errors, pricier };
  }, [rows]);

  /* Regrouper par SKU */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter(r => (r.sku && r.sku.toLowerCase().includes(q))
          || (r.product_name && r.product_name.toLowerCase().includes(q))
          || (r.competitor && r.competitor.toLowerCase().includes(q)))
      : rows;
    const map = new Map();
    for (const r of filtered) {
      if (!map.has(r.sku)) map.set(r.sku, { sku: r.sku, name: r.product_name, items: [] });
      map.get(r.sku).items.push(r);
    }
    return Array.from(map.values());
  }, [rows, query]);

  if (loading) {
    return <AppShell currentPath="/veille"><div style={{ padding: 40, color: C.greyT }}>Chargement…</div></AppShell>;
  }

  return (
    <AppShell currentPath="/veille">
      <div style={{ padding: '24px 32px', maxWidth: 1560, margin: '0 auto' }}>
        {/* En-tête */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.primary, margin: 0 }}>Veille concurrentielle</h1>
            <p style={{ color: C.greyT, margin: '4px 0 0', fontSize: 13.5 }}>Suivi quotidien des prix concurrents · relevé automatique chaque jour à 8h.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Btn variant="ghost" small onClick={() => setShowDiscovery(s => !s)}>🔍 Découverte auto</Btn>
            <Btn variant="ghost" small onClick={() => setShowManage(s => !s)}>⚙️ Gérer les suivis</Btn>
            <Btn variant="ghost" small onClick={() => setShowSettings(s => !s)}>🔔 Réglages</Btn>
            <Btn variant="accent" onClick={() => runNow(false)} disabled={running}>{running ? 'Relevé en cours…' : '↻ Relever maintenant'}</Btn>
          </div>
        </div>

        {msg && (
          <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: msg.type === 'error' ? '#FEF2F2' : msg.type === 'warn' ? '#FFFBEB' : '#F0FDF4',
            color: msg.type === 'error' ? C.red : msg.type === 'warn' ? C.orange : C.green,
            border: `1px solid ${msg.type === 'error' ? '#FECACA' : msg.type === 'warn' ? '#FDE68A' : '#BBF7D0'}` }}>
            {msg.text}
          </div>
        )}

        {/* Barre de progression du relevé */}
        {running && progress && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: C.greyT, marginBottom: 4 }}>
              <span>Relevé en cours…</span>
              <span>{progress.total ? `${progress.done}/${progress.total}` : '…'}</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: C.greyB, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%`, background: C.accent, borderRadius: 999, transition: 'width 0.4s ease' }} />
            </div>
          </div>
        )}

        {/* KPIs */}
        <div style={{ display: 'flex', gap: 14, marginTop: 18, flexWrap: 'wrap' }}>
          <Kpi value={kpis.suivis} label="Suivis actifs" />
          <Kpi value={kpis.competitors} label="Concurrents" color={C.blue} />
          <Kpi value={kpis.changes} label="Prix modifiés (dernier relevé)" color={C.orange} />
          <Kpi value={kpis.pricier} label="Concurrents moins chers que moi" color={kpis.pricier ? C.red : C.green} />
          <Kpi value={kpis.errors} label="Relevés en échec" color={kpis.errors ? C.red : C.green} />
        </div>

        {/* Découverte / Suggestions */}
        {showDiscovery && <DiscoveryPanel token={token} onValidated={loadDashboard} />}

        {/* Réglages */}
        {showSettings && config && <SettingsPanel token={token} config={config} onSaved={loadConfig} />}

        {/* Gestion des suivis */}
        {showManage && <ManagePanel token={token} onChanged={loadDashboard} />}

        {/* Recherche */}
        <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.greyM, fontSize: 14 }}>🔎</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher par SKU, nom de produit ou concurrent…"
              style={{ width: '100%', padding: '10px 12px 10px 34px', borderRadius: 10, border: `1px solid ${C.greyB}`, fontSize: 13.5, boxSizing: 'border-box' }}
            />
            {query && (
              <span onClick={() => setQuery('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: C.greyM, fontSize: 16, cursor: 'pointer' }}>×</span>
            )}
          </div>
          {query && <span style={{ fontSize: 12.5, color: C.greyT }}>{groups.length} produit(s) trouvé(s)</span>}
        </div>

        {/* Tableau principal */}
        <div style={{ marginTop: 12, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '19%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <thead>
              <tr>
                <Th>Produit / Concurrent</Th>
                <Th align="right">Prix concurrent</Th>
                <Th align="right">Mon tarif</Th>
                <Th align="center">Écart (moi vs concurrent)</Th>
                <Th align="center">Variation concurrent</Th>
                <Th align="center">Dispo.</Th>
                <Th align="center">Relevé</Th>
                <Th align="center">État</Th>
                <Th align="center">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr><Td>Aucun suivi. Ajoutez-en via « Gérer les suivis ».</Td></tr>
              )}
              {groups.map((g) => (
                <Fragment key={`g-${g.sku}`}>
                  <tr>
                    <td colSpan={9} style={{ padding: '10px 12px', background: C.accentL, borderBottom: `1px solid ${C.greyB}`, fontWeight: 700, color: C.dark, fontSize: 13 }}>
                      {g.name || g.sku} <span style={{ color: C.greyM, fontWeight: 400, fontSize: 12 }}>· SKU {g.sku}</span>
                    </td>
                  </tr>
                  {g.items.map((r) => {
                    const isErr = r.last_status === 'error';
                    return (
                      <Fragment key={r.id}>
                        <tr key={r.id}>
                          <Td>
                            <a href={r.url} target="_blank" rel="noreferrer" style={{ color: C.primary, textDecoration: 'none', fontWeight: 600 }}>{r.competitor} ↗</a>
                          </Td>
                          <Td align="right" bold>
                            {fmtEur(r.current_price)}
                            {r.regular_price ? <div style={{ fontSize: 11, fontWeight: 400, color: C.greyM }}><s>{fmtEur(r.regular_price)}</s></div> : null}
                          </Td>
                          <Td align="right" bold>
                            {r.my_product_url
                              ? <a href={r.my_product_url} target="_blank" rel="noreferrer" title="Voir ma fiche produit (youvape.fr)" style={{ color: C.primary, textDecoration: 'none' }}>{fmtEur(r.my_price)} ↗</a>
                              : <span style={{ color: C.primary }}>{fmtEur(r.my_price)}</span>}
                          </Td>
                          <Td align="center"><Ecart mine={r.my_price} comp={r.current_price} /></Td>
                          <Td align="center"><Variation current={r.current_price} previous={r.previous_price} /></Td>
                          <Td align="center">
                            {r.in_stock === true ? <Badge color={C.green} bg="#F0FDF4">En stock</Badge>
                              : r.in_stock === false ? <Badge color={C.orange} bg="#FFFBEB">Rupture</Badge>
                              : <span style={{ color: C.greyM }}>—</span>}
                          </Td>
                          <Td align="center" color={C.greyT}>{fmtDate(r.last_checked_at)}</Td>
                          <Td align="center">
                            {isErr ? <Badge color={C.red} bg="#FEF2F2" title={r.last_error}>Échec</Badge>
                              : <Badge color={C.green} bg="#F0FDF4">OK</Badge>}
                          </Td>
                          <Td align="center">
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <Btn variant="ghost" small onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{expanded === r.id ? 'Masquer' : '📈'}</Btn>
                              <Btn variant="danger" small onClick={() => deleteRow(r)}>🗑</Btn>
                            </div>
                          </Td>
                        </tr>
                        {isErr && r.last_error && (
                          <tr key={`e-${r.id}`}><td colSpan={9} style={{ padding: '4px 12px 8px 12px', fontSize: 11.5, color: C.red, background: '#FFF7F7', borderBottom: `1px solid ${C.greyB}` }}>⚠ {r.last_error}</td></tr>
                        )}
                        {expanded === r.id && (
                          <tr key={`h-${r.id}`}><td colSpan={9} style={{ borderBottom: `1px solid ${C.greyB}` }}><HistoryChart token={token} id={r.id} /></td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                  <AddCompetitorRow token={token} group={g} existing={g.items.map(i => i.competitor)} onAdded={loadDashboard} />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

/* ─── ligne "ajouter un concurrent" sous chaque produit ──────── */
const KNOWN_COMPETITORS = ['levapoteur-discount', 'cigaretteelec'];

function AddCompetitorRow({ token, group, existing, onAdded }) {
  const [open, setOpen] = useState(false);
  const [competitor, setCompetitor] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const suggestions = KNOWN_COMPETITORS.filter(c => !existing.includes(c));

  const add = async () => {
    if (!competitor.trim() || !url.trim()) { setErr('Renseigne le concurrent et l’URL'); return; }
    setBusy(true); setErr(null);
    try {
      await axios.post(`${API_URL}/competitors`,
        { sku: group.sku, product_name: group.name, competitor: competitor.trim(), url: url.trim() }, authHeaders(token));
      setOpen(false); setCompetitor(''); setUrl(''); setBusy(false);
      await onAdded();
    } catch (e) { setErr(e.response?.data?.error || e.message); setBusy(false); }
  };

  const inp = { padding: '6px 9px', borderRadius: 7, border: `1px solid ${C.greyB}`, fontSize: 12.5 };
  return (
    <tr>
      <td colSpan={9} style={{ padding: '6px 12px 10px', borderBottom: `1px solid ${C.greyB}`, background: '#FCFCFD' }}>
        {!open ? (
          <span onClick={() => setOpen(true)} style={{ color: C.primary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            + Ajouter un concurrent pour ce produit
          </span>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input list="known-competitors" style={{ ...inp, width: 180 }} placeholder="Concurrent (ex: levapoteur-discount)" value={competitor} onChange={e => setCompetitor(e.target.value)} />
            <datalist id="known-competitors">{suggestions.map(c => <option key={c} value={c} />)}</datalist>
            <input style={{ ...inp, flex: 1, minWidth: 260 }} placeholder="URL de la fiche produit chez ce concurrent" value={url} onChange={e => setUrl(e.target.value)} />
            <Btn small onClick={add} disabled={busy}>{busy ? '…' : 'Ajouter'}</Btn>
            <Btn variant="ghost" small onClick={() => { setOpen(false); setErr(null); }} disabled={busy}>Annuler</Btn>
            {err && <span style={{ color: C.red, fontSize: 12 }}>{err}</span>}
          </div>
        )}
      </td>
    </tr>
  );
}

/* ─── panneau réglages ───────────────────────────────────── */
function SettingsPanel({ token, config, onSaved }) {
  const [email, setEmail] = useState(config.alert_email || '');
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState(config.enabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      const payload = { enabled, alert_email: email };
      if (key.trim()) payload.scraperapi_key = key.trim();
      await axios.put(`${API_URL}/competitors/config`, payload, authHeaders(token));
      setKey(''); setSaved(true);
      await onSaved();
    } finally { setSaving(false); }
  };

  const field = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13, width: '100%' };
  return (
    <div style={{ marginTop: 16, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, padding: 18 }}>
      <div style={{ fontWeight: 700, color: C.primary, marginBottom: 14 }}>🔔 Réglages de la veille</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12.5, color: C.greyT, fontWeight: 600 }}>Email des alertes</label>
          <input style={field} value={email} onChange={e => setEmail(e.target.value)} placeholder="ex: youvape34@gmail.com" />
        </div>
        <div>
          <label style={{ fontSize: 12.5, color: C.greyT, fontWeight: 600 }}>Clé ScraperAPI {config.scraperapi_key_set && <span style={{ color: C.green }}>· configurée ✓</span>}</label>
          <input style={field} type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={config.scraperapi_key_set ? '•••••• (laisser vide pour conserver)' : 'Coller la clé pour les sites bloqués'} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Relevé automatique quotidien activé
        </label>
        <div style={{ flex: 1 }} />
        {saved && <span style={{ color: C.green, fontSize: 13 }}>Enregistré ✓</span>}
        <Btn onClick={save} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Btn>
      </div>
    </div>
  );
}

/* ─── panneau gestion des suivis ─────────────────────────── */
function ManagePanel({ token, onChanged }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ sku: '', product_name: '', competitor: '', url: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API_URL}/competitors`, authHeaders(token));
    setItems(data);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form.sku || !form.competitor || !form.url) return;
    setBusy(true);
    try {
      await axios.post(`${API_URL}/competitors`, form, authHeaders(token));
      setForm({ sku: '', product_name: '', competitor: '', url: '' });
      await load(); await onChanged();
    } finally { setBusy(false); }
  };
  const toggle = async (it) => { await axios.put(`${API_URL}/competitors/${it.id}`, { active: !it.active }, authHeaders(token)); await load(); await onChanged(); };
  const del = async (it) => { if (!window.confirm(`Supprimer le suivi ${it.competitor} pour ${it.sku} ?`)) return; await axios.delete(`${API_URL}/competitors/${it.id}`, authHeaders(token)); await load(); await onChanged(); };

  const field = { padding: '7px 9px', borderRadius: 7, border: `1px solid ${C.greyB}`, fontSize: 12.5 };
  return (
    <div style={{ marginTop: 16, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, padding: 18 }}>
      <div style={{ fontWeight: 700, color: C.primary, marginBottom: 14 }}>⚙️ Gérer les suivis</div>

      {/* Ajout */}
      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 160px 2fr auto', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <input style={field} placeholder="SKU" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} />
        <input style={field} placeholder="Nom produit" value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value })} />
        <input style={field} placeholder="Concurrent" value={form.competitor} onChange={e => setForm({ ...form, competitor: e.target.value })} />
        <input style={field} placeholder="URL fiche concurrent" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
        <Btn onClick={add} disabled={busy} small>+ Ajouter</Btn>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><Th>SKU</Th><Th>Produit</Th><Th>Concurrent</Th><Th>URL</Th><Th align="center">Actif</Th><Th></Th></tr></thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id}>
              <Td>{it.sku}</Td>
              <Td>{it.product_name || '—'}</Td>
              <Td>{it.competitor}</Td>
              <Td><a href={it.url} target="_blank" rel="noreferrer" style={{ color: C.primary, fontSize: 12 }}>{it.url.length > 48 ? it.url.slice(0, 48) + '…' : it.url}</a></Td>
              <Td align="center"><input type="checkbox" checked={it.active} onChange={() => toggle(it)} /></Td>
              <Td align="center"><Btn variant="danger" small onClick={() => del(it)}>Suppr.</Btn></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── panneau découverte auto + suggestions ──────────────────── */
function ScoreBadge({ score }) {
  if (score === null || score === undefined) return null;
  const s = parseFloat(score);
  const color = s >= 0.85 ? C.green : s >= 0.7 ? C.orange : C.greyT;
  const bg = s >= 0.85 ? '#F0FDF4' : s >= 0.7 ? '#FFFBEB' : C.grey;
  return <Badge color={color} bg={bg}>{Math.round(s * 100)}%</Badge>;
}

function SuggestionRow({ token, sug, onDone }) {
  const [editing, setEditing] = useState(false);
  const [sku, setSku] = useState(sug.matched_sku || '');
  const [title, setTitle] = useState(sug.matched_title || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const validate = async () => {
    if (!sku.trim()) { setErr('Renseigne un SKU Youvape avant de valider'); return; }
    setBusy(true); setErr(null);
    try {
      await axios.post(`${API_URL}/competitors/suggestions/${sug.id}/validate`,
        { matched_sku: sku.trim(), matched_title: title.trim() }, authHeaders(token));
      onDone();
    } catch (e) { setErr(e.response?.data?.error || e.message); setBusy(false); }
  };
  const saveEdit = async () => {
    setBusy(true); setErr(null);
    try {
      await axios.put(`${API_URL}/competitors/suggestions/${sug.id}`,
        { matched_sku: sku.trim() || null, matched_title: title.trim() || null }, authHeaders(token));
      setEditing(false); setBusy(false);
    } catch (e) { setErr(e.response?.data?.error || e.message); setBusy(false); }
  };
  const reject = async () => {
    setBusy(true);
    try { await axios.delete(`${API_URL}/competitors/suggestions/${sug.id}`, authHeaders(token)); onDone(); }
    catch (e) { setErr(e.response?.data?.error || e.message); setBusy(false); }
  };

  const inp = { padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.greyB}`, fontSize: 12.5, width: '100%' };
  return (
    <tr>
      <Td>{sug.competitor}</Td>
      <Td>
        <a href={sug.representative_url} target="_blank" rel="noreferrer" style={{ color: C.dark, fontWeight: 600, textDecoration: 'none' }}>{sug.model_label} ↗</a>
      </Td>
      <Td>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input style={inp} value={sku} onChange={e => setSku(e.target.value)} placeholder="SKU Youvape (ex: 1145516-1145581)" />
            <input style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Nom produit" />
          </div>
        ) : sug.matched_sku ? (
          <div><span style={{ fontWeight: 600, color: C.primary }}>{sug.matched_title}</span><div style={{ fontSize: 11, color: C.greyM }}>SKU {sug.matched_sku}</div></div>
        ) : (
          <span style={{ color: C.orange, fontSize: 12.5 }}>Non matché — clique « Modifier » pour associer un produit</span>
        )}
        {err && <div style={{ color: C.red, fontSize: 11, marginTop: 4 }}>{err}</div>}
      </Td>
      <Td align="center"><ScoreBadge score={sug.match_score} /></Td>
      <Td align="center">
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          {editing ? (
            <>
              <Btn small onClick={saveEdit} disabled={busy}>💾 OK</Btn>
              <Btn variant="ghost" small onClick={() => setEditing(false)} disabled={busy}>Annuler</Btn>
            </>
          ) : (
            <>
              <Btn variant="accent" small onClick={validate} disabled={busy}>✓ Valider</Btn>
              <Btn variant="ghost" small onClick={() => setEditing(true)} disabled={busy}>Modifier</Btn>
              <Btn variant="danger" small onClick={reject} disabled={busy}>Suppr.</Btn>
            </>
          )}
        </div>
      </Td>
    </tr>
  );
}

function DiscoveryPanel({ token, onValidated }) {
  const [sugs, setSugs] = useState([]);
  const [brand, setBrand] = useState('JNR');
  const [discovering, setDiscovering] = useState(false);
  const [msg, setMsg] = useState(null);
  const [hideUnmatched, setHideUnmatched] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API_URL}/competitors/suggestions?status=pending`, authHeaders(token));
    setSugs(data);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const discover = async () => {
    setDiscovering(true); setMsg(null);
    try {
      const { data } = await axios.post(`${API_URL}/competitors/discover`, { brand: brand.trim() }, authHeaders(token));
      const parts = data.results.map(r => r.error ? `${r.competitor} : erreur (${r.error})` : `${r.competitor} : ${r.discovered} modèles`);
      setMsg({ type: 'ok', text: `Découverte terminée — ${parts.join(' · ')}` });
      await load();
    } catch (e) {
      setMsg({ type: 'error', text: 'Erreur découverte : ' + (e.response?.data?.error || e.message) });
    } finally { setDiscovering(false); }
  };

  const shown = hideUnmatched ? sugs.filter(s => s.matched_sku) : sugs;
  const matchedCount = sugs.filter(s => s.matched_sku).length;

  return (
    <div style={{ marginTop: 16, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, color: C.primary }}>🔍 Découverte automatique</div>
        <div style={{ flex: 1 }} />
        <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Marque"
          style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13, width: 120 }} />
        <Btn variant="accent" onClick={discover} disabled={discovering}>{discovering ? 'Découverte en cours…' : `Découvrir les produits ${brand || ''}`}</Btn>
      </div>
      <p style={{ color: C.greyT, fontSize: 12.5, margin: '8px 0 0' }}>
        Explore levapoteur-discount et cigaretteelec, dédoublonne par modèle (une entrée par modèle, pas par saveur) et propose un rapprochement avec tes produits. Rien n'est ajouté au suivi tant que tu n'as pas cliqué « Valider ».
      </p>

      {msg && (
        <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 8, fontSize: 13,
          background: msg.type === 'error' ? '#FEF2F2' : '#F0FDF4', color: msg.type === 'error' ? C.red : C.green,
          border: `1px solid ${msg.type === 'error' ? '#FECACA' : '#BBF7D0'}` }}>{msg.text}</div>
      )}

      {sugs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
          <span style={{ fontSize: 13, color: C.greyT }}>{sugs.length} suggestion(s) · <b style={{ color: C.green }}>{matchedCount} matchée(s)</b></span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={hideUnmatched} onChange={e => setHideUnmatched(e.target.checked)} />
            Masquer les non matchés
          </label>
        </div>
      )}

      {sugs.length > 0 && (
        <div style={{ marginTop: 12, border: `1px solid ${C.greyB}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <colgroup>
              <col style={{ width: '13%' }} /><col style={{ width: '26%' }} /><col style={{ width: '34%' }} /><col style={{ width: '9%' }} /><col style={{ width: '18%' }} />
            </colgroup>
            <thead><tr>
              <Th>Concurrent</Th><Th>Modèle concurrent</Th><Th>Ton produit associé</Th><Th align="center">Score</Th><Th align="center">Action</Th>
            </tr></thead>
            <tbody>
              {shown.map(s => <SuggestionRow key={s.id} token={token} sug={s} onDone={async () => { await load(); await onValidated(); }} />)}
            </tbody>
          </table>
        </div>
      )}
      {sugs.length === 0 && !discovering && (
        <div style={{ marginTop: 14, color: C.greyT, fontSize: 13 }}>Aucune suggestion en attente. Lance une découverte ci-dessus.</div>
      )}
    </div>
  );
}
