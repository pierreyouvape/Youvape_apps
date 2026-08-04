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

/* Raison unifiée (colonne dédiée + filtre). code → { label, color }. */
const REASONS = [
  { code: 'payment_refused', label: 'Paiement refusé',   color: '#DE2020' },
  { code: 'abandon',         label: 'Abandon panier',    color: '#E28F00' },
  { code: 'inscription',     label: 'Inscription simple', color: '#6366F1' },
  { code: 'pending',         label: 'En attente paiement', color: '#0071EB' },
  { code: 'refunded',        label: 'Remboursée',        color: '#8B5CF6' },
  { code: 'converted',       label: 'A commandé',        color: '#4AB866' },
  { code: 'other',           label: 'Autre',             color: '#8A99A4' },
];
const REASON_MAP = Object.fromEntries(REASONS.map(r => [r.code, r]));
const reasonInfo = (code) => REASON_MAP[code] || { label: '—', color: '#8A99A4' };

/* Libellé + couleur du statut de la dernière commande (par email). */
const PAID_SET = new Set(['wc-completed', 'wc-processing', 'wc-shipped', 'wc-delivered', 'wc-being-delivered', 'wc-awaiting-delivery']);
function orderStatusInfo(status) {
  if (!status) return { label: 'Aucune', color: '#8A99A4' };
  if (PAID_SET.has(status)) return { label: 'Payée', color: '#4AB866' };
  switch (status) {
    case 'wc-failed':         return { label: 'Échouée', color: '#DE2020' };   // rouge
    case 'wc-cancelled':      return { label: 'Annulée', color: '#92400E' };   // brun ambré
    case 'wc-checkout-draft': return { label: 'Brouillon', color: '#E28F00' }; // orange
    case 'wc-pending':        return { label: 'En attente', color: '#0071EB' };// bleu
    case 'wc-on-hold':        return { label: 'En attente', color: '#0EA5A5' };// teal
    case 'wc-refunded':       return { label: 'Remboursée', color: '#8B5CF6' };// violet
    default:                  return { label: status.replace(/^wc-/, ''), color: '#8A99A4' };
  }
}

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
  const [orderedFilter, setOrderedFilter] = useState('all'); // 'all' | 'yes' | 'no'
  const [reasonFilter, setReasonFilter] = useState('all');   // 'all' | code raison
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

  // Filtres client : texte (nom / email / pays) + statut "a commandé (même email)".
  const filteredDays = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && orderedFilter === 'all' && reasonFilter === 'all') return days;
    return days
      .map((d) => {
        const customers = d.customers.filter((c) => {
          if (orderedFilter === 'yes' && !c.ordered_by_email) return false;
          if (orderedFilter === 'no' && c.ordered_by_email) return false;
          if (reasonFilter !== 'all' && c.reason !== reasonFilter) return false;
          if (!q) return true;
          return (
            fullName(c).toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            getCountryName(c.country_code || '').toLowerCase().includes(q) ||
            (c.country_code || '').toLowerCase().includes(q)
          );
        });
        return { ...d, customers, count: customers.length };
      })
      .filter((d) => d.count > 0);
  }, [days, search, orderedFilter, reasonFilter]);

  const shownTotal = useMemo(
    () => filteredDays.reduce((s, d) => s + d.count, 0),
    [filteredDays]
  );

  const withCountry = useMemo(
    () => filteredDays.reduce((s, d) => s + d.customers.filter((c) => c.country_code).length, 0),
    [filteredDays]
  );

  const orderedByEmail = useMemo(
    () => filteredDays.reduce((s, d) => s + d.customers.filter((c) => c.ordered_by_email).length, 0),
    [filteredDays]
  );

  const toggleDay = (date) => setCollapsed((prev) => ({ ...prev, [date]: !prev[date] }));

  /* Export CSV de la sélection courante. */
  const exportCsv = () => {
    const header = ['Date inscription', 'Heure', 'Nom', 'Prénom', 'Email', 'Pays (code)', 'Pays', 'Dernière commande', 'Raison', 'A commandé (même email)', 'Date 1re commande'];
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
          orderStatusInfo(c.last_order_status).label,
          reasonInfo(c.reason).label,
          c.ordered_by_email ? 'Oui' : 'Non',
          c.ordered_by_email_date ? String(c.ordered_by_email_date).slice(0, 10) : '',
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
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL, position: 'relative' }}>
        <style>{`
          @keyframes yv-indeterminate {
            0%   { left: -40%; width: 40%; }
            50%  { left: 30%;  width: 55%; }
            100% { left: 100%; width: 40%; }
          }
          @keyframes yv-spin { to { transform: rotate(360deg); } }
        `}</style>

        {/* Barre de chargement indéterminée (haut de page) */}
        {loading && (
          <div style={{ position: 'sticky', top: 0, left: 0, right: 0, height: 3, background: `${C.teal}22`, overflow: 'hidden', zIndex: 20 }}>
            <div style={{ position: 'absolute', top: 0, height: '100%', background: C.teal, borderRadius: 2, animation: 'yv-indeterminate 1.1s ease-in-out infinite' }} />
          </div>
        )}

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>A commandé (même email)</label>
            <div style={{ display: 'inline-flex', border: `1px solid ${C.grisCL}`, borderRadius: 8, overflow: 'hidden' }}>
              {[
                { k: 'all', label: 'Tous' },
                { k: 'yes', label: 'Oui' },
                { k: 'no', label: 'Non' },
              ].map((opt, i) => {
                const active = orderedFilter === opt.k;
                return (
                  <button
                    key={opt.k}
                    onClick={() => setOrderedFilter(opt.k)}
                    style={{
                      padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                      borderLeft: i === 0 ? 'none' : `1px solid ${C.grisCL}`,
                      background: active ? (opt.k === 'yes' ? C.vert : opt.k === 'no' ? C.grisF : C.saphir) : C.blanc,
                      color: active ? '#fff' : C.grisF,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Raison</label>
            <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="all">Toutes</option>
              {REASONS.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
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
          <StatCard label="Ont commandé (même email)" value={fmtInt(orderedByEmail)} accent={C.vert} />
          <StatCard label="Avec pays connu" value={fmtInt(withCountry)} accent={C.saphir} />
        </section>

        {/* Note sur la source du pays */}
        <section style={{ padding: '10px 40px 0' }}>
          <div style={{
            background: C.grisTL, border: `1px solid ${C.grisCL}`, color: C.grisF,
            borderRadius: 10, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.5,
          }}>
            ℹ️ Sur la boutique, l'inscription se fait au moment du paiement : ces inscrits ont donc
            généralement une commande <strong>échouée</strong> (<code>wc-failed</code>) ou
            <strong> annulée</strong> (<code>wc-cancelled</code>). Le <strong>pays</strong> est repris de
            cette tentative de commande ; il est « Inconnu » lorsqu'aucune commande échouée/annulée n'est
            rattachée au compte.
          </div>
        </section>

        {/* Contenu */}
        <section style={{ padding: '18px 40px 48px' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.grisM, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', border: `3px solid ${C.teal}33`, borderTopColor: C.teal, animation: 'yv-spin 0.8s linear infinite' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Chargement des inscrits…</span>
            </div>
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
                            <th style={{ padding: '10px 18px', fontWeight: 700 }}>Dernière commande</th>
                            <th style={{ padding: '10px 18px', fontWeight: 700 }}>Raison</th>
                            <th style={{ padding: '10px 18px', fontWeight: 700 }}>A commandé (même email)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {day.customers.map((c) => (
                            <tr
                              key={c.id}
                              onClick={() => c.wp_user_id && navigate(`/customers/${c.wp_user_id}`)}
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
                              <td style={{ padding: '10px 18px', whiteSpace: 'nowrap' }}>
                                {(() => {
                                  const st = orderStatusInfo(c.last_order_status);
                                  return (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${st.color}1A`, color: st.color, fontWeight: 700, fontSize: 12, borderRadius: 99, padding: '3px 10px' }}>
                                      {st.label}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td style={{ padding: '10px 18px', whiteSpace: 'nowrap' }}>
                                {(() => {
                                  const rs = reasonInfo(c.reason);
                                  return (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${rs.color}1A`, color: rs.color, fontWeight: 700, fontSize: 12, borderRadius: 99, padding: '3px 10px' }}>
                                      {rs.label}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td style={{ padding: '10px 18px', whiteSpace: 'nowrap' }}>
                                {c.ordered_by_email ? (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${C.vert}1A`, color: C.vert, fontWeight: 700, fontSize: 12, borderRadius: 99, padding: '3px 10px' }}>
                                    ✓ Oui{c.ordered_by_email_date ? ` · ${String(c.ordered_by_email_date).slice(0, 10)}` : ''}
                                  </span>
                                ) : (
                                  <span style={{ color: C.grisM }}>—</span>
                                )}
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
