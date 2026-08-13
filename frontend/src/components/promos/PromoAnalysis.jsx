import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceArea,
} from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  promo: '#DB2777', vert: '#4AB866', rouge: '#DE2020', orange: '#E28F00', bleu: '#0071EB',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const eur = (v, d = 2) => (v === null || v === undefined ? '—'
  : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + ' €');
const int = (v) => new Intl.NumberFormat('fr-FR').format(parseInt(v, 10) || 0);
const signPct = (v) => (v === null || v === undefined ? '—'
  : `${v > 0 ? '+' : ''}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v)} %`);
const deltaColor = (v) => (v === null || v === undefined ? C.grisM : v > 0 ? C.vert : v < 0 ? C.rouge : C.grisM);
const frDate = (ymd) => {
  if (!ymd) return '—';
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

/** Carte de comparaison : valeur pendant l'opé, rappel de la référence, écart. */
function CompareCard({ label, current, reference, delta, deltaPct, invertColor = false }) {
  const color = invertColor ? deltaColor(delta === null ? null : -delta) : deltaColor(delta);
  return (
    <div style={{ flex: 1, minWidth: 165, background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: C.grisM, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.grisTF, lineHeight: 1.1 }}>{current}</div>
      <div style={{ fontSize: 11, color: C.grisM, marginTop: 5 }}>
        avant : <span style={{ fontFamily: 'monospace' }}>{reference}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginTop: 3 }}>
        {signPct(deltaPct)}
      </div>
    </div>
  );
}

/**
 * Analyse « avant / pendant » d'une opération promo.
 *
 * Compare les ventes des produits de l'opération sur la période promo et sur une
 * période de référence de même durée (période précédente ou N-1). Le CA du shop
 * entier est rappelé pour distinguer l'effet promo d'une tendance générale.
 */
