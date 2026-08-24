import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE (alignée Stock / Réception) ───────────────── */
const C = {
  primary: '#135E84', accent: '#E28F00', accentL: '#FDF3E2',
  green: '#16A34A', greenL: '#DCFCE7', red: '#DC2626', redL: '#FEE2E2',
  orange: '#EA580C', orangeL: '#FFEDD5', blue: '#2563EB', blueL: '#DBEAFE',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#111827', white: '#FFFFFF', zebra: '#F4F7F9',
};

const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const fmtEur = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
const fmtDateTime = (s) => {
  if (!s) return 'jamais';
  const d = String(s);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} à ${d.slice(11, 16)}`;
};
/** Les titres WooCommerce arrivent avec leurs entités HTML (« &amp; »). */
const decodeHtml = (s) => (s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');

/**
 * Niveau de confiance affiché. Un match par EAN et un match par nom à 0,46 ne
 * se relisent pas de la même façon : la première colonne du tableau doit le dire.
 */
function confidenceOf(row) {
  if (row.match_method === 'manual') return { label: 'Manuel', color: C.primary, bg: '#EEF5F9' };
  if (row.match_method === 'ean') return { label: 'EAN', color: C.green, bg: C.greenL };
  if (row.match_method === 'ean_ambiguous') return { label: 'EAN ambigu', color: C.orange, bg: C.orangeL };
  if (row.match_method === 'name') {
    return row.score >= 0.7
      ? { label: `Nom ${Math.round(row.score * 100)}%`, color: C.blue, bg: C.blueL }
      : { label: `Nom ${Math.round(row.score * 100)}%`, color: C.orange, bg: C.orangeL };
  }
  return { label: 'Aucune piste', color: C.greyM, bg: C.grey };
}

/* ─── PETITS COMPOSANTS ─────────────────────────────────── */
function Th({ children, align = 'left', width, onClick, active, dir }) {
  return (
    <th onClick={onClick} title={onClick ? 'Trier' : undefined} style={{
      padding: '11px 14px', textAlign: align, width, fontWeight: 700,
      color: active ? C.primary : C.greyT,
      fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3,
      borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap',
      cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
    }}>{children}{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
  );
}
function Td({ children, align = 'left', bold, color, style }) {
  return (
    <td style={{
      padding: '10px 14px', textAlign: align, color: color || C.dark, verticalAlign: 'top',
      fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 13.5, ...style,
    }}>{children}</td>
  );
}
function Kpi({ label, value, sub, color = C.primary, onClick, active }) {
  return (
    <div onClick={onClick} title={onClick ? 'Filtrer' : undefined} style={{
      flex: '1 1 150px', minWidth: 140, background: active ? '#EEF5F9' : C.white, borderRadius: 12,
      border: `${active ? 2 : 1}px solid ${active ? color : C.greyB}`,
      padding: active ? '13px 15px' : '14px 16px', cursor: onClick ? 'pointer' : 'default',
      transition: 'border-color 0.15s, background 0.15s',
    }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, margin: '4px 0 0' }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, color: C.greyM, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Btn({ children, onClick, variant = 'primary', disabled, small, title }) {
  const variants = {
    primary: { background: C.primary, color: '#fff', border: 'none' },
    accent:  { background: C.accent, color: '#fff', border: 'none' },
    green:   { background: C.green, color: '#fff', border: 'none' },
    danger:  { background: '#fff', color: C.red, border: `1px solid ${C.red}44` },
    ghost:   { background: '#fff', color: C.primary, border: `1px solid ${C.greyB}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      ...variants[variant], padding: small ? '5px 10px' : '9px 17px', borderRadius: 8,
      fontWeight: 600, fontSize: small ? 12.5 : 13.5,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}
