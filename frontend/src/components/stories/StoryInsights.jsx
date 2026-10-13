import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');
const SITE = 'https://www.youvape.fr';

const C = {
  vert: '#2E8B57', orange: '#E28F00', bleu: '#0071EB', grisTL: '#F2F6F8', grisCL: '#E2E2E2',
  grisM: '#8A99A4', grisTF: '#2a2e38',
};

const n = (v) => Number(v) || 0;
const pct = (a, b) => (n(b) ? `${Math.round((n(a) / n(b)) * 100)} %` : '—');

const LAYOUT = { bubbles: 'bulles', cards: 'carrousel' };
const DEVICE = { mobile: 'Mobile', tablet: 'Tablette', desktop: 'Ordinateur' };
const SOURCE = { site: 'Site', email: 'E-mails Probance', preview: 'Tests (aperçu)' };

/** Liste détaillée, widget par widget, pour la fenêtre « Voir ». */
export const PlacementsDetail = ({ placements = [] }) => {
  const byWidget = new Map();
  for (const p of placements) {
    if (!byWidget.has(p.widget_id)) byWidget.set(p.widget_id, { ...p, targets: [] });
    if (p.target_type) byWidget.get(p.widget_id).targets.push(p);
  }
  if (!byWidget.size) {
    return <div style={{ fontSize: 12, color: C.grisM }}>Cette vidéo n’est dans aucun widget : elle n’apparaît sur aucune page du site.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[...byWidget.values()].map((w) => (
        <div key={w.widget_id} style={{ fontSize: 12, color: C.grisTF }}>
          <div>
            <strong>{w.widget_title}</strong>
            <span style={{ color: C.grisM }}> · {LAYOUT[w.layout] || w.layout} · </span>
            <span style={{ fontWeight: 700, color: w.widget_status === 'published' ? C.vert : C.grisM }}>
              {w.widget_status === 'published' ? 'publié' : 'brouillon'}
            </span>
          </div>
          {w.targets.length === 0 ? (
            <div style={{ color: C.grisM, marginLeft: 12 }}>aucun emplacement</div>
          ) : (
            <ul style={{ margin: '2px 0 0 0', paddingLeft: 18 }}>
              {w.targets.map((t) => (
                <li key={`${t.target_type}-${t.target_ref}`}>
                  {t.target_type === 'product'
                    ? <a href={`${SITE}/?post_type=product&p=${t.target_ref}`} target="_blank" rel="noreferrer" style={{ color: C.bleu }}>{t.product_title || `Produit #${t.target_ref}`}</a>
                    : <a href={`${SITE}${t.target_ref}`} target="_blank" rel="noreferrer" style={{ color: C.bleu, fontFamily: 'monospace' }}>{t.target_ref}</a>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
};

const th = { textAlign: 'left', padding: '5px 8px', fontSize: 11, color: C.grisM, fontWeight: 700, borderBottom: `1px solid ${C.grisCL}` };
const td = { padding: '5px 8px', fontSize: 12, color: C.grisTF, borderBottom: `1px solid ${C.grisTL}` };
const tdNum = { ...td, textAlign: 'right', fontFamily: 'monospace' };

/** Statistiques détaillées d'une story (par page, appareil, provenance). */
export const StoryStatsPanel = ({ storyId, days, includeTests }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    axios.get(`${API_URL}/stories/${storyId}/stats`, { params: { days, tests: includeTests ? 1 : 0 } })
      .then((res) => { if (alive) setData(res.data.data); })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); });
    return () => { alive = false; };
  }, [storyId, days, includeTests]);

  if (error) return <div style={{ fontSize: 12, color: '#DE2020' }}>{error}</div>;
  if (!data) return <div style={{ fontSize: 12, color: C.grisM }}>Chargement…</div>;

  const t = data.total || {};
  if (!n(t.views)) {
    return (
      <div style={{ fontSize: 12, color: C.grisM }}>
        Aucune lecture sur la période. Les statistiques arrivent dès que le lecteur est en place sur le site
        {includeTests ? '' : ' (les essais faits sur la page d’aperçu sont comptés à part : cochez « Inclure les tests »)'}.
      </div>
    );
  }
  const totalDevice = data.by_device.reduce((s, r) => s + n(r.views), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[
          ['Vues', n(t.views)],
          ['Spectateurs', n(t.viewers)],
          ['Vue en entier', pct(t.completions, t.views)],
          ['Clics bouton', `${n(t.clicks)} (${pct(t.clicks, t.views)})`],
        ].map(([label, value]) => (
          <div key={label} style={{ background: C.grisTL, borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 11, color: C.grisM }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.grisTF }}>{value}</div>
          </div>
        ))}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Page</th>
            <th style={{ ...th, textAlign: 'right' }}>Vues</th>
            <th style={{ ...th, textAlign: 'right' }}>Vue entière</th>
            <th style={{ ...th, textAlign: 'right' }}>Clics</th>
          </tr>
        </thead>
        <tbody>
          {data.by_page.map((r) => (
            <tr key={r.page || 'inconnue'}>
              <td style={{ ...td, fontFamily: 'monospace', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.page || ''}>{r.page || '—'}</td>
              <td style={tdNum}>{n(r.views)}</td>
              <td style={tdNum}>{pct(r.completions, r.views)}</td>
              <td style={tdNum}>{n(r.clicks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: C.grisM }}>
        {data.by_device.map((r) => `${DEVICE[r.device] || r.device} ${pct(r.views, totalDevice)}`).join(' · ')}
        {data.by_source.length > 1 && ` — ${data.by_source.map((r) => `${SOURCE[r.source] || r.source} : ${n(r.views)}`).join(' · ')}`}
      </div>
    </div>
  );
};