export default function PromoAnalysis({ operationId, operation }) {
  const [compare, setCompare] = useState('previous');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('qty_delta');

  // Bornes par défaut : celles de l'opération.
  useEffect(() => {
    setFrom((f) => f || (operation?.start_date ? String(operation.start_date).slice(0, 10) : ''));
    setTo((t) => t || (operation?.end_date ? String(operation.end_date).slice(0, 10) : ''));
  }, [operation]);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await axios.get(`${API_URL}/promos/${operationId}/analysis`, {
        params: { compare, from: from || undefined, to: to || undefined },
      });
      setData(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [operationId, compare, from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    const arr = [...data.rows];
    const key = {
      qty_delta: (r) => r.deltas.qty,
      qty: (r) => r.current.qty,
      ca: (r) => r.current.ca_ht,
      ca_delta: (r) => r.deltas.ca_ht,
      margin_delta: (r) => r.deltas.margin_ht,
    }[sortBy] || ((r) => r.deltas.qty);
    return arr.sort((a, b) => (key(b) || 0) - (key(a) || 0));
  }, [data, sortBy]);

  // Série quotidienne : la zone promo est surlignée sur le graphique.
  const chartData = useMemo(() => (data?.series || []).map((s) => ({
    day: s.day, qty: s.qty, ca_ht: Math.round(parseFloat(s.ca_ht) || 0),
  })), [data]);

  const inputStyle = {
    padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
    fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
  };
  const th = { padding: '9px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.grisM, borderBottom: `2px solid ${C.grisCL}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: C.blanc, zIndex: 2 };
  const thR = { ...th, textAlign: 'right' };
  const td = { padding: '9px 10px', fontSize: 13, color: C.grisTF, borderBottom: `1px solid ${C.grisCL}` };
  const tdR = { ...td, textAlign: 'right', fontFamily: 'monospace' };

  if (data?.empty) {
    return (
      <section style={{ padding: '24px 40px 60px' }}>
        <div style={{ background: C.blanc, border: `1px dashed ${C.grisCL}`, borderRadius: 14, padding: 40, textAlign: 'center', color: C.grisM }}>
          Ajoutez des produits à l'opération pour pouvoir analyser ses ventes.
        </div>
      </section>
    );
  }

  const t = data?.totals;

  return (
    <section style={{ padding: '20px 40px 60px' }}>
      {/* Périodes comparées */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Période analysée — du</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>au</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Comparer à</label>
          <select value={compare} onChange={(e) => setCompare(e.target.value)} style={inputStyle}>
            <option value="previous">La période précédente (même durée)</option>
            <option value="last_year">La même période l'an dernier</option>
          </select>
        </div>
        {data && (
          <div style={{ fontSize: 12, color: C.grisM, paddingBottom: 8 }}>
            <strong style={{ color: C.promo }}>Promo</strong> : {frDate(data.period.from)} → {frDate(data.period.to)} ({data.period.days} j)
            <span style={{ margin: '0 8px' }}>·</span>
            <strong>Référence</strong> : {frDate(data.reference_period.from)} → {frDate(data.reference_period.to)}
          </div>
        )}
      </div>

      {error && <div style={{ padding: 14, borderRadius: 10, background: '#FEE', color: C.rouge, marginBottom: 16, fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: C.grisM, fontSize: 13, marginBottom: 12 }}>Calcul en cours…</div>}

      {t && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <CompareCard label="Unités vendues" current={int(t.current.qty)} reference={int(t.reference.qty)}
              delta={t.deltas.qty} deltaPct={t.deltas.qty_pct} />
            <CompareCard label="CA HT" current={eur(t.current.ca_ht, 0)} reference={eur(t.reference.ca_ht, 0)}
              delta={t.deltas.ca_ht} deltaPct={t.deltas.ca_ht_pct} />
            <CompareCard label="Marge HT" current={eur(t.current.margin_ht, 0)} reference={eur(t.reference.margin_ht, 0)}
              delta={t.deltas.margin_ht} deltaPct={t.deltas.margin_ht_pct} />
            <CompareCard label="Commandes concernées" current={int(t.current.orders)} reference={int(t.reference.orders)}
              delta={t.deltas.orders} deltaPct={t.deltas.orders_pct} />
            <CompareCard label="Panier moyen TTC" current={eur(t.current.avg_basket_ttc, 0)} reference={eur(t.reference.avg_basket_ttc, 0)}
              delta={t.deltas.avg_basket_pct} deltaPct={t.deltas.avg_basket_pct} />
            <CompareCard label="CA total du shop" current={eur(t.current.shop_ca_ttc, 0)} reference={eur(t.reference.shop_ca_ttc, 0)}
              delta={t.deltas.shop_ca_pct} deltaPct={t.deltas.shop_ca_pct} />
          </div>

          {/* Lecture de l'effet : la promo a-t-elle fait mieux que la tendance générale ? */}
          <div style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 14, padding: '16px 18px', marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>Lecture</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.grisTF, lineHeight: 1.7 }}>
              <li>
                Volume : <strong style={{ color: deltaColor(t.deltas.qty_pct) }}>{signPct(t.deltas.qty_pct)}</strong> d'unités vendues
                {t.deltas.shop_ca_pct !== null && (
                  <> — pendant que le CA global du shop faisait <strong style={{ color: deltaColor(t.deltas.shop_ca_pct) }}>{signPct(t.deltas.shop_ca_pct)}</strong>.</>
                )}
              </li>
              <li>
                Marge : <strong style={{ color: deltaColor(t.deltas.margin_ht) }}>{eur(t.deltas.margin_ht, 0)}</strong> d'écart
                (taux de marge {t.reference.margin_pct === null ? '—' : `${t.reference.margin_pct} %`} → {t.current.margin_pct === null ? '—' : `${t.current.margin_pct} %`}).
                {t.deltas.margin_ht > 0
                  ? ' Le volume supplémentaire a plus que compensé la remise.'
                  : ' La remise n\'a pas été compensée par le volume.'}
              </li>
              <li>
                Prix moyen encaissé et nombre de commandes permettent de vérifier que la remise a bien été appliquée
                et qu'elle a attiré des commandes, pas seulement déplacé des ventes.
              </li>
            </ul>
          </div>

          {/* Courbe : référence + promo, zone promo surlignée */}
          {chartData.length > 1 && (
            <div style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 14, padding: '16px 18px 8px', marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 }}>
                Ventes quotidiennes des produits de l'opération
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f5" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.grisM }}
                    tickFormatter={(d) => frDate(d).slice(0, 5)} minTickGap={24} />
                  <YAxis yAxisId="qty" tick={{ fontSize: 11, fill: C.grisM }} />
                  <YAxis yAxisId="ca" orientation="right" tick={{ fontSize: 11, fill: C.grisM }} />
                  <Tooltip labelFormatter={frDate}
                    formatter={(v, n) => (n === 'CA HT' ? `${int(v)} €` : int(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceArea yAxisId="qty" x1={data.period.from} x2={data.period.to}
                    fill={C.promo} fillOpacity={0.08} />
                  <Line yAxisId="qty" type="monotone" dataKey="qty" name="Unités" stroke={C.promo} strokeWidth={2} dot={false} />
                  <Line yAxisId="ca" type="monotone" dataKey="ca_ht" name="CA HT" stroke={C.bleu} strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Détail par produit */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.grisM }}>Trier par</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={inputStyle}>
              <option value="qty_delta">Écart d'unités</option>
              <option value="qty">Unités vendues</option>
              <option value="ca">CA HT promo</option>
              <option value="ca_delta">Écart de CA</option>
              <option value="margin_delta">Écart de marge</option>
            </select>
          </div>

          <div style={{ background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Produit</th>
                  <th style={thR}>Remise</th>
                  <th style={thR}>Unités avant</th>
                  <th style={thR}>Unités promo</th>
                  <th style={thR}>Écart</th>
                  <th style={thR}>CA HT avant</th>
                  <th style={thR}>CA HT promo</th>
                  <th style={thR}>Marge avant</th>
                  <th style={thR}>Marge promo</th>
                  <th style={thR} title="Prix de vente moyen réellement encaissé (TTC)">Prix moyen TTC</th>
                  <th style={thR}>Stock</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.item_id}>
                    <td style={{ ...td, minWidth: 240 }}>
                      <div style={{ fontWeight: 600 }}>{r.display_name}</div>
                      <div style={{ fontSize: 11, color: C.grisM, fontFamily: 'monospace' }}>{r.sku}</div>
                    </td>
                    <td style={{ ...tdR, color: C.promo, fontWeight: 700 }}>
                      {r.discount_percent ? `−${r.discount_percent} %` : '—'}
                    </td>
                    <td style={tdR}>{int(r.reference.qty)}</td>
                    <td style={{ ...tdR, fontWeight: 700 }}>{int(r.current.qty)}</td>
                    <td style={{ ...tdR, color: deltaColor(r.deltas.qty), fontWeight: 700 }}>
                      {r.deltas.qty > 0 ? '+' : ''}{int(r.deltas.qty)}
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{signPct(r.deltas.qty_pct)}</div>
                    </td>
                    <td style={tdR}>{eur(r.reference.ca_ht, 0)}</td>
                    <td style={tdR}>{eur(r.current.ca_ht, 0)}</td>
                    <td style={tdR}>{eur(r.reference.margin_ht, 0)}</td>
                    <td style={{ ...tdR, color: deltaColor(r.deltas.margin_ht) }}>{eur(r.current.margin_ht, 0)}</td>
                    <td style={tdR}>{eur(r.current.avg_price_ttc)}</td>
                    <td style={tdR}>{int(r.stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: 11, color: C.grisM, marginTop: 12, maxWidth: 900 }}>
            Ventes rattachées à la date de commande, sur les 6 statuts payés. Le coût utilisé est le coût d'achat
            actuel sur les deux périodes, pour que l'écart de marge reflète le prix et le volume, et non l'évolution
            du PMP. Les unités livrées dans un pack (bundle) sont comptées en volume mais leur CA reste porté par la
            ligne du pack.
          </p>
        </>
      )}
    </section>
  );
}
