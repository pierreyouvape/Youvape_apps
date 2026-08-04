import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { Inscrits as InscritsIcon } from '../components/AppIcons';
import { getCountryFlag, getCountryName } from '../utils/countries';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE ───────────────────────────────────────────── */
const C = {
  orange: '#E28F00', rouge: '#DE2020', vert: '#4AB866',
  bleu: '#0071EB', saphir: '#135E84', saphirF: '#003A56',
  teal: '#0EA5A5',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n) || 0);

/* Formatage date locale (heure Paris) → YYYY-MM-DD, sans passer par UTC. */
function localYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Libellé jour lisible : "mardi 4 août 2026" */
function prettyDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const s = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* Heure d'inscription "HH:mm" à partir du champ user_registered. */
function hourOf(val) {
  if (!val) return '';
  const s = String(val);
  const m = s.match(/T?(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

const fullName = (c) => `${c.first_name || ''} ${c.last_name || ''}`.trim() || '—';

/* ─── CARTE STAT ────────────────────────────────────────── */
function StatCard({ label, value, accent }) {
  return (
    <div style={{
      flex: 1, minWidth: 150, background: C.blanc, borderRadius: 14,
      border: `1px solid ${C.grisCL}`, padding: '16px 18px',
    }}>
      <div style={{ fontSize: 12, color: C.grisM, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent || C.grisTF, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

/* ─── PAGE ──────────────────────────────────────────────── */
const InscritsApp = () => {
  const navigate = useNavigate();

  // Plage par défaut : 30 derniers jours (inclus).
  const today = new Date();
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 29);

  const [dateFrom, setDateFrom] = useState(localYmd(monthAgo));
  const [dateTo, setDateTo] = useState(localYmd(today));
  const [search, setSearch] = useState('');
  const [days, setDays] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState({}); // { 'YYYY-MM-DD': true }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/inscrits`, { params: { dateFrom, dateTo } });
      setDays(res.data.days || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      console.error('Erreur chargement inscrits sans commande:', err);
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
      setDays([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filtre texte (nom / email / pays) appliqué côté client.
  const filteredDays = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return days;
    return days
      .map((d) => {
        const customers = d.customers.filter((c) =>
          fullName(c).toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          getCountryName(c.country_code || '').toLowerCase().includes(q) ||
          (c.country_code || '').toLowerCase().includes(q)
        );
        return { ...d, customers, count: customers.length };
      })
      .filter((d) => d.count > 0);
  }, [days, search]);

  const shownTotal = useMemo(
    () => filteredDays.reduce((s, d) => s + d.count, 0),
    [filteredDays]
  );

  const withCountry = useMemo(
    () => filteredDays.reduce((s, d) => s + d.customers.filter((c) => c.country_code).length, 0),
    [filteredDays]
  );

  const toggleDay = (date) => setCollapsed((prev) => ({ ...prev, [date]: !prev[date] }));

  /* Export CSV de la sélection courante. */
  const exportCsv = () => {
    const header = ['Date inscription', 'Heure', 'Nom', 'Prénom', 'Email', 'Pays (code)', 'Pays'];
    const lines = [header.join(';')];
    for (const d of filteredDays) {
      for (const c of d.customers) {
        lines.push([
          d.date,
          hourOf(c.user_registered),
          (c.last_name || '').replace(/;/g, ','),
          (c.first_name || '').replace(/;/g, ','),
          c.email || '',
          c.country_code || '',
          c.country_code ? getCountryName(c.country_code) : 'Inconnu',
        ].join(';'));
      }
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscrits-sans-commande_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inputStyle = {
    padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
    fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
  };

  return (
    <AppShell currentPath="/inscrits">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL }}>
        {/* En-tête */}
        <section style={{ padding: '28px 40px 20px', background: C.blanc, borderBottom: `1px solid ${C.grisCL}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 12, background: C.teal,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24,
            }}>
              <InscritsIcon />
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: C.grisTF, margin: 0, fontFamily: "'Tilt Warp', cursive" }}>
                Inscrits sans commande
              </h1>
              <p style={{ fontSize: 13, color: C.grisM, margin: '3px 0 0' }}>
                Clients inscrits sur la période mais n'ayant passé aucune commande payée, regroupés par jour.
              </p>
            </div>
          </div>
        </section>

        {/* Barre de filtres */}
        <section style={{ padding: '18px 40px', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Du</label>
            <input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Au</label>
            <input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 220 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Recherche (nom, email, pays)</label>
            <input type="text" value={search} placeholder="Filtrer…" onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
          </div>
          <button
            onClick={exportCsv}
            disabled={shownTotal === 0}
            style={{
              padding: '9px 16px', borderRadius: 8, border: 'none', cursor: shownTotal === 0 ? 'not-allowed' : 'pointer',
              background: shownTotal === 0 ? C.grisCL : C.saphir, color: '#fff', fontSize: 13, fontWeight: 700,
            }}
          >
            Exporter CSV
          </button>
        </section>

        {/* Cartes récap */}
        <section style={{ padding: '0 40px 8px', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <StatCard label="Inscrits sans commande" value={fmtInt(shownTotal)} accent={C.teal} />
          <StatCard label="Jours concernés" value={fmtInt(filteredDays.length)} />
          <StatCard label="Avec pays connu" value={fmtInt(withCountry)} accent={C.vert} />
          <StatCard label="Pays inconnu" value={fmtInt(shownTotal - withCountry)} accent={C.grisF} />
        </section>

        {/* Avertissement synchro paniers abandonnés */}
        <section style={{ padding: '10px 40px 0' }}>
          <div style={{
            background: '#FFF7E6', border: `1px solid ${C.orange}55`, color: '#8a5a00',
            borderRadius: 10, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.5,
          }}>
            ℹ️ Sur la boutique, l'inscription se fait au moment du paiement : ces inscrits sont donc
            presque toujours des <strong>paniers abandonnés</strong>. Le pays provient de leur panier
            abandonné (<code>wc-checkout-draft</code>). La synchro de ces paniers étant interrompue depuis
            le 8/07/2026, le pays peut être « Inconnu » pour les inscriptions récentes tant que le flux
            WordPress n'est pas rétabli.
          </div>
        </section>

        {/* Contenu */}
        <section style={{ padding: '18px 40px 48px' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.grisM }}>Chargement…</div>
          ) : error ? (
            <div style={{ padding: 24, textAlign: 'center', color: C.rouge, background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}` }}>
              {error}
            </div>
          ) : filteredDays.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.grisF, background: C.blanc, borderRadius: 12, border: `1px dashed ${C.grisCL}` }}>
              Aucun inscrit sans commande sur cette période.
            </div>
          ) : (
            filteredDays.map((day) => {
              const isCollapsed = collapsed[day.date];
              return (
                <div key={day.date} style={{ marginBottom: 16, background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`, overflow: 'hidden' }}>
                  {/* En-tête jour cliquable */}
                  <button
                    onClick={() => toggleDay(day.date)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '13px 18px', border: 'none', background: C.grisTL, cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: C.grisM, fontSize: 12, transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}>▼</span>
                      <span style={{ fontSize: 14.5, fontWeight: 800, color: C.grisTF }}>{prettyDay(day.date)}</span>
                    </span>
                    <span style={{
                      fontSize: 12, fontWeight: 700, color: '#fff', background: C.teal,
                      borderRadius: 99, padding: '3px 11px',
                    }}>
                      {fmtInt(day.count)} inscrit{day.count > 1 ? 's' : ''}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ color: C.grisM, textAlign: 'left', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.4px' }}>
                            <th style={{ padding: '10px 18px', fontWeight: 700 }}>Heure</th>
                            <th style={{ padding: '10px 18px', fontWeight: 700 }}>Nom</th>
                            <th style={{ padding: '10px 18px', fontWeight: 700 }}>Prénom</th>
                            <th style={{ padding: '10px 18px', fontWeight: 700 }}>Email</th>
                            <th style={{ padding: '10px 18px', fontWeight: 700 }}>Pays</th>
                          </tr>
                        </thead>
                        <tbody>
                          {day.customers.map((c) => (
                            <tr
                              key={c.id}
                              onClick={() => navigate(`/customers/${c.id}`)}
                              style={{ borderTop: `1px solid ${C.grisCL}`, cursor: 'pointer' }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = C.grisTL)}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                              <td style={{ padding: '10px 18px', color: C.grisF, whiteSpace: 'nowrap' }}>{hourOf(c.user_registered)}</td>
                              <td style={{ padding: '10px 18px', color: C.grisTF, fontWeight: 600 }}>{c.last_name || '—'}</td>
                              <td style={{ padding: '10px 18px', color: C.grisTF }}>{c.first_name || '—'}</td>
                              <td style={{ padding: '10px 18px', color: C.bleu }}>{c.email || '—'}</td>
                              <td style={{ padding: '10px 18px', color: C.grisF, whiteSpace: 'nowrap' }}>
                                {c.country_code
                                  ? `${getCountryFlag(c.country_code)} ${getCountryName(c.country_code)}`
                                  : <span style={{ color: C.grisM }}>— Inconnu</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      </main>
    </AppShell>
  );
};

export default InscritsApp;
