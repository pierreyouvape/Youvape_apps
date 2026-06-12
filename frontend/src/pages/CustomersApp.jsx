import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { Customers as CustomersIcon } from '../components/AppIcons';
import { getCountryFlag, getCountryName } from '../utils/countries';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE ───────────────────────────────────────────── */
const C = {
  orange: '#E28F00', rouge: '#DE2020', vert: '#4AB866',
  bleu: '#0071EB', saphir: '#135E84', saphirF: '#003A56',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const PER_PAGE = 50;

const fmtEur = (n) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(n) || 0) + ' €';
const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n) || 0);

/* Assombrit une couleur hex d'un facteur (négatif = plus sombre) */
function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = c => adj(c).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/* Avatar dégradé déterministe d'après le nom */
const AVATAR_PALETTE = ['#135E84', '#E28F00', '#4AB866', '#0071EB', '#8B5CF6', '#E85A5A', '#22A06B', '#6366F1'];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ─── Icônes ─────────────────────────────────────────────── */
const Icons = {
  Search: ({ size = 16, color = C.grisM }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  Download: ({ size = 14, color = C.grisF }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
    </svg>
  ),
  Columns: ({ size = 14, color = C.grisF }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" />
    </svg>
  ),
  Copy: ({ size = 13, color = C.grisM }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Chevron: ({ size = 14, color = C.grisM }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
};

/* ─── Bouton copier email ────────────────────────────────── */
function CopyMail({ value }) {
  const [copied, setCopied] = useState(false);
  const onCopy = (e) => {
    e.preventDefault(); e.stopPropagation();
    try { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1100); } catch (err) { /* noop */ }
  };
  return (
    <button onClick={onCopy} title={copied ? 'Copié !' : "Copier l'email"} style={{
      background: 'transparent', border: 'none', cursor: 'pointer', padding: 4,
      display: 'inline-flex', alignItems: 'center', opacity: 0.55,
    }}
      onMouseEnter={e => e.currentTarget.style.opacity = 1}
      onMouseLeave={e => e.currentTarget.style.opacity = 0.55}
    >
      {copied
        ? <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2 6.5 L5 9 L10 3.5" stroke={C.vert} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        : <Icons.Copy />}
    </button>
  );
}

/* ─── En-tête de colonne triable ─────────────────────────── */
function Th({ label, sortKey, sort, onSort, align = 'left', sortable = true, width }) {
  const active = sort && sort.key === sortKey;
  return (
    <th style={{
      padding: '11px 16px', fontSize: 11, fontWeight: 800,
      color: active ? C.saphir : C.grisM, textTransform: 'uppercase', letterSpacing: '0.06em',
      textAlign: align, background: '#FCFDFE', whiteSpace: 'nowrap', width,
      borderBottom: `1px solid ${C.grisCL}`,
      cursor: sortable ? 'pointer' : 'default', userSelect: 'none',
    }}
      onClick={sortable ? () => onSort(sortKey) : undefined}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start' }}>
        {label}
        {sortable && (
          <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 0, opacity: active ? 1 : 0.35 }}>
            <svg width="8" height="5" viewBox="0 0 8 5" style={{ marginBottom: 1 }}><path d="M4 0L8 5H0z" fill={active && sort.dir === 'asc' ? C.saphir : C.grisM} /></svg>
            <svg width="8" height="5" viewBox="0 0 8 5"><path d="M4 5L0 0h8z" fill={active && sort.dir === 'desc' ? C.saphir : C.grisM} /></svg>
          </span>
        )}
      </span>
    </th>
  );
}

/* ─── Carte de stat ──────────────────────────────────────── */
function StatCard({ label, value, accent }) {
  return (
    <div style={{
      background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '16px 22px', minWidth: 170,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 900, fontFamily: "'Tilt Warp', cursive",
        color: accent ? C.orange : C.saphir, letterSpacing: '-0.5px',
        fontVariantNumeric: 'tabular-nums', lineHeight: 1,
      }}>{value}</div>
    </div>
  );
}

const ALL_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Nom Prénom' },
  { key: 'email', label: 'Email' },
  { key: 'orders', label: 'Commandes' },
  { key: 'spent', label: 'Total dépensé TTC' },
  { key: 'country', label: 'Pays' },
];

