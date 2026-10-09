import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { Inventory as InventoryIcon } from '../components/AppIcons';
import { API_URL, authHeaders, C, Chip } from '../components/picking/pickingUi';
import { useVisibleRefresh } from '../components/picking/useVisibleRefresh';
import { formatDateUTC } from '../utils/dateUtils';

/**
 * Inventaire — /inventaire, droit `inventaire`. Lot 1, validé avec Pierre le 06/10/2026.
 *
 * On crée ici un inventaire partiel (catégories, sous-catégories, marques) ou
 * global, et on suit son avancement : par allée, par emplacement, par
 * compteur, et les recomptages. Le comptage se fait au PDA (/pda/inventaire).
 *
 * L'écran ne montre pas encore les écarts : leur revue et leur envoi à BMS
 * sont le lot 2.
 */

const BLUE = '#0369A1';
const BLUE_L = '#E0F2FE';
const nf = new Intl.NumberFormat('fr-FR');
const pct = (n, total) => (total ? Math.floor((n / total) * 100) : 0);
// WooCommerce stocke « & » en entité dans les noms de catégorie.
const decode = (s) => String(s || '').replace(/&amp;/g, '&');
const locLabel = (l) => l || 'Sans emplacement';
const aisleOf = (l) => String(l || '').trim().split(/[\s-]/)[0].toUpperCase();
const byLocation = (a, b) => {
  if (!a.location !== !b.location) return a.location ? -1 : 1;
  return a.location.localeCompare(b.location, 'fr', { numeric: true });
};

const btn = (variant = 'primary') => ({
  padding: '9px 16px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  border: variant === 'ghost' ? `1px solid ${C.greyB}` : 'none',
  background: variant === 'primary' ? BLUE : variant === 'danger' ? C.red : C.white,
  color: variant === 'ghost' ? C.dark : C.white,
});
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${C.greyB}` };
const td = { padding: '9px 12px', fontSize: 13.5, color: C.dark, borderBottom: `1px solid ${C.greyB}`, verticalAlign: 'middle' };
const panel = { background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 14, padding: 18 };
const field = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 14, fontFamily: 'inherit', background: C.white };

const STATUS = {
  free: { label: 'À compter', color: C.greyT, bg: C.grey },
  counting: { label: 'En cours', color: C.amber, bg: C.amberL },
  closed: { label: 'Terminé', color: C.blue, bg: C.blueL },
  validated: { label: 'Validé', color: C.green, bg: C.greenL },
};
const INV_STATUS = {
  open: { label: 'En cours', color: BLUE, bg: BLUE_L },
  cancelled: { label: 'Annulé', color: C.greyT, bg: C.grey },
  closed: { label: 'Clôturé', color: C.green, bg: C.greenL },
};

const Banner = ({ kind, children, onClose }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13.5,
    background: kind === 'error' ? C.redL : C.greenL, color: kind === 'error' ? C.red : C.green,
  }}>
    <span style={{ flex: 1 }}>{children}</span>
    {onClose && <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}>×</button>}
  </div>
);

const Tabs = ({ tabs, active, onChange }) => (
  <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.greyB}`, marginBottom: 16, flexWrap: 'wrap' }}>
    {tabs.map(t => {
      const on = t.key === active;
      return (
        <button key={t.key} onClick={() => onChange(t.key)} style={{
          padding: '9px 16px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 14.5, fontWeight: on ? 700 : 500, color: on ? BLUE : C.greyT,
          borderBottom: `3px solid ${on ? BLUE : 'transparent'}`, marginBottom: -1,
        }}>{t.label}</button>
      );
    })}
  </div>
);

const Bar = ({ value, total, height = 8 }) => (
  <div style={{ height, borderRadius: 999, background: C.greyB, overflow: 'hidden' }}>
    <div style={{ width: `${pct(value, total)}%`, height: '100%', background: C.green }} />
  </div>
);

const Kpi = ({ label, value, sub, color }) => (
  <div style={{ ...panel, padding: 14, flex: '1 1 150px' }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 900, color: color || C.dark, marginTop: 4 }}>{value}</div>
    {sub && <div style={{ fontSize: 12.5, color: C.greyT, marginTop: 2 }}>{sub}</div>}
  </div>
);

