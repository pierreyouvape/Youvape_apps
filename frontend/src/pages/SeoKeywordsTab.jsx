import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { ResponsiveContainer, BarChart, Bar, Tooltip } from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  rouge: '#DE2020', vert: '#4AB866', orange: '#E28F00',
  bleu: '#0071EB', saphir: '#135E84', saphirF: '#003A56',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF', violet: '#7C3AED',
};
const MAX_KEYWORDS = 10;
const GEOS = [
  { value: 'fr', label: 'France' },
  { value: 'be', label: 'Belgique' },
  { value: 'ch', label: 'Suisse' },
];
const COMP_COLOR = { faible: C.vert, moyenne: C.orange, forte: C.rouge };

const fmtInt = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('fr-FR').format(n));
const fmtEur = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(2).replace('.', ',')} €`);
const frDateTime = (d) => new Date(d).toLocaleDateString('fr-FR');

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: C.grisM, fontWeight: 600, borderBottom: `1px solid ${C.grisCL}`, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: 13, color: C.grisTF, borderBottom: `1px solid ${C.grisTL}`, verticalAlign: 'middle' };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const btn = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.saphir}`, background: C.blanc, color: C.saphir, cursor: 'pointer', fontSize: 13 };
const btnPlein = { ...btn, background: C.saphir, color: C.blanc };
const input = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.grisCL}`, fontSize: 13 };

function Card({ children, style }) {
  return <div style={{ background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, padding: '16px 18px', marginBottom: 16, ...style }}>{children}</div>;
}

const parseKeywords = (text) => [...new Set(text.split(/[\n,;]/).map((k) => k.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))];

/* 12 derniers mois en petites barres. */
function Trend({ mois }) {
  if (!mois?.length) return <span style={{ color: C.grisM }}>—</span>;
  const data = mois.map((m) => ({ ...m, label: `${m.mois.slice(5, 7)}/${m.mois.slice(2, 4)}` }));
  return (
    <div style={{ width: 110, height: 28 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Tooltip
            cursor={{ fill: C.grisTL }}
            contentStyle={{ fontSize: 12, padding: '4px 8px' }}
            formatter={(v) => [fmtInt(v), 'recherches']}
            labelFormatter={(_, p) => p?.[0]?.payload?.label || ''}
          />
          <Bar dataKey="volume" fill={C.violet} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Competition({ value }) {
  if (!value) return <span style={{ color: C.grisM }}>—</span>;
  return <span style={{ color: COMP_COLOR[value], fontWeight: 600 }}>{value}</span>;
}

function Rows({ rows, onAdd }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Requête</th>
            <th style={{ ...th, textAlign: 'right' }}>Recherches / mois</th>
            <th style={th}>12 derniers mois</th>
            <th style={th}>Concurrence pub</th>
            <th style={{ ...th, textAlign: 'right' }}>Enchère haut de page</th>
            {onAdd && <th style={th} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.requete}>
              <td style={td}>
                {r.requete}
                {r.variantes?.length > 1 && (
                  <div style={{ fontSize: 11, color: C.grisM, marginTop: 2 }}>
                    Regroupe : {r.variantes.filter((v) => v !== r.requete).join(', ')}
                  </div>
                )}
              </td>
              <td style={{ ...tdNum, fontWeight: 700 }}>{fmtInt(r.volume)}</td>
              <td style={td}><Trend mois={r.mois} /></td>
              <td style={td}><Competition value={r.concurrence} /></td>
              <td style={tdNum}>{r.cpc_bas || r.cpc_haut ? `${fmtEur(r.cpc_bas)} – ${fmtEur(r.cpc_haut)}` : '—'}</td>
              {onAdd && (
                <td style={{ ...td, textAlign: 'right' }}>
                  <button type="button" style={{ ...btn, padding: '3px 9px', fontSize: 12 }} onClick={() => onAdd(r.requete)} title="Ajouter à la recherche">
                    + Ajouter
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const toCsv = (rows) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Requête', 'Recherches / mois', 'Concurrence', 'Enchère basse (€)', 'Enchère haute (€)'].join(';')];
  rows.forEach((r) => lines.push([esc(r.requete), r.volume ?? '', r.concurrence ?? '', r.cpc_bas?.toFixed(2).replace('.', ',') ?? '', r.cpc_haut?.toFixed(2).replace('.', ',') ?? ''].join(';')));
  return `\uFEFF${lines.join('\r\n')}`;
};

export default function SeoKeywordsTab() {
  const [text, setText] = useState(() => {
    try { return localStorage.getItem('seo-keywords-text') || ''; } catch { return ''; }
  });
  const [geo, setGeo] = useState('fr');
  const [withIdeas, setWithIdeas] = useState(true);
  const [result, setResult] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    axios.get(`${API_URL}/seo/keywords/usage`).then(({ data }) => setUsage(data)).catch(() => {});
  }, []);

  useEffect(() => {
    try { localStorage.setItem('seo-keywords-text', text); } catch { /* navigation privée */ }
  }, [text]);

  const keywords = parseKeywords(text);
  const tooMany = keywords.length > MAX_KEYWORDS;
  const quotaFull = usage && usage.ops >= usage.cap;

  const search = async () => {
    if (!keywords.length || tooMany || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.post(`${API_URL}/seo/keywords`, { keywords, geo, ideas: withIdeas });
      setResult({ ...data, geo });
      setUsage(data.usage);
      setFilter('');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  const addKeyword = (k) => {
    if (keywords.includes(k)) return;
    setText((t) => (t.trim() ? `${t.trim()}\n${k}` : k));
  };

  const ideas = useMemo(() => {
    if (!result) return [];
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return result.idees.filter((r) => words.every((w) => r.requete.includes(w)));
  }, [result, filter]);

  const download = () => {
    const blob = new Blob([toCsv([...result.volumes, ...result.idees])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mots-cles-${keywords.slice(0, 3).join('-').replace(/[^a-z0-9-]+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 340px', minWidth: 0 }}>
            <label htmlFor="kw-input" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.saphirF, marginBottom: 6 }}>
              Mots clés (un par ligne ou séparés par des virgules, {MAX_KEYWORDS} au plus)
            </label>
            <textarea
              id="kw-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) search(); }}
              rows={4}
              placeholder={'red astaire\ne liquide fraise'}
              style={{ ...input, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
            />
            {tooMany && <div style={{ color: C.rouge, fontSize: 12, marginTop: 4 }}>{keywords.length} mots clés : {MAX_KEYWORDS} au plus par recherche.</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 200 }}>
            <label style={{ fontSize: 13, color: C.grisF }}>
              Pays{' '}
              <select value={geo} onChange={(e) => setGeo(e.target.value)} style={{ ...input, padding: '6px 8px', marginLeft: 6 }}>
                {GEOS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 13, color: C.grisF, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={withIdeas} onChange={(e) => setWithIdeas(e.target.checked)} />
              Proposer des idées voisines
            </label>
            <button type="button" onClick={search} disabled={loading || !keywords.length || tooMany || quotaFull}
              style={{ ...btnPlein, opacity: loading || !keywords.length || tooMany || quotaFull ? 0.5 : 1 }}>
              {loading ? 'Recherche…' : 'Rechercher'}
            </button>
          </div>
        </div>
        {usage && (
          <div style={{ fontSize: 12, color: quotaFull ? C.rouge : C.grisM, marginTop: 10 }}>
            Quota Google Ads du jour : {fmtInt(usage.ops)} / {fmtInt(usage.cap)} appels utilisés
            {quotaFull ? ' — plafond atteint, remise à zéro à 9 h.' : '.'}
            {' '}Une recherche en coûte 1 ou 2 ; une recherche déjà faite dans les 30 derniers jours ne coûte rien.
          </div>
        )}
      </Card>

      {error && <Card style={{ borderColor: C.rouge }}><span style={{ color: C.rouge, fontSize: 14 }}>{error}</span></Card>}

      {result && (
        <>
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: C.saphirF }}>Volumes de recherche</h3>
              <span style={{ fontSize: 12, color: C.grisM }}>
                Moyenne mensuelle sur 12 mois, {GEOS.find((g) => g.value === result.geo)?.label}, langue française
                {result.cache ? ` · résultat du ${frDateTime(result.cache)} (sans appel à Google)` : ''}
              </span>
              <button type="button" onClick={download} style={{ ...btn, marginLeft: 'auto' }}>Télécharger en CSV</button>
            </div>
            {result.volumes.length ? <Rows rows={result.volumes} /> : <div style={{ fontSize: 13, color: C.grisM }}>Aucune donnée pour ces mots clés.</div>}
          </Card>

          {result.idees.length > 0 && (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: C.saphirF }}>Idées voisines</h3>
                <span style={{ fontSize: 12, color: C.grisM }}>{ideas.length} sur {result.idees.length}</span>
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer (ex. 50ml)" style={{ ...input, marginLeft: 'auto', width: 200 }} />
              </div>
              <Rows rows={ideas} onAdd={addKeyword} />
            </Card>
          )}
        </>
      )}
    </>
  );
}
