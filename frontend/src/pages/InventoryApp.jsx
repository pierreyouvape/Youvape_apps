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
 * Lot 2 (23/10/2026) : onglet Écarts, envoi à BMS, clôture.
 *
 * Inventaire PAR EMPLACEMENT (04/11/2026) : un dossier sans filtre, où le PDA
 * scanne des emplacements ; chaque emplacement validé part aussitôt dans BMS.
 * Sa fiche (SpotDetailView) liste les passages, qui les a validés et quand.
 */

const BLUE = '#0369A1';
const BLUE_L = '#E0F2FE';
const nf = new Intl.NumberFormat('fr-FR');
const pct = (n, total) => (total ? Math.floor((n / total) * 100) : 0);
// WooCommerce stocke « & » en entité dans les noms de catégorie.
const decode = (s) => String(s || '').replace(/&amp;/g, '&');
const locLabel = (l) => l || 'Sans emplacement';
const SEP = '\u0001';
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
  if (inv.kind === 'location') return 'Par emplacement';
  const f = inv.filters || {};
  return [
    f.categories?.length && `Catégories : ${f.categories.map(decode).join(', ')}`,
    f.subCategories?.length && `Sous-catégories : ${f.subCategories.map(sc => decode(sc.name || sc)).join(', ')}`,
    f.brands?.length && `Marques : ${f.brands.map(decode).join(', ')}`,
    f.subBrands?.length && `Sous-marques : ${f.subBrands.map(sb => decode(sb.name || sb)).join(', ')}`,
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
            fontWeight: 600,
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

/** Enfants (sous-catégories, sous-marques) rangés sous le nom de leur parent. */
function ChildList({ title, groups, selected, onToggle }) {
  return (
    <div style={{ ...panel, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong style={{ flex: 1, fontSize: 14 }}>{title}</strong>
        {selected.size > 0 && <Chip color={BLUE} bg={BLUE_L}>{selected.size}</Chip>}
      </div>
      <div style={{ overflowY: 'auto', maxHeight: 382 }}>
        {groups.length === 0 && <p style={{ fontSize: 13, color: C.greyT, margin: 4 }}>Aucune.</p>}
        {groups.map(g => (
          <div key={g.parent}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.greyT, textTransform: 'uppercase', margin: '8px 2px 2px' }}>{decode(g.parent)}</div>
            {g.children.map(c => {
              const key = `${g.parent}${SEP}${c.name}`;
              return (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 13.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.has(key)} onChange={() => onToggle(key)} />
                  <span style={{ flex: 1 }}>{decode(c.name)}</span>
                  <span style={{ color: C.greyT, fontSize: 12 }}>{nf.format(c.count)}</span>
                </label>
              );
            })}
          </div>
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
  // Une sous-catégorie = son couple catégorie + nom (SEP) : des noms existent sous plusieurs catégories.
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
    categories: [...cats],
    subCategories: [...subs].map(k => { const [category, name] = k.split(SEP); return { category, name }; }),
    brands: [...brands],
    subBrands: [...subBrands].map(k => { const [brand, name] = k.split(SEP); return { brand, name }; }),
  }), [cats, subs, brands, subBrands]);
  const picked = [...cats, ...[...subs].map(k => k.split(SEP)[1]), ...brands, ...[...subBrands].map(k => k.split(SEP)[1])];
  const empty = kind === 'partial' && picked.length === 0;
  const spot = kind === 'location';

  useEffect(() => {
    if (empty || spot) { setPreview(null); return undefined; }
    const t = setTimeout(() => {
      axios.post(`${API_URL}/inventaire/preview`, { kind, filters }, authHeaders(token))
        .then(r => setPreview(r.data))
        .catch(err => setError(err.response?.data?.error || err.message));
    }, 250);
    return () => clearTimeout(t);
  }, [token, kind, filters, empty, spot]);

  const toggle = (setter) => (value) => setter(prev => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });

  const autoName = kind === 'global' ? `Inventaire global du ${today}`
    : spot ? `Inventaire par emplacement du ${today}`
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

  // Décocher un parent retire les enfants qu'on y avait cochés (ils ne sont plus affichés).
  const toggleParent = (selected, setParent, setChildren) => (name) => {
    if (selected.has(name)) setChildren(prev => new Set([...prev].filter(k => k.split(SEP)[0] !== name)));
    toggle(setParent)(name);
  };
  const catItems = (options?.categories || []).map(c => ({
    key: `c:${c.name}`, value: c.name, count: c.count, checked: cats.has(c.name),
    onToggle: () => toggleParent(cats, setCats, setSubs)(c.name),
  }));
  // Marques présentes dans les catégories cochées (même règle que le serveur :
  // une catégorie seule est entière, ses sous-catégories cochées la limitent),
  // recomptées. Une marque cochée reste affichée même si elle sort du filtre.
  const brandOptions = useMemo(() => {
    const narrowed = new Set([...subs].map(k => k.split(SEP)[0]));
    const inCats = (r) => (!cats.size && !subs.size)
      || (cats.has(r.c) && !narrowed.has(r.c))
      || subs.has(`${r.c}${SEP}${r.sc}`);
    const byBrand = new Map();
    for (const r of options?.combos || []) {
      if (!inCats(r)) continue;
      const b = byBrand.get(r.b) || { name: r.b, count: 0, subBrands: new Map() };
      b.count += r.n;
      if (r.sb) b.subBrands.set(r.sb, (b.subBrands.get(r.sb) || 0) + r.n);
      byBrand.set(r.b, b);
    }
    for (const name of brands) if (!byBrand.has(name)) byBrand.set(name, { name, count: 0, subBrands: new Map() });
    for (const k of subBrands) {
      const [brand, name] = k.split(SEP);
      if (!byBrand.has(brand)) byBrand.set(brand, { name: brand, count: 0, subBrands: new Map() });
      if (!byBrand.get(brand).subBrands.has(name)) byBrand.get(brand).subBrands.set(name, 0);
    }
    const sortFr = (a, b) => a.name.localeCompare(b.name, 'fr');
    return [...byBrand.values()].sort(sortFr).map(b => ({
      name: b.name,
      count: b.count,
      subBrands: [...b.subBrands].map(([name, count]) => ({ name, count })).sort(sortFr),
    }));
  }, [options, cats, subs, brands, subBrands]);

  const q = brandSearch.trim().toLowerCase();
  const brandItems = brandOptions
    .filter(b => !q || decode(b.name).toLowerCase().includes(q))
    .map(b => ({
      key: `b:${b.name}`, value: b.name, count: b.count, checked: brands.has(b.name),
      onToggle: () => toggleParent(brands, setBrands, setSubBrands)(b.name),
    }));
  // Les enfants des parents cochés ; tous si aucun ne l'est.
  const childGroups = (parents, selected, childKey) => parents
    .filter(p => p[childKey].length && (!selected.size || selected.has(p.name)))
    .map(p => ({ parent: p.name, children: p[childKey] }));
  const subGroups = childGroups(options?.categories || [], cats, 'subCategories');
  const subBrandGroups = childGroups(brandOptions, brands, 'subBrands');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}
      <div style={{ ...panel, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            ['partial', 'Partiel', 'Catégories, marques, sous-marques'],
            ['global', 'Global', 'Tout le catalogue en stock'],
            ['location', 'Par emplacement', 'On scanne des emplacements au PDA, corrigés aussitôt dans BMS'],
          ].map(([k, label, hint]) => (
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
            Une catégorie ou une marque cochée seule est prise entière ; cochez ensuite ses
            sous-catégories ou sous-marques pour la limiter à celles-ci. Les marques proposées sont
            celles des catégories cochées, et l'inventaire porte sur leur croisement.
          </p>
          {!options && <p style={{ color: C.greyT }}>Chargement…</p>}
          {options && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <CheckList title="Catégories" items={catItems} selectedCount={cats.size} />
              <ChildList title="Sous-catégories" groups={subGroups} selected={subs} onToggle={toggle(setSubs)} />
              <CheckList title="Marques" items={brandItems} selectedCount={brands.size}
                search={brandSearch} onSearch={setBrandSearch} />
              <ChildList title="Sous-marques" groups={subBrandGroups} selected={subBrands} onToggle={toggle(setSubBrands)} />
            </div>
          )}
        </>
      )}

      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, fontSize: 15 }}>
          {spot && (
            <span style={{ color: C.greyT }}>
              Au PDA, on scanne un emplacement : ses produits s'affichent avec leur quantité BMS, qu'on corrige.
              Chaque emplacement validé part aussitôt dans BMS.
            </span>
          )}
          {!spot && empty && <span style={{ color: C.greyT }}>Choisissez au moins une catégorie, sous-catégorie ou marque.</span>}
          {!spot && !empty && !preview && <span style={{ color: C.greyT }}>Calcul…</span>}
          {!spot && !empty && preview && (
            <span>
              <strong>{nf.format(preview.refs)}</strong> références à compter sur <strong>{nf.format(preview.locations)}</strong> emplacements
              {preview.withoutLocation > 0 && <span style={{ color: C.amber }}> — dont {nf.format(preview.withoutLocation)} sans emplacement</span>}
              {preview.excluded > 0 && (
                <div style={{ fontSize: 13.5, color: C.amber, marginTop: 4 }}>
                  {nf.format(preview.excluded)} référence(s) exclue(s) : déjà dans {preview.excludedIn.map(n => `« ${n} »`).join(', ')}, en cours.
                </div>
              )}
            </span>
          )}
        </div>
        <button onClick={onCancel} style={btn('ghost')}>Annuler</button>
        <button onClick={create} disabled={(!spot && (empty || !preview?.refs)) || saving} style={{ ...btn(), opacity: (!spot && (empty || !preview?.refs)) || saving ? 0.5 : 1 }}>
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
  if (inv.kind === 'location') {
    return <SpotDetailView token={token} inv={inv} canWrite={canWrite} onBack={onBack} setMessage={setMessage} reload={load} />;
  }

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
          <button
            onClick={() => act('/close', `Clôturer « ${inv.name} » ? Il ne pourra plus bouger.`, 'Inventaire clôturé.')}
            disabled={!inv.closing?.closable}
            title={inv.closing?.closable ? '' : `Pas encore : ${inv.closing?.reasons.join(', ')}`}
            style={{ ...btn(), background: C.green, opacity: inv.closing?.closable ? 1 : 0.45 }}
          >
            Clôturer
          </button>
        )}
        {open && canWrite && (
          <button onClick={() => act('/cancel', `Annuler « ${inv.name} » ? Les comptages sont conservés mais l'inventaire ne pourra plus avancer.`, 'Inventaire annulé.')} style={btn('danger')}>
            Annuler l'inventaire
          </button>
        )}
      </div>

      {open && inv.closing && !inv.closing.closable && (
        <div style={{ fontSize: 13, color: C.greyT, marginTop: -8 }}>
          Avant de clôturer : {inv.closing.reasons.join(' · ')}.
        </div>
      )}

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
          { key: 'gaps', label: 'Écarts' },
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
                border: `2px solid ${aisle === a.key ? BLUE : C.greyB}`, color: C.dark,
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

      {tab === 'gaps' && (
        <GapsView token={token} id={id} canWrite={canWrite && open} setMessage={setMessage} onChanged={load} />
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

// ── Écarts (lot 2) ──────────────────────────────────────────────────────────

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const signed = (n) => (n > 0 ? `+${nf.format(n)}` : nf.format(n));

const GAP_STATE = {
  todo: { label: 'À traiter', color: C.accent, bg: C.accentL },
  queued: { label: 'En file', color: C.blue, bg: C.blueL },
  sending: { label: 'Envoi…', color: C.blue, bg: C.blueL },
  sent: { label: 'Envoyé', color: C.green, bg: C.greenL },
  error: { label: 'Erreur', color: C.red, bg: C.redL },
  ignored: { label: 'Écarté', color: C.greyT, bg: C.grey },
  conform: { label: 'Conforme', color: C.green, bg: C.greenL },
  unknown: { label: 'Inconnu de BMS', color: C.red, bg: C.redL },
};

const GAP_FILTERS = [
  { key: 'todo', label: 'À traiter', test: g => ['todo', 'error', 'queued', 'sending', 'unknown'].includes(g.state) || (g.elsewhere.length > 0 && !g.locationFixedTo) },
  { key: 'sent', label: 'Envoyés', test: g => g.state === 'sent' },
  { key: 'ignored', label: 'Écartés', test: g => g.state === 'ignored' },
  { key: 'conform', label: 'Conformes', test: g => g.state === 'conform' },
  { key: 'all', label: 'Tout', test: () => true },
];

/**
 * Écart de chaque référence au comptage définitif (emplacements validés ou
 * recomptée) : théorique relevé au comptage, compté, écart et sa valeur HT.
 * Le responsable envoie à BMS (mouvement de l'écart), écarte, ou fait recompter.
 */
function GapsView({ token, id, canWrite, setMessage, onChanged }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('todo');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/inventaire/${id}/gaps`, authHeaders(token));
      setRows(data.gaps);
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  }, [token, id, setMessage]);
  useEffect(() => { load(); }, [load]);

  // Envois en cours : on suit la file de près.
  const inFlight = (rows || []).some(g => g.state === 'queued' || g.state === 'sending');
  useEffect(() => {
    if (!inFlight) return undefined;
    const t = setInterval(() => { load(); onChanged(); }, 4000);
    return () => clearInterval(t);
  }, [inFlight, load, onChanged]);

  const post = async (url, body, done) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API_URL}/inventaire/${id}${url}`, body, authHeaders(token));
      if (done) setMessage({ kind: 'ok', text: done(data) });
      setSelected(new Set());
      await load();
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  };

  if (!rows) return <p style={{ color: C.greyT }}>Chargement…</p>;

  const f = GAP_FILTERS.find(x => x.key === filter);
  const shown = rows.filter(f.test);
  const count = (k) => rows.filter(GAP_FILTERS.find(x => x.key === k).test).length;
  const selectable = (g) => canWrite && ['todo', 'error'].includes(g.state);
  const picked = rows.filter(g => selected.has(g.id));
  const pickedTodo = picked.filter(g => g.state === 'todo');
  const pickedErr = picked.filter(g => g.state === 'error');

  // Ce qui reste à décider, en pièces et en valeur.
  const todo = rows.filter(g => g.state === 'todo');
  const plus = todo.filter(g => g.gap > 0);
  const minus = todo.filter(g => g.gap < 0);
  const sum = (list, k) => list.reduce((a, g) => a + (g[k] || 0), 0);
  const sent = rows.filter(g => g.state === 'sent');

  const toggle = (gid) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(gid)) next.delete(gid); else next.add(gid);
    return next;
  });
  const allIds = shown.filter(selectable).map(g => g.id);
  const allChecked = allIds.length > 0 && allIds.every(x => selected.has(x));

  const send = () => {
    const p = sum(pickedTodo.filter(g => g.gap > 0), 'gap');
    const m = sum(pickedTodo.filter(g => g.gap < 0), 'gap');
    const v = sum(pickedTodo, 'value');
    if (!window.confirm(`Envoyer ${pickedTodo.length} écart(s) à BMS ?\n\nEntrées : ${signed(p)} · Sorties : ${signed(m)} pièces\nValeur nette : ${eur.format(v)} HT\n\nChaque écart part en mouvement d'ajustement.`)) return;
    post('/gaps/send', { itemIds: pickedTodo.map(g => g.id) }, d => `${d.queued} écart(s) en cours d'envoi à BMS.`);
  };
  const ignore = () => {
    const list = [...pickedTodo, ...pickedErr];
    if (!window.confirm(`Écarter ${list.length} écart(s) ? Rien ne partira dans BMS pour ces références.`)) return;
    post('/gaps/ignore', { itemIds: list.map(g => g.id) }, d => `${d.ignored} écart(s) écarté(s).`);
  };
  const retry = () => {
    const uncertain = pickedErr.some(g => /VÉRIFIEZ/.test(g.pushError || ''));
    if (uncertain && !window.confirm('Certains envois ont eu une réponse BMS incertaine : avez-vous vérifié dans BMS que le mouvement n\'est PAS passé ? Sinon il partira deux fois.')) return;
    post('/gaps/retry', { itemIds: pickedErr.map(g => g.id) }, d => `${d.queued} envoi(s) relancé(s).`);
  };
  const recount = (g) => {
    if (!window.confirm(`Faire recompter « ${g.name} » au PDA ? Le nouveau comptage fera foi.`)) return;
    post(`/items/${g.id}/recount`, {}, () => 'Référence renvoyée au recomptage (PDA › À recompter).');
  };
  const fixLocation = (g, loc) => {
    if (!window.confirm(`Ranger « ${g.name} » en ${loc} dans BMS (au lieu de ${g.currentLocation || 'aucun emplacement'}) ?`)) return;
    post(`/items/${g.id}/location`, { location: loc }, d => `Emplacement BMS : ${d.location}.`);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Kpi label="Écarts à traiter" value={nf.format(todo.length)} sub={`${count('conform')} référence(s) conforme(s)`} color={todo.length ? C.accent : undefined} />
        <Kpi label="En plus" value={`${signed(sum(plus, 'gap'))} pcs`} sub={eur.format(sum(plus, 'value'))} />
        <Kpi label="En moins" value={`${signed(sum(minus, 'gap'))} pcs`} sub={eur.format(sum(minus, 'value'))} />
        <Kpi label="Valeur nette à traiter" value={eur.format(sum(todo, 'value'))} sub="HT, au coût du catalogue" />
        <Kpi label="Envoyés à BMS" value={nf.format(sent.length)} sub={`${eur.format(sum(sent, 'value'))} HT`} />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {GAP_FILTERS.map(x => (
          <button key={x.key} onClick={() => { setFilter(x.key); setSelected(new Set()); }} style={{
            ...btn('ghost'), padding: '6px 12px', fontSize: 13,
            background: filter === x.key ? BLUE : C.white, color: filter === x.key ? C.white : C.dark,
            border: `1px solid ${filter === x.key ? BLUE : C.greyB}`,
          }}>{x.label} ({count(x.key)})</button>
        ))}
        <span style={{ flex: 1 }} />
        {canWrite && pickedTodo.length > 0 && (
          <button disabled={busy} onClick={send} style={btn()}>Envoyer à BMS ({pickedTodo.length})</button>
        )}
        {canWrite && pickedErr.length > 0 && (
          <button disabled={busy} onClick={retry} style={btn()}>Réessayer ({pickedErr.length})</button>
        )}
        {canWrite && (pickedTodo.length + pickedErr.length) > 0 && (
          <button disabled={busy} onClick={ignore} style={btn('ghost')}>Écarter ({pickedTodo.length + pickedErr.length})</button>
        )}
      </div>

      <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {canWrite && (
                <th style={{ ...th, width: 30 }}>
                  <input type="checkbox" checked={allChecked} disabled={!allIds.length}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(allIds))} />
                </th>
              )}
              <th style={th}>Produit</th><th style={th}>Emplacement</th>
              <th style={{ ...th, textAlign: 'right' }}>Théorique</th><th style={{ ...th, textAlign: 'right' }}>Compté</th>
              <th style={{ ...th, textAlign: 'right' }}>Écart</th><th style={{ ...th, textAlign: 'right' }}>Valeur HT</th>
              <th style={th}>État</th>{canWrite && <th style={th} />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td style={{ ...td, color: C.greyT }} colSpan={canWrite ? 9 : 7}>
                {rows.length === 0 ? 'Aucune référence au comptage définitif pour l\'instant (emplacements à valider, relevés en cours).' : 'Rien ici.'}
              </td></tr>
            )}
            {shown.map(g => {
              const gs = GAP_STATE[g.state];
              return (
                <tr key={g.id}>
                  {canWrite && (
                    <td style={td}>
                      {selectable(g) && <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} />}
                    </td>
                  )}
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: C.greyT, fontFamily: 'monospace' }}>{g.sku}{g.brand ? ` · ${g.brand}` : ''}</div>
                  </td>
                  <td style={{ ...td, fontSize: 12.5 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{locLabel(g.currentLocation)}</span>
                    {g.locationFixedTo && <div style={{ color: C.green }}>rangé en {g.locationFixedTo}</div>}
                    {!g.locationFixedTo && g.elsewhere.map(loc => (
                      <div key={loc} style={{ color: C.amber, display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        trouvé en <strong style={{ fontFamily: 'monospace' }}>{loc}</strong>
                        {canWrite && (
                          <button disabled={busy} onClick={() => fixLocation(g, loc)} style={{ ...btn('ghost'), padding: '2px 8px', fontSize: 12 }}>
                            Ranger ici
                          </button>
                        )}
                      </div>
                    ))}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{g.theoretical ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {g.counted}
                    {g.recounted && <div style={{ fontSize: 11.5, color: C.greyT }}>recompté{g.firstCounted != null ? ` (1er : ${g.firstCounted})` : ''}</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: g.gap > 0 ? C.green : g.gap < 0 ? C.red : C.greyT }}>
                    {g.gap == null ? '—' : signed(g.gap)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: g.value > 0 ? C.green : g.value < 0 ? C.red : C.greyT }}>
                    {g.value == null ? '—' : eur.format(g.value)}
                  </td>
                  <td style={{ ...td, fontSize: 12.5 }}>
                    <Chip color={gs.color} bg={gs.bg}>{gs.label}</Chip>
                    {g.state === 'sent' && (
                      <div style={{ color: C.greyT, marginTop: 3 }}>
                        {signed(g.pushQty)} · {g.decidedBy}{g.bmsMovementId ? ` · mvt ${g.bmsMovementId}` : ''}
                      </div>
                    )}
                    {g.state === 'ignored' && <div style={{ color: C.greyT, marginTop: 3 }}>par {g.decidedBy}</div>}
                    {g.state === 'error' && <div style={{ color: C.red, marginTop: 3, maxWidth: 280 }}>{g.pushError}</div>}
                  </td>
                  {canWrite && (
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {['todo', 'error', 'ignored', 'conform'].includes(g.state) && (
                        <button disabled={busy} onClick={() => recount(g)} style={{ ...btn('ghost'), padding: '5px 10px', fontSize: 12.5 }}>
                          Recompter
                        </button>
                      )}
                      {g.state === 'ignored' && (
                        <button disabled={busy} onClick={() => post('/gaps/unignore', { itemIds: [g.id] }, () => 'Écart rétabli.')}
                          style={{ ...btn('ghost'), padding: '5px 10px', fontSize: 12.5, marginLeft: 6 }}>
                          Rétablir
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
    </div>
  );
}

// ── Inventaire par emplacement ──────────────────────────────────────────────

const PASS_STATUS = {
  counting: { label: 'En cours', color: C.amber, bg: C.amberL },
  validated: { label: 'Validé', color: C.green, bg: C.greenL },
  abandoned: { label: 'Abandonné', color: C.greyT, bg: C.grey },
};
const PUSH_STATE = {
  queued: { label: 'En file', color: C.blue, bg: C.blueL },
  sending: { label: 'Envoi…', color: C.blue, bg: C.blueL },
  sent: { label: 'Envoyé', color: C.green, bg: C.greenL },
  error: { label: 'Erreur', color: C.red, bg: C.redL },
  ignored: { label: 'Laissé tombé', color: C.greyT, bg: C.grey },
};

/** Ce qui est arrivé à la ligne, en clair. */
const spotOutcome = (l) => {
  if (l.lockedBy) return `Inventaire « ${l.lockedBy} »`;
  if (l.refError) return l.refError;
  if (l.outcome === 'moved') return `Rangé ailleurs → ${l.movedTo}`;
  if (l.added) return `Ajouté ici${l.fromLocation ? ` (était en ${l.fromLocation})` : ''}`;
  if (l.qty == null) return l.shownQty === 0 ? 'À 0, pas touché' : 'Pas vu';
  if (l.qty === 0 && l.shownQty > 0) return 'Mis à 0';
  return l.qty === l.shownQty ? 'Vu' : 'Corrigé';
};

function SpotDetailView({ token, inv, canWrite, onBack, setMessage, reload }) {
  const [openId, setOpenId] = useState(null);
  const [filter, setFilter] = useState('');
  const open = inv.status === 'open';
  const st = INV_STATUS[inv.status];

  // Envois en cours : on suit la file de près.
  const inFlight = inv.passes.some(p => p.lines.some(l => l.pushStatus === 'queued' || l.pushStatus === 'sending'));
  useEffect(() => {
    if (!inFlight) return undefined;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [inFlight, reload]);

  const act = async (url, body, confirmText, done) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await axios.post(`${API_URL}/inventaire/${inv.id}${url}`, body, authHeaders(token));
      if (done) setMessage({ kind: 'ok', text: done });
      reload();
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  };

  const stats = (p) => {
    const gaps = p.lines.filter(l => l.gap);
    return {
      gaps: gaps.length,
      pieces: gaps.reduce((a, l) => a + l.gap, 0),
      value: gaps.reduce((a, l) => a + (l.value || 0), 0),
      errors: p.lines.filter(l => l.pushStatus === 'error').length,
      sending: p.lines.filter(l => l.pushStatus === 'queued' || l.pushStatus === 'sending').length,
    };
  };
  const validated = inv.passes.filter(p => p.status === 'validated');
  const all = validated.map(stats);
  const sum = (k) => all.reduce((a, x) => a + x[k], 0);
  const shown = inv.passes.filter(p => {
    const x = stats(p);
    if (filter === 'gaps') return x.gaps > 0;
    if (filter === 'errors') return x.errors > 0;
    if (filter === 'counting') return p.status === 'counting';
    return true;
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ fontSize: 18 }}>{inv.name}</strong>
            <Chip color={st.color} bg={st.bg}>{st.label}</Chip>
          </div>
          <div style={{ fontSize: 13, color: C.greyT, marginTop: 4 }}>
            Par emplacement · créé le {formatDateUTC(inv.createdAt, { time: false })}{inv.createdBy ? ` par ${inv.createdBy}` : ''}
          </div>
        </div>
        <button onClick={onBack} style={btn('ghost')}>Tous les inventaires</button>
        {open && canWrite && (
          <button
            onClick={() => act('/close', {}, `Clôturer « ${inv.name} » ? On ne pourra plus y compter.`, 'Inventaire clôturé.')}
            disabled={!inv.closing?.closable}
            title={inv.closing?.closable ? '' : `Pas encore : ${inv.closing?.reasons.join(', ')}`}
            style={{ ...btn(), background: C.green, opacity: inv.closing?.closable ? 1 : 0.45 }}
          >
            Clôturer
          </button>
        )}
        {open && canWrite && (
          <button onClick={() => act('/cancel', {}, `Annuler « ${inv.name} » ? Les emplacements en cours sont abandonnés ; ce qui est validé reste envoyé à BMS.`, 'Inventaire annulé.')} style={btn('danger')}>
            Annuler l'inventaire
          </button>
        )}
      </div>

      {open && inv.closing && !inv.closing.closable && (
        <div style={{ fontSize: 13, color: C.greyT, marginTop: -8 }}>Avant de clôturer : {inv.closing.reasons.join(' · ')}.</div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Kpi label="Emplacements validés" value={nf.format(validated.length)}
          sub={`${inv.passes.filter(p => p.status === 'counting').length} en cours`} />
        <Kpi label="Lignes corrigées" value={nf.format(sum('gaps'))} sub={`${signed(sum('pieces'))} pièce(s) au total`} />
        <Kpi label="Valeur des écarts" value={eur.format(sum('value'))} sub="HT, au coût de revient" />
        <Kpi label="Envois BMS" value={sum('errors') ? `${sum('errors')} erreur(s)` : sum('sending') ? `${sum('sending')} en cours` : 'À jour'}
          color={sum('errors') ? C.red : undefined} />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={field}>
          <option value="">Tous les emplacements</option>
          <option value="gaps">Avec écart</option>
          <option value="errors">Avec erreur BMS</option>
          <option value="counting">En cours</option>
        </select>
        <span style={{ fontSize: 13, color: C.greyT }}>{shown.length} passage(s) · cliquez sur une ligne pour le détail</span>
      </div>

      <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Emplacement</th><th style={th}>Statut</th><th style={th}>Par</th><th style={th}>Validé le</th>
              <th style={th}>Produits</th><th style={th}>Écarts</th><th style={th}>Valeur</th><th style={th}>BMS</th><th style={th}>Mail</th>
              {canWrite && open && <th style={th} />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td style={{ ...td, color: C.greyT }} colSpan={10}>Aucun emplacement pour l'instant.</td></tr>}
            {shown.map(p => {
              const x = stats(p);
              const ps = PASS_STATUS[p.status];
              const expanded = openId === p.id;
              return [
                <tr key={p.id} onClick={() => setOpenId(expanded ? null : p.id)} style={{ cursor: 'pointer', background: expanded ? BLUE_L : undefined }}>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700 }}>{p.location}</td>
                  <td style={td}><Chip color={ps.color} bg={ps.bg}>{ps.label}</Chip></td>
                  <td style={td}>{p.validatedBy || p.startedBy}</td>
                  <td style={td}>{p.validatedAt ? formatDateUTC(p.validatedAt) : p.abandonedAt ? `abandonné ${formatDateUTC(p.abandonedAt)}` : ''}</td>
                  <td style={td}>{p.lines.length}</td>
                  <td style={td}>{x.gaps ? `${x.gaps} (${signed(x.pieces)})` : ''}</td>
                  <td style={td}>{x.gaps ? eur.format(x.value) : ''}</td>
                  <td style={td}>
                    {x.errors > 0 && <Chip color={C.red} bg={C.redL}>{x.errors} erreur(s)</Chip>}
                    {!x.errors && x.sending > 0 && <Chip color={C.blue} bg={C.blueL}>Envoi…</Chip>}
                    {!x.errors && !x.sending && p.status === 'validated' && <Chip color={C.green} bg={C.greenL}>Envoyé</Chip>}
                  </td>
                  <td style={{ ...td, fontSize: 12.5 }}>
                    {p.mailDoneAt ? (p.mailRows ? `${p.mailRows} produit(s)` : 'Rien à signaler') : p.mailError ? <span style={{ color: C.red }}>Échec</span> : ''}
                  </td>
                  {canWrite && open && (
                    <td style={{ ...td, textAlign: 'right' }}>
                      {p.status === 'counting' && (
                        <button onClick={(e) => { e.stopPropagation(); act(`/spot-passes/${p.id}/abandon`, {}, `Libérer ${p.location} (pris par ${p.startedBy}) ? Rien de ce passage ne sera envoyé.`, `${p.location} libéré.`); }}
                          style={{ ...btn('ghost'), padding: '5px 10px', fontSize: 12.5 }}>
                          Libérer
                        </button>
                      )}
                    </td>
                  )}
                </tr>,
                expanded && (
                  <tr key={`${p.id}-lines`}>
                    <td colSpan={10} style={{ padding: 0, background: C.grey }}>
                      <SpotLines pass={p} canWrite={canWrite && open} act={act} />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SpotLines({ pass, canWrite, act }) {
  const sub = { ...th, background: C.grey, fontSize: 11 };
  return (
    <div style={{ padding: '6px 12px 12px' }}>
      {pass.mailError && <div style={{ fontSize: 12.5, color: C.red, margin: '6px 0' }}>Mail non envoyé : {pass.mailError}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', background: C.white }}>
        <thead>
          <tr>
            <th style={sub}>Produit</th><th style={sub}>SKU</th><th style={sub}>Affiché</th><th style={sub}>Compté</th>
            <th style={sub}>Théorique à l'envoi</th><th style={sub}>Écart</th><th style={sub}>Valeur</th><th style={sub}>Ce qui s'est passé</th>
            <th style={sub}>BMS</th>
          </tr>
        </thead>
        <tbody>
          {pass.lines.length === 0 && <tr><td style={{ ...td, color: C.greyT }} colSpan={9}>Aucun produit.</td></tr>}
          {pass.lines.map(l => {
            const ps = l.pushStatus && PUSH_STATE[l.pushStatus];
            return (
              <tr key={l.id}>
                <td style={td}>{l.name}{l.notPublished && <span style={{ color: C.greyT, fontSize: 12 }}> · non publié</span>}</td>
                <td style={{ ...td, fontFamily: 'monospace' }}>{l.sku}</td>
                <td style={td}>{l.shownQty ?? '—'}</td>
                <td style={td}>{l.qty ?? '—'}</td>
                <td style={td}>{l.theoretical ?? ''}</td>
                <td style={{ ...td, fontWeight: 700, color: l.gap > 0 ? C.green : l.gap < 0 ? C.red : C.dark }}>{l.gap ? signed(l.gap) : ''}</td>
                <td style={td}>{l.gap ? eur.format(l.value) : ''}</td>
                <td style={td}>{spotOutcome(l)}</td>
                <td style={td}>
                  {ps && <Chip color={ps.color} bg={ps.bg}>{ps.label}</Chip>}
                  {l.bmsMovementId && <span style={{ fontSize: 12, color: C.greyT }}> n° {l.bmsMovementId}</span>}
                  {l.pushError && <div style={{ fontSize: 12, color: C.red, marginTop: 3 }}>{l.pushError}</div>}
                  {canWrite && l.pushStatus === 'error' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <button onClick={() => act('/spot-lines/retry', { lineIds: [l.id] }, l.pushError?.includes('VÉRIFIEZ') ? 'Avez-vous vérifié dans BMS que le mouvement n\'est pas passé ?' : null, 'Envoi relancé.')}
                        style={{ ...btn('ghost'), padding: '4px 8px', fontSize: 12 }}>Réessayer</button>
                      <button onClick={() => act('/spot-lines/ignore', { lineIds: [l.id] }, 'Laisser tomber cet envoi ? Rien ne partira dans BMS pour cette ligne.', 'Envoi laissé de côté.')}
                        style={{ ...btn('ghost'), padding: '4px 8px', fontSize: 12 }}>Laisser tomber</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Liste ───────────────────────────────────────────────────────────────────

function ListView({ list, canWrite, onOpen, onCreate }) {

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {canWrite && (
        <div>
          <button onClick={onCreate} style={btn()}>
            Nouvel inventaire
          </button>
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
            {i.kind === 'location' ? (
              <div style={{ width: 200, fontSize: 13, color: C.greyT, textAlign: 'right' }}>
                {nf.format(i.passes)} emplacement(s) validé(s)
              </div>
            ) : (
              <div style={{ width: 200 }}>
                <div style={{ fontSize: 13, color: C.greyT, marginBottom: 4, textAlign: 'right' }}>
                  {nf.format(i.done)} / {nf.format(i.total)} réfs · {pct(i.done, i.total)} %
                </div>
                <Bar value={i.done} total={i.total} />
              </div>
            )}
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