const filtersText = (inv) => {
  if (inv.kind === 'global') return 'Tout le catalogue';
  const f = inv.filters || {};
  return [
    f.categories?.length && `Catégories : ${f.categories.map(decode).join(', ')}`,
    f.subCategories?.length && `Sous-catégories : ${f.subCategories.map(decode).join(', ')}`,
    f.brands?.length && `Marques : ${f.brands.map(decode).join(', ')}`,
    f.subBrands?.length && `Sous-marques : ${f.subBrands.map(decode).join(', ')}`,
  ].filter(Boolean).join(' · ');
};

// ── Création ────────────────────────────────────────────────────────────────

/** Liste de cases ; chaque item porte son état (`checked`) et son geste (`onToggle`). */
function CheckList({ title, items, selectedCount, search, onSearch }) {
  return (
    <div style={{ ...panel, padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong style={{ flex: 1, fontSize: 14 }}>{title}</strong>
        {selectedCount > 0 && <Chip color={BLUE} bg={BLUE_L}>{selectedCount}</Chip>}
      </div>
      {onSearch && (
        <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Rechercher…" style={{ ...field, marginBottom: 8 }} />
      )}
      <div style={{ overflowY: 'auto', maxHeight: 340 }}>
        {items.map(it => (
          <label key={it.key} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 13.5, cursor: 'pointer',
            paddingLeft: it.indent ? 22 : 2, fontWeight: it.indent ? 400 : 600,
          }}>
            <input type="checkbox" checked={it.checked} onChange={it.onToggle} />
            <span style={{ flex: 1 }}>{decode(it.value)}</span>
            <span style={{ color: C.greyT, fontSize: 12 }}>{nf.format(it.count)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function CreateView({ token, onCreated, onCancel }) {
  const today = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' }).format(new Date());
  const [kind, setKind] = useState('partial');
  const [name, setName] = useState('');
  const [options, setOptions] = useState(null);
  const [cats, setCats] = useState(new Set());
  const [subs, setSubs] = useState(new Set());
  const [brands, setBrands] = useState(new Set());
  const [subBrands, setSubBrands] = useState(new Set());
  const [brandSearch, setBrandSearch] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get(`${API_URL}/inventaire/options`, authHeaders(token))
      .then(r => setOptions(r.data))
      .catch(err => setError(err.response?.data?.error || err.message));
  }, [token]);

  const filters = useMemo(() => ({
    categories: [...cats], subCategories: [...subs], brands: [...brands], subBrands: [...subBrands],
  }), [cats, subs, brands, subBrands]);
  const picked = [...cats, ...subs, ...brands, ...subBrands];
  const empty = kind === 'partial' && picked.length === 0;

  useEffect(() => {
    if (empty) { setPreview(null); return undefined; }
    const t = setTimeout(() => {
      axios.post(`${API_URL}/inventaire/preview`, { kind, filters }, authHeaders(token))
        .then(r => setPreview(r.data))
        .catch(err => setError(err.response?.data?.error || err.message));
    }, 250);
    return () => clearTimeout(t);
  }, [token, kind, filters, empty]);

  const toggle = (setter) => (value) => setter(prev => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });

  const autoName = kind === 'global'
    ? `Inventaire global du ${today}`
    : `Inventaire ${picked.map(decode).slice(0, 3).join(', ')}${picked.length > 3 ? '…' : ''} du ${today}`;

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const { data } = await axios.post(`${API_URL}/inventaire`, { kind, filters, name: name.trim() || autoName }, authHeaders(token));
      onCreated(data.id);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const catItems = (options?.categories || []).map(c => ({
    key: `c:${c.name}`, value: c.name, count: c.count, checked: cats.has(c.name), onToggle: () => toggle(setCats)(c.name),
  }));
  const subItems = (options?.categories || []).flatMap(c => [
    { key: `h:${c.name}`, header: true, value: c.name },
    ...c.subCategories.map(s => ({ key: `s:${c.name}:${s.name}`, value: s.name, count: s.count, indent: true })),
  ]);
  // Une marque et ses sous-marques en dessous. La recherche garde la marque
  // quand elle porte sur une de ses sous-marques.
  const q = brandSearch.trim().toLowerCase();
  const brandItems = (options?.brands || []).flatMap(b => {
    const brandMatch = !q || decode(b.name).toLowerCase().includes(q);
    const subMatches = b.subBrands.filter(sb => brandMatch || decode(sb.name).toLowerCase().includes(q));
    if (!brandMatch && subMatches.length === 0) return [];
    return [
      { key: `b:${b.name}`, value: b.name, count: b.count, checked: brands.has(b.name), onToggle: () => toggle(setBrands)(b.name) },
      ...subMatches.map(sb => ({
        key: `sb:${b.name}:${sb.name}`, value: sb.name, count: sb.count, indent: true,
        checked: brands.has(b.name) || subBrands.has(sb.name),
        onToggle: () => !brands.has(b.name) && toggle(setSubBrands)(sb.name),
      })),
    ];
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}
      <div style={{ ...panel, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {[['partial', 'Partiel', 'Catégories, marques, sous-marques'], ['global', 'Global', 'Tout le catalogue en stock']].map(([k, label, hint]) => (
            <button key={k} onClick={() => setKind(k)} style={{
              flex: 1, textAlign: 'left', padding: 14, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
              border: `2px solid ${kind === k ? BLUE : C.greyB}`, background: kind === k ? BLUE_L : C.white,
            }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.dark }}>{label}</div>
              <div style={{ fontSize: 13, color: C.greyT, marginTop: 2 }}>{hint}</div>
            </button>
          ))}
        </div>
        <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: C.greyT }}>
          Nom
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName} style={field} />
        </label>
      </div>

      {kind === 'partial' && (
        <>
          <p style={{ margin: 0, fontSize: 13, color: C.greyT }}>
            Les catégories et sous-catégories cochées s'additionnent, de même que les marques et
            sous-marques ; les deux se croisent (ex. telle marque <em>dans</em> telle sous-catégorie).
          </p>
          {!options && <p style={{ color: C.greyT }}>Chargement…</p>}
          {options && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <CheckList title="Catégories" items={catItems} selectedCount={cats.size} />
              <div style={{ ...panel, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <strong style={{ flex: 1, fontSize: 14 }}>Sous-catégories</strong>
                  {subs.size > 0 && <Chip color={BLUE} bg={BLUE_L}>{subs.size}</Chip>}
                </div>
                <div style={{ overflowY: 'auto', maxHeight: 382 }}>
                  {subItems.map(it => (it.header
                    ? <div key={it.key} style={{ fontSize: 12, fontWeight: 800, color: C.greyT, textTransform: 'uppercase', margin: '8px 2px 2px' }}>{decode(it.value)}</div>
                    : (
                      <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 13.5, cursor: 'pointer' }}>
                        <input type="checkbox" checked={subs.has(it.value)} onChange={() => toggle(setSubs)(it.value)} />
                        <span style={{ flex: 1 }}>{decode(it.value)}</span>
                        <span style={{ color: C.greyT, fontSize: 12 }}>{nf.format(it.count)}</span>
                      </label>
                    )))}
                </div>
              </div>
              <CheckList title="Marques et sous-marques" items={brandItems} selectedCount={brands.size + subBrands.size}
                search={brandSearch} onSearch={setBrandSearch} />
            </div>
          )}
        </>
      )}

      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, fontSize: 15 }}>
          {empty && <span style={{ color: C.greyT }}>Choisissez au moins une catégorie, sous-catégorie ou marque.</span>}
          {!empty && !preview && <span style={{ color: C.greyT }}>Calcul…</span>}
          {!empty && preview && (
            <span>
              <strong>{nf.format(preview.refs)}</strong> références à compter sur <strong>{nf.format(preview.locations)}</strong> emplacements
              {preview.withoutLocation > 0 && <span style={{ color: C.amber }}> — dont {nf.format(preview.withoutLocation)} sans emplacement</span>}
            </span>
          )}
        </div>
        <button onClick={onCancel} style={btn('ghost')}>Annuler</button>
        <button onClick={create} disabled={empty || !preview?.refs || saving} style={{ ...btn(), opacity: empty || !preview?.refs || saving ? 0.5 : 1 }}>
          {saving ? 'Création…' : 'Créer l\'inventaire'}
        </button>
      </div>
    </div>
  );
}