function Chip({ children, color, bg, title }) {
  return (
    <span title={title} style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20, background: bg,
      color, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/**
 * Seuils « ceux qui posent problème ». Le % isole les tarifs caisse qui ont
 * dérivé ; les euros isolent ceux qui pèsent sur la valeur de stock — les deux
 * ne désignent pas les mêmes lignes.
 */
const GAP_PRESETS = [
  { key: 'none', label: 'Tous',        pct: 0,  eur: 0 },
  { key: 'p20',  label: 'Écart ≥ 20 %', pct: 20, eur: 0 },
  { key: 'p50',  label: 'Écart ≥ 50 %', pct: 50, eur: 0 },
  { key: 'e50',  label: 'Impact ≥ 50 €', pct: 0,  eur: 50 },
  { key: 'e200', label: 'Impact ≥ 200 €', pct: 0, eur: 200 },
];

/* ─── ONGLETS DE STATUT ─────────────────────────────────── */
const TABS = [
  { key: 'pending',   label: 'À valider' },
  { key: 'unmatched', label: 'Sans correspondance' },
  { key: 'approved',  label: 'Validés' },
  { key: 'rejected',  label: 'Rejetés' },
  { key: 'all',       label: 'Tout' },
];

/**
 * Recherche d'un produit site pour rattacher (ou corriger) un lien à la main.
 * Sert aussi bien aux lignes sans proposition qu'aux propositions à remplacer.
 */
function ManualPicker({ shop, token, onPick, onCancel, initial }) {
  const [q, setQ] = useState(initial || '');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return undefined; }
    const seq = ++reqRef.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await axios.get(
          `${API_URL}/nextore/${shop.slug}/match/search?q=${encodeURIComponent(q.trim())}`,
          authHeaders(token),
        );
        if (seq === reqRef.current) setRows(res.data.rows || []);
      } catch {
        if (seq === reqRef.current) setRows([]);
      } finally {
        if (seq === reqRef.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, shop.slug, token]);

  return (
    <div style={{ padding: '10px 0 4px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher un produit du site (titre, SKU, code-barres)…"
          style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13, flex: 1, maxWidth: 460 }}
        />
        <Btn small variant="ghost" onClick={onCancel}>Annuler</Btn>
        {busy && <span style={{ fontSize: 12, color: C.greyM }}>Recherche…</span>}
      </div>
      {rows.length > 0 && (
        <div style={{ border: `1px solid ${C.greyB}`, borderRadius: 8, maxHeight: 260, overflowY: 'auto', background: C.white }}>
          {rows.map((r) => (
            <div key={r.id} onClick={() => onPick(r)} style={{
              padding: '7px 12px', borderBottom: `1px solid ${C.greyB}`, cursor: 'pointer',
              display: 'flex', gap: 10, alignItems: 'center', fontSize: 13,
            }}>
              <span style={{ flex: 1 }}>{decodeHtml(r.post_title)}</span>
              {r.post_status !== 'publish' && <Chip color={C.greyT} bg={C.grey}>{r.post_status}</Chip>}
              <span style={{ color: C.greyM, fontSize: 12 }}>{r.sku || '—'}</span>
              <span style={{ color: C.primary, fontWeight: 600, minWidth: 62, textAlign: 'right' }}>{fmtEur(r.cost)}</span>
            </div>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && !busy && rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: C.greyM }}>Aucun produit trouvé.</div>
      )}
    </div>
  );
}

/* ─── ONGLET RAPPROCHEMENT ──────────────────────────────── */
export default function RapprochementTab({ shop, token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState(null);
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [scopeAll, setScopeAll] = useState(false);
  const [gap, setGap] = useState('none');
  const [sort, setSort] = useState({ key: null, dir: 'desc' });  // null = tri par confiance
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(null);   // nx_product_id dont on édite le lien
  const [savingIds, setSavingIds] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, limit: '500' });
      if (search.trim()) params.set('search', search.trim());
      if (onlyWarnings) params.set('warnings', '1');
      if (scopeAll) params.set('scope', 'all');
      const preset = GAP_PRESETS.find((g) => g.key === gap);
      if (preset?.pct) params.set('min_ecart_pct', String(preset.pct));
      if (preset?.eur) params.set('min_impact', String(preset.eur));
      if (sort.key) { params.set('sort', sort.key); params.set('dir', sort.dir); }
      const res = await axios.get(`${API_URL}/nextore/${shop.slug}/match?${params}`, authHeaders(token));
      setData(res.data);
      setSelected(new Set());
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [shop.slug, token, status, search, onlyWarnings, scopeAll, gap, sort]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const runEngine = async () => {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await axios.post(`${API_URL}/nextore/${shop.slug}/match/run`, {}, authHeaders(token));
      const r = res.data;
      setNotice(`Moteur : ${fmtNum(r.ean)} par EAN, ${fmtNum(r.name)} par nom, ${fmtNum(r.none)} sans piste `
        + `(${fmtNum(r.skippedLocked)} déjà arbitrés, laissés intacts).`);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur du moteur');
    } finally {
      setRunning(false);
    }
  };

  const toggleSort = (key) => setSort((cur) => (
    cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
  ));

  const markSaving = (id, on) => setSavingIds((s) => {
    const next = new Set(s);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const patchRow = async (nxId, body) => {
    markSaving(nxId, true);
    setError(null);
    try {
      await axios.patch(`${API_URL}/nextore/${shop.slug}/match/${encodeURIComponent(nxId)}`, body, authHeaders(token));
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur de mise à jour');
    } finally {
      markSaving(nxId, false);
    }
  };

  const bulk = async (newStatus) => {
    if (!selected.size) return;
    setError(null);
    setNotice(null);
    try {
      const res = await axios.post(
        `${API_URL}/nextore/${shop.slug}/match/bulk`,
        { ids: [...selected], status: newStatus },
        authHeaders(token),
      );
      const verb = newStatus === 'approved' ? 'validé' : newStatus === 'rejected' ? 'rejeté' : 'remis en attente';
      setNotice(`${fmtNum(res.data.updated)} lien(s) ${verb}${res.data.skipped ? ` — ${fmtNum(res.data.skipped)} ignoré(s) (aucun produit site rattaché)` : ''}.`);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur de mise à jour en masse');
    }
  };

  const rows = data?.rows || [];
  const s = data?.summary;

  // Sélection en masse : seules les lignes rattachées peuvent être validées
  const selectableIds = useMemo(
    () => rows.filter((r) => r.wc_product_id).map((r) => r.nx_product_id),
    [rows],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
  const toggleOne = (id) => setSelected((sel) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const ecart = s ? (s.approved_value_aligned - s.approved_value_nextore) : null;

  return (
    <div>
      {/* Barre KPI */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <Kpi label="À valider" value={s ? fmtNum(s.pending) : '—'} sub="propositions du moteur"
             color={C.accent} active={status === 'pending'} onClick={() => setStatus('pending')} />
        <Kpi label="Sans correspondance" value={s ? fmtNum(s.unmatched) : '—'} sub="à rattacher à la main"
             color={C.greyT} active={status === 'unmatched'} onClick={() => setStatus('unmatched')} />
        <Kpi label="Validés" value={s ? fmtNum(s.approved) : '—'}
             sub={s ? `dont ${fmtNum(s.approved_packs)} packs` : null}
             color={C.green} active={status === 'approved'} onClick={() => setStatus('approved')} />
        <Kpi label="Alertes pack" value={s ? fmtNum(s.warnings) : '—'} sub="conditionnement à trancher"
             color={s?.warnings > 0 ? C.orange : C.greyM}
             active={onlyWarnings} onClick={() => setOnlyWarnings((w) => !w)} />
        <Kpi label="Enjeu en attente" value={s ? fmtEur(s.pending_impact) : '—'}
             sub={s ? `${fmtNum(s.pending_big_gap)} réf. à plus de 30 % d'écart` : null}
             color={s?.pending_impact < 0 ? C.red : C.green}
             active={gap !== 'none'} onClick={() => setGap((g) => (g === 'none' ? 'p20' : 'none'))} />
        <Kpi label="Valeur alignée" value={s ? fmtEur(s.approved_value_aligned) : '—'}
             sub={s ? `caisse : ${fmtEur(s.approved_value_nextore)}${ecart ? ` (${ecart > 0 ? '+' : ''}${fmtEur(ecart)})` : ''}` : null}
             color={ecart != null && ecart < 0 ? C.red : C.primary} />
      </div>

      {/* Onglets de statut */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setStatus(t.key)} style={{
            padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${status === t.key ? C.primary : C.greyB}`,
            background: status === t.key ? C.primary : C.white,
            color: status === t.key ? '#fff' : C.greyT,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Barre d'outils */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (produit caisse ou site, code, EAN)…"
          style={{ padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13.5, minWidth: 260, flex: 1, maxWidth: 400 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: C.greyT, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={onlyWarnings} onChange={(e) => setOnlyWarnings(e.target.checked)} />
          Alertes pack seulement
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: C.greyT, cursor: 'pointer', userSelect: 'none' }}
               title="Le catalogue Nextore est commun aux deux boutiques : décocher limite au stock de cette boutique.">
          <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} />
          Tout le catalogue
        </label>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {GAP_PRESETS.map((g) => (
            <button key={g.key} onClick={() => setGap(g.key)} style={{
              padding: '5px 11px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${gap === g.key ? C.accent : C.greyB}`,
              background: gap === g.key ? C.accentL : C.white,
              color: gap === g.key ? '#8A5A00' : C.greyT,
            }}>{g.label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: C.greyM }}>Dernier passage : {fmtDateTime(s?.lastMatchAt)}</span>
        <Btn onClick={runEngine} disabled={running} variant="accent">
          {running ? 'Analyse…' : 'Relancer le moteur'}
        </Btn>
      </div>

      {notice && (
        <div style={{ padding: '11px 15px', background: C.greenL, color: '#14532D', borderRadius: 8, marginBottom: 12, fontSize: 13.5 }}>
          {notice}
        </div>
      )}
      {error && (
        <div style={{ padding: '12px 16px', background: C.redL, color: C.red, borderRadius: 8, marginBottom: 12, fontSize: 13.5 }}>
          {error}
        </div>
      )}

      {/* Barre de sélection */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12,
          padding: '10px 15px', background: C.accentL, borderRadius: 10, border: `1px solid ${C.accent}44`,
        }}>
          <strong style={{ fontSize: 13.5, color: C.dark }}>{fmtNum(selected.size)} sélectionné(s)</strong>
          <div style={{ flex: 1 }} />
          <Btn small variant="green" onClick={() => bulk('approved')}>Valider</Btn>
          <Btn small variant="danger" onClick={() => bulk('rejected')}>Rejeter</Btn>
          <Btn small variant="ghost" onClick={() => bulk('pending')}>Remettre en attente</Btn>
          <Btn small variant="ghost" onClick={() => setSelected(new Set())}>Désélectionner</Btn>
        </div>
      )}

      {/* Table */}
      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th width={34}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                         disabled={!selectableIds.length} title="Tout sélectionner" />
                </Th>
                <Th onClick={() => toggleSort('name')} active={sort.key === 'name'} dir={sort.dir}>Produit caisse</Th>
                <Th align="right" width={70} onClick={() => toggleSort('stock')} active={sort.key === 'stock'} dir={sort.dir}>Stock</Th>
                <Th align="right" width={90} onClick={() => toggleSort('cost')} active={sort.key === 'cost'} dir={sort.dir}>Coût caisse</Th>
                <Th>Produit site</Th>
                <Th align="center" width={60}>Pack</Th>
                <Th align="right" width={100} onClick={() => toggleSort('aligned')} active={sort.key === 'aligned'} dir={sort.dir}>Coût aligné</Th>
                {/* Deux tris distincts : la dérive du tarif (%) et son poids (€) ne
                    désignent pas les mêmes lignes — on laisse choisir. */}
                <Th align="right" width={120}>
                  Écart{' '}
                  <span onClick={() => toggleSort('ecart_pct')} style={{ cursor: 'pointer', color: sort.key === 'ecart_pct' ? C.primary : C.greyM }}>
                    %{sort.key === 'ecart_pct' ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </span>
                  <span style={{ color: C.greyB }}> / </span>
                  <span onClick={() => toggleSort('impact')} style={{ cursor: 'pointer', color: sort.key === 'impact' ? C.primary : C.greyM }}>
                    €{sort.key === 'impact' ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </span>
                </Th>
                <Th align="center" width={100} onClick={() => toggleSort('score')} active={sort.key === 'score'} dir={sort.dir}>Confiance</Th>
                <Th align="right" width={190}>Décision</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: C.greyT }}>Chargement…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: C.greyM }}>
                  Aucun lien dans cette vue. Lancez le moteur pour générer des propositions.
                </td></tr>
              ) : rows.map((r, i) => {
                const conf = confidenceOf(r);
                const saving = savingIds.has(r.nx_product_id);
                const isOpen = expanded === r.nx_product_id;
                // Écart en % entre le coût caisse et le coût dérivé du site
                const delta = r.ecart_pct;
                return (
                  <tr key={r.nx_product_id} style={{ background: i % 2 ? C.zebra : C.white, opacity: saving ? 0.5 : 1 }}>
                    <Td>
                      <input type="checkbox" checked={selected.has(r.nx_product_id)}
                             disabled={!r.wc_product_id}
                             onChange={() => toggleOne(r.nx_product_id)} />
                    </Td>
                    <Td bold>
                      {r.nx_name || '—'}
                      <div style={{ fontWeight: 400, fontSize: 11.5, color: C.greyM, marginTop: 2 }}>
                        #{r.nx_code || '—'}{r.nx_barcode ? ` · ${r.nx_barcode}` : ''}
                        {r.nx_category ? ` · ${r.nx_category}` : ''}
                      </div>
                    </Td>
                    <Td align="right" color={r.nx_stock < 0 ? C.red : C.dark}>{fmtNum(r.nx_stock)}</Td>
                    <Td align="right" color={C.greyT}>{fmtEur(r.nx_cost)}</Td>
                    <Td>
                      {r.wc_product_id ? (
                        <>
                          <span>{decodeHtml(r.wc_title)}</span>
                          <div style={{ fontSize: 11.5, color: C.greyM, marginTop: 2 }}>
                            {r.wc_sku || '—'} · {fmtEur(r.wc_cost)} HT
                            {r.wc_status !== 'publish' ? ` · ${r.wc_status}` : ''}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: C.greyM, fontStyle: 'italic' }}>Aucune proposition</span>
                      )}
                      {r.pack_warning && (
                        <div style={{ marginTop: 5, fontSize: 11.5, color: C.orange, fontWeight: 600 }}>
                          ⚠ {r.pack_warning}
                        </div>
                      )}
                      {/* Pistes alternatives proposées par le moteur */}
                      {isOpen && r.candidates?.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.greyT, marginBottom: 4 }}>AUTRES PISTES</div>
                          {r.candidates.map((c) => (
                            <div key={c.wc_product_id}
                                 onClick={() => patchRow(r.nx_product_id, { wc_product_id: c.wc_product_id })}
                                 style={{
                                   padding: '5px 9px', border: `1px solid ${C.greyB}`, borderRadius: 7,
                                   marginBottom: 4, cursor: 'pointer', fontSize: 12.5, display: 'flex', gap: 8,
                                 }}>
                              <span style={{ flex: 1 }}>{decodeHtml(c.post_title)}</span>
                              <span style={{ color: C.greyM }}>{Math.round((c.score || 0) * 100)}%</span>
                              <span style={{ color: C.primary, fontWeight: 600 }}>{fmtEur(c.cost)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {isOpen && (
                        <ManualPicker
                          shop={shop} token={token} initial={r.nx_name}
                          onCancel={() => setExpanded(null)}
                          onPick={(p) => { setExpanded(null); patchRow(r.nx_product_id, { wc_product_id: p.id }); }}
                        />
                      )}
                    </Td>
                    <Td align="center">
                      {r.wc_product_id ? (
                        <input
                          type="number" min={1} value={r.pack_qty}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (Number.isInteger(v) && v >= 1 && v !== r.pack_qty) {
                              patchRow(r.nx_product_id, { pack_qty: v });
                            }
                          }}
                          title="Unités boutique contenues dans un produit du site"
                          style={{
                            width: 48, padding: '4px 6px', textAlign: 'center', fontSize: 13,
                            borderRadius: 6, border: `1px solid ${r.pack_qty > 1 ? C.accent : C.greyB}`,
                            fontWeight: r.pack_qty > 1 ? 700 : 400,
                          }}
                        />
                      ) : <span style={{ color: C.greyM }}>—</span>}
                    </Td>
                    <Td align="right" bold>
                      {r.aligned_cost == null
                        ? <span style={{ color: C.greyM, fontWeight: 400 }}>—</span>
                        : fmtEur(r.aligned_cost)}
                    </Td>
                    <Td align="right">
                      {delta == null ? <span style={{ color: C.greyM }}>—</span> : (
                        <>
                          <div style={{ fontWeight: 700, fontSize: 13.5, color: delta > 0 ? C.green : delta < 0 ? C.red : C.greyT }}>
                            {delta > 0 ? '+' : ''}{Math.round(delta * 100)} %
                          </div>
                          {/* Ce que l'écart pèse sur la valeur de stock : le vrai enjeu */}
                          <div style={{ fontSize: 11.5, color: C.greyT, fontWeight: 600 }} title="Impact sur la valeur de stock">
                            {r.ecart_valeur > 0 ? '+' : ''}{fmtEur(r.ecart_valeur)}
                          </div>
                        </>
                      )}
                    </Td>
                    <Td align="center">
                      <Chip color={conf.color} bg={conf.bg}>{conf.label}</Chip>
                      {r.status !== 'pending' && (
                        <div style={{ marginTop: 4 }}>
                          <Chip color={r.status === 'approved' ? C.green : C.red}
                                bg={r.status === 'approved' ? C.greenL : C.redL}
                                title={r.reviewed_by_name ? `Par ${r.reviewed_by_name}` : undefined}>
                            {r.status === 'approved' ? 'Validé' : 'Rejeté'}
                          </Chip>
                        </div>
                      )}
                    </Td>
                    <Td align="right">
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {r.status !== 'approved' && r.wc_product_id && (
                          <Btn small variant="green" disabled={saving}
                               onClick={() => patchRow(r.nx_product_id, { status: 'approved' })}>Valider</Btn>
                        )}
                        {r.status !== 'rejected' && (
                          <Btn small variant="danger" disabled={saving}
                               onClick={() => patchRow(r.nx_product_id, { status: 'rejected' })}>Rejeter</Btn>
                        )}
                        {r.status !== 'pending' && (
                          <Btn small variant="ghost" disabled={saving}
                               onClick={() => patchRow(r.nx_product_id, { status: 'pending' })}>Annuler</Btn>
                        )}
                        <Btn small variant="ghost" disabled={saving}
                             onClick={() => setExpanded(isOpen ? null : r.nx_product_id)}>
                          {r.wc_product_id ? 'Changer' : 'Rattacher'}
                        </Btn>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && rows.length > 0 && (
        <div style={{ fontSize: 12, color: C.greyM, marginTop: 10, textAlign: 'right' }}>
          {fmtNum(rows.length)} ligne{rows.length > 1 ? 's' : ''} affichée{rows.length > 1 ? 's' : ''}
          {rows.length >= 500 ? ' (500 max — affinez la recherche)' : ''}
        </div>
      )}
    </div>
  );
}