function btnSecondary() {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: C.blanc, color: C.grisF, border: `1px solid ${C.grisCL}`,
    borderRadius: 8, padding: '9px 13px', fontSize: 12.5, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'transform 0.15s', whiteSpace: 'nowrap',
  };
}
function pageBtn(disabled) {
  return {
    background: C.blanc, color: disabled ? C.grisM : C.grisF,
    border: `1px solid ${C.grisCL}`, borderRadius: 7, padding: '6px 12px',
    fontSize: 12.5, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'inherit', opacity: disabled ? 0.6 : 1,
  };
}

const fullName = (c) => `${c.first_name || ''} ${c.last_name || ''}`.trim() || '(sans nom)';

const CustomersApp = () => {
  const navigate = useNavigate();

  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);        // total filtré (footer + card "Affichés")
  const [grandTotal, setGrandTotal] = useState(null); // total global de la base
  const [loading, setLoading] = useState(true);
  const [countries, setCountries] = useState([]);

  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('all');
  const [sort, setSort] = useState({ key: 'spent', dir: 'desc' });
  const [page, setPage] = useState(0); // 0-based
  const [visibleCols, setVisibleCols] = useState(() => ALL_COLUMNS.reduce((m, c) => { m[c.key] = true; return m; }, {}));
  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef(null);

  /* Fermeture du popover Colonnes au clic extérieur */
  useEffect(() => {
    const onClick = (e) => { if (colsRef.current && !colsRef.current.contains(e.target)) setColsOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  /* Liste des pays (pour le select) */
  useEffect(() => {
    axios.get(`${API_URL}/customers/countries`)
      .then(res => { if (res.data.success) setCountries(res.data.data); })
      .catch(err => console.error('Error fetching countries:', err));
  }, []);

  /* Total global de la base (card "Total clients", indépendant du filtre) */
  useEffect(() => {
    axios.get(`${API_URL}/customers/stats-list`, { params: { limit: 1, offset: 0 } })
      .then(res => { if (res.data.success) setGrandTotal(res.data.pagination.total); })
      .catch(() => {});
  }, []);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/customers/stats-list`, {
        params: {
          limit: PER_PAGE,
          offset: page * PER_PAGE,
          search: search.trim(),
          country: country === 'all' ? '' : country,
          sortKey: sort.key,
          sortDir: sort.dir,
        },
      });
      if (res.data.success) {
        setCustomers(res.data.data);
        setTotal(res.data.pagination.total);
      }
    } catch (err) {
      console.error('Error fetching customers:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, country, sort]);

  /* Debounce sur la recherche ; immédiat sur pays/tri/page */
  useEffect(() => {
    const t = setTimeout(fetchCustomers, 300);
    return () => clearTimeout(t);
  }, [fetchCustomers]);

  /* Revenir page 1 quand un filtre change */
  useEffect(() => { setPage(0); }, [search, country, sort]);

  const onSort = (key) => setSort(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  /* Export CSV de la page courante */
  const exportCsv = () => {
    const cols = ALL_COLUMNS.filter(c => visibleCols[c.key]);
    const header = cols.map(c => c.label).join(';');
    const rows = customers.map(c => cols.map(col => {
      switch (col.key) {
        case 'id': return c.id;
        case 'name': return `"${fullName(c).replace(/"/g, '""')}"`;
        case 'email': return c.email || '';
        case 'orders': return c.order_count || 0;
        case 'spent': return (parseFloat(c.total_spent) || 0).toFixed(2).replace('.', ',');
        case 'country': return getCountryName(c.country);
        default: return '';
      }
    }).join(';'));
    const csv = '﻿' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `clients_page${page + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inputStyle = {
    background: C.blanc, color: C.grisTF, border: `1px solid ${C.grisCL}`, borderRadius: 8,
    padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
  };

  const cellBase = { padding: '14px 16px', borderBottom: `1px solid ${C.grisTL}`, fontSize: 13.5, verticalAlign: 'middle' };
  const visibleColCount = Object.values(visibleCols).filter(Boolean).length;

  return (
    <AppShell currentPath="/customers">
      <style>{`
        .dt-row { transition: background 0.12s; }
        .dt-row:hover { background: #F8FBFD; }
      `}</style>

      <main className="main-scroll" style={{
        flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Lato, sans-serif', color: C.grisTF, background: C.grisTL,
      }}>
        {/* Top bar */}
        <header style={{
          background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
          padding: '0 28px', minHeight: 58,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 20, gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: `linear-gradient(155deg, #0EA5A5, ${shade('#0EA5A5', -0.2)})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(14,165,165,0.35), 0 1px 0 rgba(255,255,255,0.35) inset',
            }}>
              <CustomersIcon size={18} color="#fff" />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>Clients</div>
          </div>
        </header>

        <div style={{ padding: '24px 28px', flex: 1 }}>
          {/* En-tête de page + stat cards */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', marginBottom: 20 }}>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 900, fontFamily: "'Tilt Warp', cursive", color: C.saphir, letterSpacing: '-0.5px', margin: '0 0 4px 0' }}>Clients</h1>
              <div style={{ fontSize: 13.5, color: C.grisF }}>Base clients WooCommerce — recherche, filtre et export.</div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatCard label="Total clients" value={grandTotal != null ? fmtInt(grandTotal) : '—'} />
              <StatCard label="Affichés" value={fmtInt(total)} accent />
            </div>
          </div>

          {/* Card liste */}
          <div style={{
            background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'visible',
          }}>
            {/* Toolbar */}
            <div style={{
              padding: '16px 20px', borderBottom: `1px solid ${C.grisCL}`,
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#FCFDFE',
              borderTopLeftRadius: 12, borderTopRightRadius: 12,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9,
                background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 8,
                padding: '9px 13px', minWidth: 260, flex: '1 1 340px',
              }}>
                <Icons.Search />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher par nom, prénom, email…"
                  style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 13.5, fontFamily: 'inherit', color: C.grisTF }} />
              </div>

              <select value={country} onChange={e => setCountry(e.target.value)} style={inputStyle}>
                <option value="all">Tous les pays</option>
                {countries.map(code => (
                  <option key={code} value={code}>{getCountryName(code)}</option>
                ))}
              </select>

              <button style={btnSecondary()} onClick={exportCsv}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
              ><Icons.Download />CSV</button>

              <div style={{ position: 'relative' }} ref={colsRef}>
                <button style={btnSecondary()} onClick={() => setColsOpen(o => !o)}
                  onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                ><Icons.Columns />Colonnes<Icons.Chevron size={13} /></button>
                {colsOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40,
                    background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
                    boxShadow: '0 10px 30px rgba(0,58,86,0.16)', padding: '8px', minWidth: 200,
                  }}>
                    {ALL_COLUMNS.map(c => (
                      <label key={c.key} style={{
                        display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px',
                        borderRadius: 7, cursor: c.key === 'name' ? 'not-allowed' : 'pointer',
                        fontSize: 13, color: C.grisTF, opacity: c.key === 'name' ? 0.5 : 1,
                      }}
                        onMouseEnter={e => { if (c.key !== 'name') e.currentTarget.style.background = C.grisTL; }}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <input type="checkbox" checked={visibleCols[c.key]} disabled={c.key === 'name'}
                          onChange={e => setVisibleCols(v => ({ ...v, [c.key]: e.target.checked }))}
                          style={{ accentColor: C.orange, width: 15, height: 15 }} />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', color: C.grisTF }}>
                <thead>
                  <tr>
                    {visibleCols.id && <Th label="ID" sortKey="id" sort={sort} onSort={onSort} width={88} />}
                    {visibleCols.name && <Th label="Nom Prénom" sortKey="name" sort={sort} onSort={onSort} />}
                    {visibleCols.email && <Th label="Email" sortKey="email" sort={sort} onSort={onSort} />}
                    {visibleCols.orders && <Th label="Commandes" sortKey="orders" sort={sort} onSort={onSort} align="center" />}
                    {visibleCols.spent && <Th label="Total dépensé TTC" sortKey="spent" sort={sort} onSort={onSort} align="right" />}
                    {visibleCols.country && <Th label="Pays" sortKey="country" sort={sort} onSort={onSort} />}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={visibleColCount} style={{ padding: 48, textAlign: 'center', color: C.grisM, fontSize: 13.5 }}>Chargement…</td></tr>
                  )}
                  {!loading && customers.map((c) => {
                    const name = fullName(c);
                    return (
                      <tr key={c.id} className="dt-row">
                        {visibleCols.id && (
                          <td style={{ ...cellBase, color: C.grisM, fontVariantNumeric: 'tabular-nums', fontSize: 12.5, fontWeight: 600 }}>#{c.id}</td>
                        )}
                        {visibleCols.name && (
                          <td style={cellBase}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                              <span style={{
                                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                                background: `linear-gradient(140deg, ${avatarColor(name)}, ${shade(avatarColor(name), -0.18)})`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontSize: 12, fontWeight: 800,
                                boxShadow: '0 1px 0 rgba(255,255,255,0.3) inset',
                              }}>{initials(name)}</span>
                              <a href={`/customers/${c.id}`} onClick={e => { e.preventDefault(); navigate(`/customers/${c.id}`); }}
                                style={{ color: C.saphir, fontWeight: 700, textDecoration: 'none', fontSize: 13.5, cursor: 'pointer' }}>
                                {name}
                              </a>
                            </div>
                          </td>
                        )}
                        {visibleCols.email && (
                          <td style={cellBase}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <a href={`mailto:${c.email}`} style={{ color: C.bleu, textDecoration: 'none', fontWeight: 600, fontSize: 13 }}>{c.email}</a>
                              {c.email && <CopyMail value={c.email} />}
                            </div>
                          </td>
                        )}
                        {visibleCols.orders && (
                          <td style={{ ...cellBase, textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              background: '#E6F5EC', color: '#2A8049',
                              padding: '3px 11px', borderRadius: 99, fontSize: 12, fontWeight: 700,
                              fontVariantNumeric: 'tabular-nums',
                            }}>{fmtInt(c.order_count)} commandes</span>
                          </td>
                        )}
                        {visibleCols.spent && (
                          <td style={{ ...cellBase, textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtEur(c.total_spent)}</td>
                        )}
                        {visibleCols.country && (
                          <td style={cellBase}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, color: C.grisF }}>
                              <span style={{ fontSize: 17, lineHeight: 1 }}>{getCountryFlag(c.country) || '🏳️'}</span>{getCountryName(c.country)}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!loading && customers.length === 0 && (
                    <tr><td colSpan={visibleColCount} style={{ padding: '48px', textAlign: 'center', color: C.grisM, fontSize: 13.5 }}>
                      Aucun client ne correspond à votre recherche.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer pagination */}
            <div style={{
              padding: '13px 20px', borderTop: `1px solid ${C.grisCL}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12, flexWrap: 'wrap', fontSize: 12.5, color: C.grisF, background: '#FCFDFE',
              borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
            }}>
              <span><strong style={{ color: C.grisTF }}>{fmtInt(customers.length)}</strong> affichés · {fmtInt(total)} au total{grandTotal != null && total !== grandTotal ? ` (base : ${fmtInt(grandTotal)})` : ''}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button style={pageBtn(page === 0)} disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>← Précédent</button>
                <span style={{ padding: '0 6px', fontWeight: 700, color: C.grisTF }}>{page + 1} / {pageCount}</span>
                <button style={pageBtn(page + 1 >= pageCount)} disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>Suivant →</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  );
};

export default CustomersApp;