// ── Suivi ───────────────────────────────────────────────────────────────────

function DetailView({ token, id, canWrite, onBack, setMessage }) {
  const [inv, setInv] = useState(null);
  const [tab, setTab] = useState('locations');
  const [aisle, setAisle] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/inventaire/${id}`, authHeaders(token));
      setInv(data);
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  }, [token, id, setMessage]);
  useEffect(() => { load(); }, [load]);
  useVisibleRefresh(load, 30000);

  const act = async (url, confirmText, done) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await axios.post(`${API_URL}/inventaire/${id}${url}`, {}, authHeaders(token));
      if (done) setMessage({ kind: 'ok', text: done });
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  };

  const locations = useMemo(() => (inv?.locations || []).slice().sort(byLocation), [inv]);
  const aisles = useMemo(() => {
    const m = new Map();
    for (const l of locations) {
      const key = aisleOf(l.location);
      const a = m.get(key) || { key, locations: 0, validated: 0, expected: 0, counted: 0 };
      a.locations += 1;
      if (l.status === 'validated') a.validated += 1;
      a.expected += l.expected;
      a.counted += l.counted;
      m.set(key, a);
    }
    return [...m.values()];
  }, [locations]);

  if (!inv) return <p style={{ color: C.greyT }}>Chargement…</p>;

  const s = inv.stats;
  const done = s.counted + s.recounted;
  const open = inv.status === 'open';
  const shown = locations.filter(l => (!aisle || aisleOf(l.location) === aisle) && (!status || l.status === status));
  const byStatus = (k) => locations.filter(l => l.status === k).length;
  const st = INV_STATUS[inv.status];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ fontSize: 18 }}>{inv.name}</strong>
            <Chip color={st.color} bg={st.bg}>{st.label}</Chip>
          </div>
          <div style={{ fontSize: 13, color: C.greyT, marginTop: 4 }}>
            {filtersText(inv)} · créé le {formatDateUTC(inv.createdAt, { time: false })}{inv.createdBy ? ` par ${inv.createdBy}` : ''}
          </div>
        </div>
        <button onClick={onBack} style={btn('ghost')}>Tous les inventaires</button>
        {open && canWrite && (
          <button onClick={() => act('/cancel', `Annuler « ${inv.name} » ? Les comptages sont conservés mais l'inventaire ne pourra plus avancer.`, 'Inventaire annulé.')} style={btn('danger')}>
            Annuler l'inventaire
          </button>
        )}
      </div>

      <div style={{ ...panel }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
          <span style={{ fontSize: 34, fontWeight: 900, color: C.green }}>{pct(done, s.total)} %</span>
          <span style={{ fontSize: 15, color: C.greyT }}>{nf.format(done)} / {nf.format(s.total)} références comptées</span>
        </div>
        <Bar value={done} total={s.total} height={12} />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Kpi label="Restent à compter" value={nf.format(s.pending)} sub="références" />
        <Kpi label="À recompter" value={nf.format(s.recount)} sub={`${nf.format(s.recounted)} déjà recomptée(s)`} color={s.recount ? C.accent : undefined} />
        <Kpi label="Emplacements validés" value={`${byStatus('validated')} / ${locations.length}`}
          sub={`${byStatus('counting')} en cours · ${byStatus('closed')} terminé(s)`} />
        <Kpi label="Trouvés hors liste" value={nf.format(s.addedByScan)} sub="références ajoutées au scan" />
        {(s.refWaiting > 0 || s.refErrors > 0) && (
          <Kpi label="Relevés BMS" value={nf.format(s.refWaiting)} sub={`en attente${s.refErrors ? ` · ${s.refErrors} inconnue(s) de BMS` : ''}`} />
        )}
      </div>

      <Tabs
        tabs={[
          { key: 'locations', label: 'Emplacements' },
          { key: 'counters', label: 'Compteurs' },
          { key: 'recounts', label: `Recomptages${inv.recounts.length ? ` (${inv.recounts.length})` : ''}` },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'locations' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
            {aisles.map(a => (
              <button key={a.key || '-'} onClick={() => setAisle(aisle === a.key ? '' : a.key)} style={{
                ...panel, padding: 10, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                border: `2px solid ${aisle === a.key ? BLUE : C.greyB}`,
              }}>
                <div style={{ fontWeight: 900, fontSize: 15 }}>{a.key ? `Allée ${a.key}` : 'Sans empl.'}</div>
                <div style={{ fontSize: 12, color: C.greyT, margin: '2px 0 6px' }}>
                  {a.validated}/{a.locations} empl. · {pct(a.counted, a.expected)} %
                </div>
                <Bar value={a.counted} total={a.expected} height={6} />
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={field}>
              <option value="">Tous les statuts</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label} ({byStatus(k)})</option>)}
            </select>
            {aisle !== '' && <button onClick={() => setAisle('')} style={btn('ghost')}>Toutes les allées</button>}
            <span style={{ fontSize: 13, color: C.greyT }}>{shown.length} emplacement(s)</span>
          </div>
          <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Emplacement</th><th style={th}>Statut</th><th style={th}>Compteur</th>
                  <th style={th}>Réfs comptées</th><th style={th}>Trouvés ici</th><th style={th}>Terminé</th><th style={th}>Validé</th>
                  {canWrite && open && <th style={th} />}
                </tr>
              </thead>
              <tbody>
                {shown.map(l => {
                  const ls = STATUS[l.status];
                  return (
                    <tr key={l.id}>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700 }}>{locLabel(l.location)}</td>
                      <td style={td}><Chip color={ls.color} bg={ls.bg}>{ls.label}</Chip></td>
                      <td style={td}>{l.status === 'counting' ? l.assignedTo : l.closedBy || '—'}</td>
                      <td style={td}>{l.counted} / {l.expected}</td>
                      <td style={td}>{l.foundHere || ''}</td>
                      <td style={td}>{l.closedAt ? formatDateUTC(l.closedAt) : ''}</td>
                      <td style={td}>{l.validatedAt ? formatDateUTC(l.validatedAt) : ''}</td>
                      {canWrite && open && (
                        <td style={{ ...td, textAlign: 'right' }}>
                          {l.status === 'counting' && (
                            <button onClick={() => act(`/locations/${l.id}/release`, `Libérer ${locLabel(l.location)} (pris par ${l.assignedTo}) ? Ses comptages sont gardés.`, `${locLabel(l.location)} libéré.`)} style={{ ...btn('ghost'), padding: '5px 10px', fontSize: 12.5 }}>
                              Libérer
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'counters' && (
        <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Compteur</th><th style={th}>Emplacements validés</th><th style={th}>En cours / terminés</th>
                <th style={th}>Réfs comptées</th><th style={th}>Pièces</th>
              </tr>
            </thead>
            <tbody>
              {inv.counters.length === 0 && <tr><td style={{ ...td, color: C.greyT }} colSpan={5}>Personne n'a encore compté.</td></tr>}
              {inv.counters.map(c => (
                <tr key={c.id}>
                  <td style={{ ...td, fontWeight: 700 }}>{c.name}</td>
                  <td style={td}>{c.locationsValidated}</td>
                  <td style={td}>{c.locationsOpen}</td>
                  <td style={td}>{nf.format(c.refs)}</td>
                  <td style={td}>{nf.format(c.pieces)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'recounts' && (
        <>
          <p style={{ margin: 0, fontSize: 13, color: C.greyT }}>
            Une référence revient au PDA quand son écart atteint 5 pièces ET dépasse 15 % du stock théorique.
            Le recomptage refait le relevé BMS, et c'est lui qui fait foi.
          </p>
          <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Produit</th><th style={th}>SKU</th><th style={th}>Emplacement</th><th style={th}>Statut</th><th style={th}>Par</th>
                  {canWrite && open && <th style={th} />}
                </tr>
              </thead>
              <tbody>
                {inv.recounts.length === 0 && <tr><td style={{ ...td, color: C.greyT }} colSpan={6}>Aucun recomptage pour l'instant.</td></tr>}
                {inv.recounts.map(r => (
                  <tr key={r.id}>
                    <td style={td}>{r.name}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{r.sku}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{locLabel(r.expectedLocation)}</td>
                    <td style={td}>
                      {r.status === 'recount'
                        ? <Chip color={C.accent} bg={C.accentL}>{r.lockedBy ? 'En cours' : 'À recompter'}</Chip>
                        : <Chip color={C.green} bg={C.greenL}>Recompté</Chip>}
                    </td>
                    <td style={td}>{r.status === 'recount' ? (r.lockedBy || '') : `${r.recountBy || ''}${r.recountAt ? ` · ${formatDateUTC(r.recountAt)}` : ''}`}</td>
                    {canWrite && open && (
                      <td style={{ ...td, textAlign: 'right' }}>
                        {r.status === 'recount' && r.lockedBy && (
                          <button onClick={() => act(`/recounts/${r.id}/release`, `Libérer le recomptage pris par ${r.lockedBy} ?`, 'Recomptage libéré.')} style={{ ...btn('ghost'), padding: '5px 10px', fontSize: 12.5 }}>
                            Libérer
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Liste ───────────────────────────────────────────────────────────────────

function ListView({ list, canWrite, onOpen, onCreate }) {
  const hasOpen = list.some(i => i.status === 'open');
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {canWrite && (
        <div>
          <button onClick={onCreate} disabled={hasOpen} title={hasOpen ? 'Un inventaire est déjà en cours' : ''} style={{ ...btn(), opacity: hasOpen ? 0.5 : 1 }}>
            Nouvel inventaire
          </button>
          {hasOpen && <span style={{ marginLeft: 12, fontSize: 13, color: C.greyT }}>Un seul inventaire à la fois : terminez ou annulez celui en cours.</span>}
        </div>
      )}
      {list.length === 0 && <p style={{ color: C.greyT }}>Aucun inventaire pour l'instant.</p>}
      {list.map(i => {
        const st = INV_STATUS[i.status];
        return (
          <button key={i.id} onClick={() => onOpen(i.id)} style={{
            ...panel, display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
            border: `${i.status === 'open' ? 2 : 1}px solid ${i.status === 'open' ? BLUE : C.greyB}`,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <strong style={{ fontSize: 15.5, color: C.dark }}>{i.name}</strong>
                <Chip color={st.color} bg={st.bg}>{st.label}</Chip>
              </div>
              <div style={{ fontSize: 13, color: C.greyT, marginTop: 4 }}>
                {filtersText(i)} · {formatDateUTC(i.createdAt, { time: false })}{i.createdBy ? ` · ${i.createdBy}` : ''}
              </div>
            </div>
            <div style={{ width: 200 }}>
              <div style={{ fontSize: 13, color: C.greyT, marginBottom: 4, textAlign: 'right' }}>
                {nf.format(i.done)} / {nf.format(i.total)} réfs · {pct(i.done, i.total)} %
              </div>
              <Bar value={i.done} total={i.total} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function InventoryApp() {
  const { token, permissions, isSuperAdmin } = useContext(AuthContext);
  const canWrite = isSuperAdmin || permissions?.inventaire?.write === true;
  const [list, setList] = useState(null);
  const [view, setView] = useState(null);
  const [message, setMessage] = useState(null);

  const loadList = useCallback(async (openCurrent = false) => {
    try {
      const { data } = await axios.get(`${API_URL}/inventaire`, authHeaders(token));
      setList(data.inventories);
      if (openCurrent) {
        const current = data.inventories.find(i => i.status === 'open');
        setView(current ? { kind: 'detail', id: current.id } : { kind: 'list' });
      }
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
      setView({ kind: 'list' });
    }
  }, [token]);
  useEffect(() => { loadList(true); }, [loadList]);

  const showList = () => { loadList(); setView({ kind: 'list' }); };

  return (
    <AppShell currentPath="/inventaire">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 60px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, background: BLUE,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <InventoryIcon size={24} color="#fff" />
            </span>
            <h1 style={{ margin: 0, fontFamily: "'Tilt Warp', cursive", fontSize: 26, fontWeight: 900, color: C.primary }}>
              Inventaire
            </h1>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: C.greyT }}>Le comptage se fait au PDA : Inventaire</span>
          </div>

          {message && <Banner kind={message.kind} onClose={() => setMessage(null)}>{message.text}</Banner>}

          {!view && <p style={{ color: C.greyT }}>Chargement…</p>}
          {view?.kind === 'list' && list && (
            <ListView list={list} canWrite={canWrite} onOpen={(id) => setView({ kind: 'detail', id })} onCreate={() => setView({ kind: 'create' })} />
          )}
          {view?.kind === 'create' && (
            <CreateView
              token={token}
              onCancel={showList}
              onCreated={(id) => { setMessage({ kind: 'ok', text: 'Inventaire créé : il apparaît sur les PDA.' }); loadList(); setView({ kind: 'detail', id }); }}
            />
          )}
          {view?.kind === 'detail' && (
            <DetailView key={view.id} token={token} id={view.id} canWrite={canWrite} onBack={showList} setMessage={setMessage} />
          )}
        </div>
      </main>
    </AppShell>
  );
}
