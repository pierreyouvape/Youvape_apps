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
  return <th style={{ padding: '9px 12px', textAlign: align, fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children, align = 'left', color, bold, bg }) {
  return <td style={{ padding: '8px 12px', textAlign: align, color: color || C.dark, fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 13, background: bg }}>{children}</td>;
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
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color, background: bg }}>{children}</span>;
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
  const [msg, setMsg] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showManage, setShowManage] = useState(false);

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
    setRunning(true); setMsg(null);
    try {
      const { data } = await axios.post(`${API_URL}/competitors/run`, { notify }, authHeaders(token));
      await loadDashboard();
      const errTxt = data.errors?.length ? `, ${data.errors.length} en échec` : '';
      setMsg({ type: data.errors?.length ? 'warn' : 'ok', text: `Relevé terminé : ${data.ok}/${data.total} OK, ${data.changes} changement(s)${errTxt}.${notify ? ' Email envoyé si nouveautés.' : ''}` });
    } catch (e) {
      setMsg({ type: 'error', text: 'Erreur relevé : ' + (e.response?.data?.error || e.message) });
    } finally { setRunning(false); }
  };

  /* KPIs */
  const kpis = useMemo(() => {
    const competitors = new Set(rows.map(r => r.competitor));
    const changes = rows.filter(r => r.previous_price != null && r.current_price != null && Math.abs(parseFloat(r.current_price) - parseFloat(r.previous_price)) >= 0.005).length;
    const errors = rows.filter(r => r.last_status === 'error').length;
    return { suivis: rows.length, competitors: competitors.size, changes, errors };
  }, [rows]);

  /* Regrouper par SKU */
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.sku)) map.set(r.sku, { sku: r.sku, name: r.product_name, items: [] });
      map.get(r.sku).items.push(r);
    }
    return Array.from(map.values());
  }, [rows]);

  if (loading) {
    return <AppShell currentPath="/veille"><div style={{ padding: 40, color: C.greyT }}>Chargement…</div></AppShell>;
  }

  return (
    <AppShell currentPath="/veille">
      <div style={{ padding: '24px 28px', maxWidth: 1280, margin: '0 auto' }}>
        {/* En-tête */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.primary, margin: 0 }}>Veille concurrentielle</h1>
            <p style={{ color: C.greyT, margin: '4px 0 0', fontSize: 13.5 }}>Suivi quotidien des prix concurrents · relevé automatique chaque jour à 8h.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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

        {/* KPIs */}
        <div style={{ display: 'flex', gap: 14, marginTop: 18, flexWrap: 'wrap' }}>
          <Kpi value={kpis.suivis} label="Suivis actifs" />
          <Kpi value={kpis.competitors} label="Concurrents" color={C.blue} />
          <Kpi value={kpis.changes} label="Prix modifiés (dernier relevé)" color={C.orange} />
          <Kpi value={kpis.errors} label="Relevés en échec" color={kpis.errors ? C.red : C.green} />
        </div>

        {/* Réglages */}
        {showSettings && config && <SettingsPanel token={token} config={config} onSaved={loadConfig} />}

        {/* Gestion des suivis */}
        {showManage && <ManagePanel token={token} onChanged={loadDashboard} />}

        {/* Tableau principal */}
        <div style={{ marginTop: 20, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Produit / Concurrent</Th>
                <Th align="right">Prix actuel</Th>
                <Th align="right">Prix barré</Th>
                <Th align="center">Variation</Th>
                <Th align="center">Dispo.</Th>
                <Th align="center">Dernier relevé</Th>
                <Th align="center">État</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr><Td>Aucun suivi. Ajoutez-en via « Gérer les suivis ».</Td></tr>
              )}
              {groups.map((g) => (
                <Fragment key={`g-${g.sku}`}>
                  <tr>
                    <td colSpan={8} style={{ padding: '10px 12px', background: C.accentL, borderBottom: `1px solid ${C.greyB}`, fontWeight: 700, color: C.dark, fontSize: 13 }}>
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
                          <Td align="right" bold>{fmtEur(r.current_price)}</Td>
                          <Td align="right" color={C.greyM}>{r.regular_price ? <s>{fmtEur(r.regular_price)}</s> : '—'}</Td>
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
                            <Btn variant="ghost" small onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{expanded === r.id ? 'Masquer' : '📈'}</Btn>
                          </Td>
                        </tr>
                        {isErr && r.last_error && (
                          <tr key={`e-${r.id}`}><td colSpan={8} style={{ padding: '4px 12px 8px 12px', fontSize: 11.5, color: C.red, background: '#FFF7F7', borderBottom: `1px solid ${C.greyB}` }}>⚠ {r.last_error}</td></tr>
                        )}
                        {expanded === r.id && (
                          <tr key={`h-${r.id}`}><td colSpan={8} style={{ borderBottom: `1px solid ${C.greyB}` }}><HistoryChart token={token} id={r.id} /></td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
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
