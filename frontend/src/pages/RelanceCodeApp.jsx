import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { RelanceCode as RelanceIcon } from '../components/AppIcons';
import { getCountryFlag, getCountryName } from '../utils/countries';
import ProbanceTab from '../components/relanceCode/ProbanceTab';
import SuiviTab from '../components/relanceCode/SuiviTab';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE ───────────────────────────────────────────── */
const C = {
  rouge: '#DE2020', vert: '#4AB866', bleu: '#0071EB', saphir: '#135E84',
  accent: '#0D9488',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n) || 0);
const fmtDate = (ymd) => (ymd ? ymd.split('-').reverse().join('/') : '—');
const localYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Date de référence du filtre « il y a entre X et Y jours ». */
const REFS = [
  { k: 'first', label: '1re commande' },
  { k: 'last', label: 'Dernière commande' },
  { k: 'registered', label: 'Inscription' },
];

/* Raccourcis de période. min/max = nombre de jours (vide = pas de borne). */
const PRESETS = [
  { k: 'j21', label: 'Il y a 3 semaines (21 à 27 j)', min: 21, max: 27, hint: 'À exporter une fois par semaine : chaque client tombe dans une seule liste.' },
  { k: 'w1', label: "Moins d'1 semaine", min: 0, max: 7 },
  { k: 'w3', label: 'Moins de 3 semaines', min: 0, max: 21 },
  { k: 'm1', label: "Moins d'1 mois", min: 0, max: 30 },
  { k: 'm3', label: 'Moins de 3 mois', min: 0, max: 90 },
  { k: 'y1', label: "Moins d'1 an", min: 0, max: 365 },
  { k: 'all', label: 'Tout l\'historique', min: '', max: '' },
];

function StatCard({ label, value, accent }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: C.grisM, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent || C.grisTF, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function Toggle({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${C.grisCL}`, borderRadius: 8, overflow: 'hidden' }}>
      {options.map((opt, i) => {
        const active = value === opt.k;
        return (
          <button
            key={opt.k}
            type="button"
            onClick={() => onChange(opt.k)}
            style={{
              padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
              borderLeft: i === 0 ? 'none' : `1px solid ${C.grisCL}`,
              background: active ? C.saphir : C.blanc, color: active ? '#fff' : C.grisF,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const RelanceCodeApp = () => {
  const navigate = useNavigate();

  const [tab, setTab] = useState('liste'); // liste | probance | suivi
  const [code, setCode] = useState('TEAMYOUVAPE');
  const [saveToSuivi, setSaveToSuivi] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);
  const [suiviKey, setSuiviKey] = useState(0);
  const [ref, setRef] = useState('first');
  const [preset, setPreset] = useState('j21');
  const [minDays, setMinDays] = useState(21);
  const [maxDays, setMaxDays] = useState(27);
  const [oneOrderOnly, setOneOrderOnly] = useState('1');
  const [country, setCountry] = useState('');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const params = useCallback(() => ({
    code: code.trim(), ref, minDays, maxDays, oneOrderOnly, country,
  }), [code, ref, minDays, maxDays, oneOrderOnly, country]);

  const fetchData = useCallback(async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/relance-code`, { params: params() });
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [params, code]);

  // Rechargement automatique, avec un petit délai pendant la saisie.
  useEffect(() => {
    const t = setTimeout(fetchData, 400);
    return () => clearTimeout(t);
  }, [fetchData]);

  const applyPreset = (p) => {
    setPreset(p.k);
    setMinDays(p.min);
    setMaxDays(p.max);
  };

  const onDaysChange = (setter) => (e) => {
    setPreset('custom');
    const v = e.target.value;
    setter(v === '' ? '' : Math.max(0, parseInt(v, 10) || 0));
  };

  const exportCsv = async () => {
    setExporting(true);
    setError(null);
    setSavedMsg(null);
    try {
      const res = await axios.get(`${API_URL}/relance-code/export`, { params: params(), responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relance_${code.trim().toLowerCase()}_${ref}_${minDays === '' ? '0' : minDays}-${maxDays === '' ? 'tout' : maxDays}j_${localYmd(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (saveToSuivi) {
        const saved = await axios.post(`${API_URL}/relance-code/campaigns`, params());
        setSavedMsg(`Envoi ajouté au suivi : ${fmtInt(saved.data.campaign.recipients)} client(s).`);
        setSuiviKey((k) => k + 1);
      }
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(await err.response.data.text()).error || msg; } catch { /* réponse non JSON */ }
      setError(msg || "Erreur pendant l'export");
    } finally {
      setExporting(false);
    }
  };

  const inputStyle = {
    padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
    fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
  };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: C.grisM };
  const field = { display: 'flex', flexDirection: 'column', gap: 4 };

  const total = data?.total || 0;
  const countries = Object.entries(data?.countries || {}).sort((a, b) => b[1] - a[1]);
  const refLabel = REFS.find((r) => r.k === ref)?.label.toLowerCase();
  const activePreset = PRESETS.find((p) => p.k === preset);

  return (
    <AppShell currentPath="/relance-code">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL }}>
        {/* En-tête */}
        <section style={{ padding: '28px 40px 20px', background: C.blanc, borderBottom: `1px solid ${C.grisCL}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24 }}>
              <RelanceIcon />
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: C.grisTF, margin: 0, fontFamily: "'Tilt Warp', cursive" }}>
                Relance code promo
              </h1>
              <p style={{ fontSize: 13, color: C.grisM, margin: '3px 0 0' }}>
                Clients qui n'ont jamais utilisé le code, à importer dans Probance.
              </p>
            </div>
          </div>
        </section>

        {/* Onglets + code promo (commun aux trois) */}
        <section style={{ padding: '14px 40px 0', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end', justifyContent: 'space-between', borderBottom: `1px solid ${C.grisCL}`, background: C.blanc }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { k: 'liste', label: "Liste depuis l'app" },
              { k: 'probance', label: 'Nettoyer un fichier Probance' },
              { k: 'suivi', label: 'Clients fidélisés' },
            ].map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => setTab(t.k)}
                style={{
                  padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
                  color: tab === t.k ? C.accent : C.grisF,
                  borderBottom: `3px solid ${tab === t.k ? C.accent : 'transparent'}`,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ ...field, paddingBottom: 8 }}>
            <label style={labelStyle}>Code promo</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ ...inputStyle, width: 160, fontWeight: 700 }} />
          </div>
        </section>

        {tab === 'probance' && <ProbanceTab code={code} onSaved={() => setSuiviKey((k) => k + 1)} />}
        {tab === 'suivi' && <SuiviTab refreshKey={suiviKey} />}

        {tab === 'liste' && (<>
        {/* Filtres */}
        <section style={{ padding: '18px 40px 6px', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
          <div style={field}>
            <label style={labelStyle}>Date comptée</label>
            <Toggle value={ref} onChange={setRef} options={REFS} />
          </div>
          <div style={field}>
            <label style={labelStyle}>Nombre de commandes</label>
            <Toggle value={oneOrderOnly} onChange={setOneOrderOnly} options={[{ k: '1', label: '1 seule' }, { k: '0', label: 'Toutes' }]} />
          </div>
          <div style={field}>
            <label style={labelStyle}>Pays</label>
            <select value={country} onChange={(e) => setCountry(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="">Tous</option>
              <option value="FR">France</option>
              <option value="BE">Belgique</option>
              <option value="LU">Luxembourg</option>
              <option value="CH">Suisse</option>
            </select>
          </div>
        </section>

        <section style={{ padding: '10px 40px 6px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {PRESETS.map((p) => {
            const active = preset === p.k;
            return (
              <button
                key={p.k}
                type="button"
                onClick={() => applyPreset(p)}
                style={{
                  padding: '7px 12px', borderRadius: 99, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                  border: `1px solid ${active ? C.accent : C.grisCL}`,
                  background: active ? C.accent : C.blanc, color: active ? '#fff' : C.grisF,
                }}
              >
                {p.label}
              </button>
            );
          })}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.grisF, marginLeft: 6 }}>
            {refLabel} il y a entre
            <input type="number" min="0" value={minDays} placeholder="0" onChange={onDaysChange(setMinDays)} style={{ ...inputStyle, width: 70 }} />
            et
            <input type="number" min="0" value={maxDays} placeholder="∞" onChange={onDaysChange(setMaxDays)} style={{ ...inputStyle, width: 70 }} />
            jours
          </span>
        </section>

        {activePreset?.hint && (
          <section style={{ padding: '4px 40px 0', fontSize: 12.5, color: C.grisF }}>ℹ️ {activePreset.hint}</section>
        )}

        {/* Chiffres + export */}
        <section style={{ padding: '16px 40px 8px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
          <StatCard label="Clients à relancer" value={loading ? '…' : fmtInt(total)} accent={C.accent} />
          <StatCard label="Dont 1 seule commande" value={loading ? '…' : fmtInt(data?.oneOrder)} />
          <StatCard
            label="Pays"
            value={loading ? '…' : (
              <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.6 }}>
                {countries.slice(0, 4).map(([cc, n]) => `${cc === '—' ? '—' : getCountryFlag(cc)} ${fmtInt(n)}`).join('   ') || '—'}
              </span>
            )}
          />
          <button
            type="button"
            onClick={exportCsv}
            disabled={!total || exporting || loading}
            style={{
              padding: '0 22px', borderRadius: 14, border: 'none', minHeight: 64,
              cursor: !total || exporting || loading ? 'not-allowed' : 'pointer',
              background: !total || loading ? C.grisCL : C.saphir, color: '#fff', fontSize: 14, fontWeight: 800,
            }}
          >
            {exporting ? 'Export…' : `Exporter CSV (${fmtInt(total)})`}
          </button>
        </section>

        <section style={{ padding: '4px 40px 0', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 12.5, color: C.grisF }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, color: C.grisTF }}>
            <input type="checkbox" checked={saveToSuivi} onChange={(e) => setSaveToSuivi(e.target.checked)} />
            Ajouter l'export au suivi des clients fidélisés (envoi daté de maintenant)
          </label>
          {saveToSuivi && <span>Cette liste contient aussi les non-abonnés : pour un suivi exact, passe plutôt par « Nettoyer un fichier Probance ».</span>}
          {savedMsg && <span style={{ color: C.vert, fontWeight: 700 }}>✓ {savedMsg}</span>}
        </section>

        <section style={{ padding: '6px 40px 0' }}>
          <div style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, color: C.grisF, borderRadius: 10, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.5 }}>
            Un client = une adresse e-mail, sur ses commandes payées. Sont exclus : ceux qui ont déjà utilisé
            le code (avec cette adresse ou ce compte) et les clients signalés malhonnêtes.
            Le <strong>consentement newsletter</strong> n'est pas connu ici : Probance écarte lui-même les
            non-abonnés à l'envoi.
          </div>
        </section>

        {/* Aperçu */}
        <section style={{ padding: '18px 40px 48px' }}>
          {error ? (
            <div style={{ padding: 24, textAlign: 'center', color: C.rouge, background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}` }}>{error}</div>
          ) : loading && !data ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.grisM }}>Chargement…</div>
          ) : !total ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.grisF, background: C.blanc, borderRadius: 12, border: `1px dashed ${C.grisCL}` }}>
              Aucun client ne correspond à ces filtres.
            </div>
          ) : (
            <div style={{ background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`, overflow: 'hidden', opacity: loading ? 0.5 : 1 }}>
              {total > data.rows.length && (
                <div style={{ padding: '10px 18px', fontSize: 12.5, color: C.grisF, background: C.grisTL }}>
                  Aperçu des {fmtInt(data.rows.length)} plus récents sur {fmtInt(total)} : l'export contient toute la liste.
                </div>
              )}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: C.grisM, textAlign: 'left', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.4px' }}>
                      {['Email', 'Prénom', 'Nom', 'Pays', 'Inscription', '1re commande', 'Dernière commande', 'Commandes'].map((h) => (
                        <th key={h} style={{ padding: '10px 18px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr
                        key={r.email}
                        onClick={() => r.wp_user_id && navigate(`/customers/${r.wp_user_id}`)}
                        style={{ borderTop: `1px solid ${C.grisCL}`, cursor: r.wp_user_id ? 'pointer' : 'default' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = C.grisTL)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '10px 18px', color: C.bleu }}>{r.email}</td>
                        <td style={{ padding: '10px 18px', color: C.grisTF }}>{r.first_name || '—'}</td>
                        <td style={{ padding: '10px 18px', color: C.grisTF, fontWeight: 600 }}>{r.last_name || '—'}</td>
                        <td style={{ padding: '10px 18px', color: C.grisF, whiteSpace: 'nowrap' }}>
                          {r.country ? `${getCountryFlag(r.country)} ${getCountryName(r.country)}` : '—'}
                        </td>
                        <td style={{ padding: '10px 18px', color: C.grisF, whiteSpace: 'nowrap' }}>{fmtDate(r.registered)}</td>
                        <td style={{ padding: '10px 18px', color: C.grisF, whiteSpace: 'nowrap' }}>{fmtDate(r.first_order)}</td>
                        <td style={{ padding: '10px 18px', color: C.grisF, whiteSpace: 'nowrap' }}>{fmtDate(r.last_order)}</td>
                        <td style={{ padding: '10px 18px', color: C.grisTF, fontWeight: 700 }}>{r.nb_orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
        </>)}
      </main>
    </AppShell>
  );
};

export default RelanceCodeApp;
