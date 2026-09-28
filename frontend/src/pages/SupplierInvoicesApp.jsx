import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { Purchases as InvoiceIcon } from '../components/AppIcons';
import { useIsMobile } from '../hooks/useIsMobile';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');
const BASE = `${API}/supplier-invoices`;

/**
 * Lien vers la commande dans BMS. L'API vit sur /api ; l'interface suit le même
 * chemin sans ce préfixe. À corriger d'un mot si BMS range ses commandes
 * ailleurs — le lien est construit ici et nulle part ailleurs.
 */
const BMS_ORDER_URL = (bmsPoId) =>
  `https://fr3.myfulfillment.boostmyshop.com/supplier/purchase-orders/${bmsPoId}`;

const OrderLink = ({ order, children }) => (
  order?.bms_po_id
    ? <a href={BMS_ORDER_URL(order.bms_po_id)} target="_blank" rel="noopener noreferrer"
         style={{ color: C.main, fontWeight: 700, textDecoration: 'none', borderBottom: `1px dotted ${C.main}` }}>
        {children} ↗
      </a>
    : <>{children}</>
);

const C = {
  main: '#0F766E', mainD: '#115E59', mainL: '#ECFDF5',
  red: '#DC2626', redL: '#FEF2F2', green: '#16A34A', greenL: '#F0FDF4',
  orange: '#EA580C', orangeL: '#FFF7ED', blue: '#2563EB', blueL: '#EFF6FF',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#9CA3AF',
  dark: '#111827', white: '#FFFFFF',
};

/* ─── Mise en forme ──────────────────────────────────────── */
const eur = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
};
const signedEur = (v) => {
  const n = Number(v) || 0;
  return `${n > 0 ? '+' : ''}${eur(n)}`;
};
const date = (s) => (s ? new Date(s).toLocaleDateString('fr-FR') : '—');
const num = (v) => (v == null ? '—' : String(Math.round(Number(v) * 1000) / 1000));

/**
 * Les familles d'écart, dans l'ordre où elles comptent. Doit rester alignée sur
 * DIFFERENCE_KINDS (backend/src/utils/invoiceCompare.js) : l'écran n'a pas le
 * droit de taire une différence que le moteur a vue.
 */
const VERDICTS = {
  qty_price: { rank: 1, label: 'Quantité et tarif', tone: 'red', action: 'Ajuster la commande et réclamer le tarif' },
  missing_in_invoice: { rank: 2, label: 'Commandé, non facturé', tone: 'orange', action: 'Reliquat ou manquant : vérifier la livraison' },
  qty: { rank: 3, label: 'Quantité', tone: 'orange', action: 'Ajuster la quantité de la commande' },
  price: { rank: 4, label: 'Tarif', tone: 'red', action: 'Réclamer un avoir, ou aligner si le prix a changé' },
  not_ordered: { rank: 5, label: 'Facturé, non commandé', tone: 'red', action: 'Article ajouté : accepter ou contester' },
  shipping: { rank: 6, label: 'Frais de port', tone: 'blue', action: 'Non prévus à la commande' },
  discount: { rank: 7, label: 'Remise de pied', tone: 'green', action: 'Répartie sur le coût réel de chaque ligne' },
  free: { rank: 8, label: 'Offert', tone: 'green', action: 'Geste commercial, rien à faire' },
  packaging: { rank: 9, label: 'Conditionnement', tone: 'grey', action: 'Unités contre packs : même marchandise, même montant' },
  rounding: { rank: 10, label: 'Arrondi de remise', tone: 'grey', action: 'Calcul du fournisseur, pas une erreur de tarif' },
  other: { rank: 11, label: 'Ligne hors produit', tone: 'grey', action: 'À qualifier' },
  ok: { rank: 99, label: 'Conforme', tone: 'green', action: null },
};
const TONES = {
  red: { color: C.red, bg: C.redL }, orange: { color: C.orange, bg: C.orangeL },
  green: { color: C.green, bg: C.greenL }, blue: { color: C.blue, bg: C.blueL },
  grey: { color: C.greyT, bg: C.grey },
};

const STATUS_LABELS = { to_check: 'À contrôler', checked: 'Contrôlée', disputed: 'En litige', archived: 'Archivée' };
const PAYMENT_LABELS = { paid: 'Payée', partial: 'Partielle', unpaid: 'À payer', unknown: 'Inconnu' };
const METHODS = [
  ['amex', 'Amex'], ['cb', 'Carte bancaire'], ['virement', 'Virement'],
  ['prelevement', 'Prélèvement'], ['cheque', 'Chèque'], ['especes', 'Espèces'],
  ['avoir', 'Avoir'], ['autre', 'Autre'],
];

/* ─── Petits composants ──────────────────────────────────── */
const Badge = ({ children, tone = 'grey' }) => (
  <span style={{
    display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
    whiteSpace: 'nowrap', ...TONES[tone],
  }}>{children}</span>
);

const Kpi = ({ label, value, tone }) => (
  <div style={{
    flex: 1, minWidth: 140, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`,
    padding: '13px 16px',
  }}>
    <div style={{ fontSize: 21, fontWeight: 800, color: tone ? TONES[tone].color : C.dark }}>{value}</div>
    <div style={{ fontSize: 12, color: C.greyT, marginTop: 2 }}>{label}</div>
  </div>
);

const Btn = ({ children, onClick, variant = 'primary', disabled, small, type = 'button' }) => {
  const styles = {
    primary: { background: C.main, color: '#fff', border: 'none' },
    ghost: { background: '#fff', color: C.main, border: `1px solid ${C.greyB}` },
    danger: { background: '#fff', color: C.red, border: `1px solid ${C.red}` },
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      ...styles, padding: small ? '6px 11px' : '9px 16px', borderRadius: 8, fontWeight: 600,
      fontSize: small ? 12 : 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      whiteSpace: 'nowrap',
    }}>{children}</button>
  );
};

const inputStyle = {
  padding: '8px 10px', border: `1px solid ${C.greyB}`, borderRadius: 8,
  fontSize: 13, color: C.dark, outline: 'none', background: C.white,
};
const Field = ({ label, children, width }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: width || 150 }}>
    <label style={{ fontSize: 11, fontWeight: 600, color: C.greyT }}>{label}</label>
    {children}
  </div>
);
const th = { padding: '10px 12px', textAlign: 'left', fontSize: 11.5, fontWeight: 700, color: C.greyT, borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap' };
const td = { padding: '11px 12px', fontSize: 13, color: C.dark, borderBottom: `1px solid ${C.greyB}` };

/* ─── Tableau des différences ─────────────────────────────
 * Règle posée le 25/09/2026 : TOUTES les différences sont affichées, sans
 * filtre de seuil. Le seuil ne décide que de ce qui part en réclamation.
 * ──────────────────────────────────────────────────────── */
function DifferencesTable({ lines, mobile }) {
  const rows = useMemo(() => (lines || [])
    .filter((l) => l.verdict && l.verdict !== 'ok')
    .map((l) => ({ ...l, meta: VERDICTS[l.verdict] || VERDICTS.other }))
    .sort((a, b) => (a.meta.rank - b.meta.rank) || (Math.abs(b.gap) - Math.abs(a.gap))), [lines]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: 22, textAlign: 'center', color: C.green, fontWeight: 600, background: C.greenL, borderRadius: 10 }}>
        Aucune différence : la facture correspond à la commande, ligne à ligne.
      </div>
    );
  }

  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((l, i) => (
          <div key={i} style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{l.ref || '—'}</div>
              <Badge tone={l.meta.tone}>{l.meta.label}</Badge>
            </div>
            <div style={{ fontSize: 12, color: C.greyT, margin: '4px 0 8px' }}>{l.label || ''}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span>cmd {num(l.qtyOrdered)} → fact {num(l.qtyInvoiced)}</span>
              <strong style={{ color: l.gap > 0 ? C.red : C.green }}>{signedEur(l.gap)}</strong>
            </div>
            {l.meta.action && <div style={{ fontSize: 11.5, color: C.greyM, marginTop: 6 }}>{l.meta.action}</div>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 10, background: C.white }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Référence</th>
            <th style={th}>Produit</th>
            <th style={th}>Type</th>
            <th style={{ ...th, textAlign: 'right' }}>Qté cmd / fact</th>
            <th style={{ ...th, textAlign: 'right' }}>Tarif commandé</th>
            <th style={{ ...th, textAlign: 'right' }}>Tarif facturé</th>
            <th style={{ ...th, textAlign: 'right' }}>Écart HT</th>
            <th style={th}>À faire</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i}>
              <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{l.ref || '—'}</td>
              <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label || ''}</td>
              <td style={td}><Badge tone={l.meta.tone}>{l.meta.label}</Badge></td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{num(l.qtyOrdered)} / {num(l.qtyInvoiced)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{l.expectedUnitPrice == null ? '—' : eur(l.expectedUnitPrice)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{l.invoicedUnitPrice == null ? '—' : eur(l.invoicedUnitPrice)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: l.gap > 0 ? C.red : (l.gap < 0 ? C.green : C.greyT) }}>
                {signedEur(l.gap)}
                {l.explainedByDiscount > 0 && (
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: C.greyM, whiteSpace: 'nowrap' }}>
                    dont {eur(l.explainedByDiscount)} de remise
                  </div>
                )}
              </td>
              <td style={{ ...td, fontSize: 11.5, color: C.greyT }}>{l.meta.action || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lignes gelées en base → forme attendue par le tableau. */
const fromStoredLines = (lines) => (lines || []).map((l) => ({
  ref: l.supplier_sku,
  label: l.label,
  verdict: l.verdict,
  qtyOrdered: l.expected_qty,
  qtyInvoiced: l.qty,
  expectedUnitPrice: l.expected_unit_price,
  invoicedUnitPrice: l.qty && Number(l.qty) !== 0 ? Number(l.line_total_ht) / Number(l.qty) : null,
  gap: Number(l.gap) || 0,
}));

/* ═══════════════════════════════════════════════════════════
 * ONGLET 1 — Contrôle d'une facture
 * ═══════════════════════════════════════════════════════════ */
function ControlTab({ suppliers, mobile, onSaved }) {
  const [supplierId, setSupplierId] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);   // lu, PAS enregistré
  const [saved, setSaved] = useState(null);     // document en base, une fois validé
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);

  const reset = () => { setResult(null); setSaved(null); setError(null); setCopied(false); };

  // Lecture seule : rien n'est écrit tant que l'acheteur n'a pas validé.
  const analyse = async () => {
    if (!supplierId || !file) return;
    setBusy(true); reset();
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('supplier_id', supplierId);
      const { data } = await axios.post(`${BASE}/analyse`, form);
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setBusy(false); }
  };

  // Le fichier repart tel quel : le document enregistré est exactement celui
  // qui a été lu, et l'analyse rangée correspond à ce qui est affiché.
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('supplier_id', supplierId);
      const { data } = await axios.post(BASE, form);
      setSaved(data.document);
      setResult((r) => ({ ...r, document: data.document }));
      onSaved();
    } catch (e) {
      const d = e.response?.data;
      setError(d?.existing ? `${d.error} (enregistrée le ${date(d.existing.doc_date)})` : (d?.error || e.message));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!saved || !window.confirm('Supprimer ce document et son fichier ? Cette action est définitive.')) return;
    await axios.delete(`${BASE}/${saved.id}`);
    reset();
    setFile(null);
    onSaved();
  };

  const copyClaim = async () => {
    const { data } = await axios.get(`${BASE}/${saved.id}/claim`);
    if (!data.body) return;
    await navigator.clipboard.writeText(`${data.subject}\n\n${data.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const setStatus = async (status) => {
    const { data } = await axios.put(`${BASE}/${saved.id}/status`, { status });
    setSaved(data);
    onSaved();
  };

  const totals = result?.comparison?.totals;
  const summary = result?.comparison?.summary;

  return (
    <div style={{ padding: mobile ? '16px' : '22px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Fournisseur" width={230}>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={inputStyle}>
            <option value="">Choisir…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Btn onClick={analyse} disabled={!supplierId || !file || busy}>
          {busy ? 'Lecture en cours…' : 'Contrôler la facture'}
        </Btn>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
        onClick={() => fileInput.current?.click()}
        style={{
          border: `2px dashed ${dragging ? C.main : C.greyB}`, borderRadius: 12, padding: mobile ? 20 : 28,
          textAlign: 'center', cursor: 'pointer', background: dragging ? C.mainL : C.white,
        }}
      >
        <input ref={fileInput} type="file" accept=".pdf,.csv,.txt" style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files[0] || null)} />
        <div style={{ fontWeight: 600, color: file ? C.main : C.greyT, fontSize: 14 }}>
          {file ? file.name : 'Déposer la facture ou l’avoir ici, ou cliquer pour choisir'}
        </div>
        <div style={{ fontSize: 12, color: C.greyM, marginTop: 5 }}>
          La lecture n'enregistre rien : le document n'est rangé que si tu l'enregistres ensuite.
        </div>
      </div>

      {error && (
        <div style={{ padding: 14, background: C.redL, color: C.red, borderRadius: 10, fontSize: 13.5, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: C.dark }}>
                {result.invoice.docType === 'credit_note' ? 'Avoir' : 'Facture'} {result.invoice.number}
                {result.invoice.isProforma && <Badge tone="orange"> pro forma</Badge>}
              </div>
              <div style={{ fontSize: 12.5, color: C.greyT, marginTop: 3 }}>
                {result.supplier.name} · {date(result.invoice.date)}
                {result.order ? (
                  <> · commande <OrderLink order={result.order}>{result.order.bms_reference}</OrderLink>
                    {' '}({result.matchedBy === 'manual' ? 'désignée' : 'retrouvée par sa référence'})</>
                ) : ' · aucune commande retrouvée'}
              </div>
            </div>
            <Badge tone={saved ? (saved.status === 'disputed' ? 'red' : (saved.status === 'checked' ? 'green' : 'orange')) : 'grey'}>
              {saved ? STATUS_LABELS[saved.status] : 'Non enregistrée'}
            </Badge>
          </div>

          {result.duplicate && !saved && (
            <div style={{ padding: 13, background: C.redL, color: C.red, borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
              Ce document est <strong>déjà enregistré</strong> ({result.duplicate.number}, déposé le{' '}
              {date(result.duplicate.created_at)}, état « {STATUS_LABELS[result.duplicate.status]} »).
              L'enregistrer une seconde fois est refusé — c'est ce qui évite de le payer deux fois.
            </div>
          )}

          {result.needsManualOrder && (
            <div style={{ padding: 14, background: C.orangeL, color: C.orange, borderRadius: 10, fontSize: 13 }}>
              La référence <strong>{result.invoice.orderRefOnDoc || '—'}</strong> imprimée sur ce document ne correspond
              à aucune commande. Chez GFC et MG Vape, c'est le numéro interne du fournisseur : il faut désigner la
              commande à la main. Le document est enregistré, le contrôle reste à faire.
            </div>
          )}

          {totals && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Kpi label="Facture HT" value={eur(totals.invoiceParsed)} />
              <Kpi label="Commande HT" value={eur(totals.order)} />
              <Kpi label="Écart" value={signedEur(totals.gap)} tone={totals.gap > 0 ? 'red' : (totals.gap < 0 ? 'green' : 'grey')} />
              <Kpi label="Réclamable" value={eur(summary.claimable)} tone={summary.claimable > 0 ? 'red' : 'grey'} />
              <Kpi label="Manquants" value={signedEur(summary.qtyGap)} tone={summary.qtyGap < 0 ? 'orange' : 'grey'} />
            </div>
          )}

          {totals && totals.reconciles === false && (
            <div style={{ padding: 14, background: C.redL, color: C.red, borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
              Les lignes lues totalisent {eur(totals.invoiceParsed)} alors que le document annonce {eur(totals.invoicePrinted)}.
              Une ligne est probablement mal lue : ne rien réclamer sur cette base.
            </div>
          )}

          {summary?.hasFooterDiscount && summary.explainedByDiscount > 0 && (
            <div style={{ padding: 13, background: C.blueL, color: C.blue, borderRadius: 10, fontSize: 13 }}>
              Ce document porte une remise de pied de <strong>{eur(Math.abs(totals.footerDiscount))}</strong>.
              Les lignes sont facturées au prix brut : <strong>{eur(summary.explainedByDiscount)}</strong> des
              écarts de tarif ci-dessous s'expliquent par cette remise et ne sont pas réclamables.
            </div>
          )}

          <DifferencesTable lines={result.differences} mobile={mobile} />

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {!saved ? (
              <>
                <Btn onClick={save} disabled={busy || !!result.duplicate}>
                  {busy ? 'Enregistrement…' : 'Enregistrer la facture'}
                </Btn>
                <Btn variant="ghost" onClick={() => { reset(); setFile(null); }}>Abandonner</Btn>
                <span style={{ fontSize: 12, color: C.greyM }}>
                  Rien n'est conservé tant que tu n'as pas enregistré.
                </span>
              </>
            ) : (
              <>
                <Btn onClick={copyClaim} disabled={!summary || summary.claimable <= 0}>
                  {copied ? 'Message copié ✓' : 'Copier le message de réclamation'}
                </Btn>
                <Btn variant="ghost" onClick={() => downloadFile(saved.id, result.invoice.number)}>
                  Télécharger le document
                </Btn>
                <Btn variant="ghost" onClick={() => setStatus('checked')}>Marquer contrôlée</Btn>
                <Btn variant="ghost" onClick={() => setStatus('disputed')}>Mettre en litige</Btn>
                <Btn variant="danger" onClick={remove}>Supprimer</Btn>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Téléchargement avec le jeton : l'intercepteur axios pose l'en-tête. */
async function downloadFile(id, label) {
  const res = await axios.get(`${BASE}/${id}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(label || id).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════
 * ONGLET 2 — Classeur
 * ═══════════════════════════════════════════════════════════ */
function FilingTab({ suppliers, mobile, reloadKey }) {
  const [filters, setFilters] = useState({ supplier_id: '', status: '', payment_status: '', doc_type: '', from: '', to: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const { data } = await axios.get(BASE, { params });
      setRows(data);
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load, reloadKey]);

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    axios.get(`${BASE}/${openId}`).then(({ data }) => setDetail(data));
  }, [openId]);

  const remove = async (row) => {
    if (!window.confirm(`Supprimer ${row.number} (${row.supplier_name}) et son fichier ? Cette action est définitive.`)) return;
    await axios.delete(`${BASE}/${row.id}`);
    setOpenId(null);
    load();
  };

  const totalDu = rows.reduce((s, r) => s + (Number(r.remaining_amount) || 0), 0);
  const totalEcarts = rows.reduce((s, r) => s + (Number(r.difference_count) || 0), 0);

  return (
    <div style={{ padding: mobile ? '16px' : '22px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Fournisseur" width={190}>
          <select value={filters.supplier_id} onChange={(e) => setFilters({ ...filters, supplier_id: e.target.value })} style={inputStyle}>
            <option value="">Tous</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Type" width={130}>
          <select value={filters.doc_type} onChange={(e) => setFilters({ ...filters, doc_type: e.target.value })} style={inputStyle}>
            <option value="">Tous</option>
            <option value="invoice">Factures</option>
            <option value="credit_note">Avoirs</option>
            <option value="proforma">Pro forma</option>
          </select>
        </Field>
        <Field label="Contrôle" width={140}>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} style={inputStyle}>
            <option value="">Tous</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Paiement" width={130}>
          <select value={filters.payment_status} onChange={(e) => setFilters({ ...filters, payment_status: e.target.value })} style={inputStyle}>
            <option value="">Tous</option>
            <option value="unpaid">À payer</option>
            <option value="partial">Partielle</option>
            <option value="paid">Payée</option>
          </select>
        </Field>
        <Field label="Du" width={140}>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Au" width={140}>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} style={inputStyle} />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Kpi label="Documents" value={rows.length} />
        <Kpi label="Reste à payer" value={eur(totalDu)} tone={totalDu > 0 ? 'orange' : 'green'} />
        <Kpi label="Différences relevées" value={totalEcarts} tone={totalEcarts > 0 ? 'red' : 'green'} />
      </div>

      {loading ? <div style={{ color: C.greyT, fontSize: 13 }}>Chargement…</div> : (
        <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 10, background: C.white }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Numéro</th>
                <th style={th}>Fournisseur</th>
                <th style={th}>Type</th>
                <th style={{ ...th, textAlign: 'right' }}>Total TTC</th>
                <th style={{ ...th, textAlign: 'center' }}>Écarts</th>
                <th style={th}>Contrôle</th>
                <th style={th}>Échéance</th>
                <th style={th}>Paiement</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td style={{ ...td, textAlign: 'center', color: C.greyM, padding: 26 }} colSpan={10}>
                  Aucun document. Dépose une facture depuis l'onglet Contrôle.
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(r.id)}>
                  <td style={td}>{date(r.doc_date)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.number}</td>
                  <td style={td}>{r.supplier_name}</td>
                  <td style={td}>
                    {r.doc_type === 'credit_note'
                      ? <Badge tone="green">Avoir</Badge>
                      : (r.doc_type === 'proforma' ? <Badge tone="orange">Pro forma</Badge> : <Badge tone="grey">Facture</Badge>)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{eur(r.total_ttc)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {Number(r.difference_count) > 0
                      ? <Badge tone="red">{r.difference_count}</Badge>
                      : <span style={{ color: C.green }}>✓</span>}
                  </td>
                  <td style={td}><Badge tone={r.status === 'disputed' ? 'red' : (r.status === 'checked' ? 'green' : 'orange')}>{STATUS_LABELS[r.status]}</Badge></td>
                  <td style={td}>{date(r.effective_due_date)}</td>
                  <td style={td}>
                    <Badge tone={r.payment_status === 'paid' ? 'green' : (r.payment_status === 'partial' ? 'orange' : 'red')}>
                      {PAYMENT_LABELS[r.payment_status] || '—'}
                    </Badge>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <Btn small variant="ghost" onClick={(e) => { e.stopPropagation(); downloadFile(r.id, r.number); }}>PDF</Btn>
                    {' '}
                    <Btn small variant="danger" onClick={(e) => { e.stopPropagation(); remove(r); }}>Suppr.</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}
             onClick={() => setOpenId(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: mobile ? '100%' : 'min(920px, 92vw)', background: C.grey, height: '100%', overflowY: 'auto', padding: mobile ? 16 : 26,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  {detail.doc_type === 'credit_note' ? 'Avoir' : 'Facture'} {detail.number}
                </div>
                <div style={{ fontSize: 12.5, color: C.greyT, marginTop: 3 }}>
                  {detail.supplier_name} · {date(detail.doc_date)} · échéance {date(detail.effective_due_date)}
                  {detail.orders?.[0] && (
                    <> · commande <OrderLink order={detail.orders[0]}>{detail.orders[0].bms_reference}</OrderLink></>
                  )}
                </div>
              </div>
              <Btn variant="ghost" small onClick={() => setOpenId(null)}>Fermer</Btn>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <Kpi label="Total HT" value={eur(detail.total_ht)} />
              <Kpi label="Total TTC" value={eur(detail.total_ttc)} />
              <Kpi label="Réglé" value={eur(detail.paid_amount)} />
              <Kpi label="Reste dû" value={eur(detail.remaining_amount)} tone={Number(detail.remaining_amount) > 0 ? 'orange' : 'green'} />
            </div>

            {detail.payments?.length > 0 && (
              <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT, marginBottom: 8 }}>RÈGLEMENTS IMPUTÉS</div>
                {detail.payments.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                    <span>{date(p.paid_at)} · {(METHODS.find((m) => m[0] === p.method) || [])[1] || p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                    <strong>{eur(p.allocated)}</strong>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT, marginBottom: 8 }}>
              DIFFÉRENCES CONSTATÉES AU CONTRÔLE ({detail.lines.filter((l) => l.verdict && l.verdict !== 'ok').length} sur {detail.lines.length} lignes)
            </div>
            <DifferencesTable lines={fromStoredLines(detail.lines)} mobile={mobile} />

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
              <Btn variant="ghost" onClick={() => downloadFile(detail.id, detail.number)}>Télécharger le document</Btn>
              <Btn variant="danger" onClick={() => remove(detail)}>Supprimer</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 * ONGLET 3 — Règlements
 * ═══════════════════════════════════════════════════════════ */
function PaymentsTab({ suppliers, mobile, reloadKey, onSaved }) {
  const [payments, setPayments] = useState([]);
  const [unpaid, setUnpaid] = useState([]);
  const [form, setForm] = useState({ supplier_id: '', method: 'amex', paid_at: new Date().toISOString().slice(0, 10), reference: '' });
  const [selected, setSelected] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, u] = await Promise.all([
      axios.get(`${BASE}/payments`),
      axios.get(`${BASE}/unpaid`),
    ]);
    setPayments(p.data);
    setUnpaid(u.data);
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  // Un règlement porte sur UN fournisseur : c'est ce qui permet de solder
  // plusieurs de ses factures et ses avoirs d'un seul mouvement.
  const candidates = useMemo(
    () => unpaid.filter((d) => !form.supplier_id || String(d.supplier_id) === String(form.supplier_id)),
    [unpaid, form.supplier_id],
  );
  const total = useMemo(
    () => candidates.reduce((s, d) => s + (selected[d.document_id] ? Number(d.remaining_amount) : 0), 0),
    [candidates, selected],
  );

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const allocations = candidates
        .filter((d) => selected[d.document_id])
        .map((d) => ({ document_id: d.document_id, amount: Number(d.remaining_amount) }));
      if (allocations.length === 0) throw new Error('Sélectionner au moins un document à solder');
      await axios.post(`${BASE}/payments`, {
        supplier_id: form.supplier_id,
        method: form.method,
        paid_at: form.paid_at,
        amount: Math.round(total * 100) / 100,
        reference: form.reference,
        allocations,
      });
      setSelected({});
      setForm({ ...form, reference: '' });
      await load();
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ padding: mobile ? '16px' : '22px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Enregistrer un règlement</div>
        <div style={{ fontSize: 12.5, color: C.greyT, marginBottom: 14 }}>
          Un seul règlement peut solder plusieurs factures et venir en déduction d'un avoir — un relevé Amex,
          par exemple. Le moyen de paiement imprimé sur la facture n'engage à rien.
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <Field label="Fournisseur" width={200}>
            <select value={form.supplier_id} onChange={(e) => { setForm({ ...form, supplier_id: e.target.value }); setSelected({}); }} style={inputStyle}>
              <option value="">Choisir…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Moyen" width={160}>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} style={inputStyle}>
              {METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Date" width={150}>
            <input type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Référence" width={190}>
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
              placeholder="relevé Amex, n° de virement…" style={inputStyle} />
          </Field>
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: C.greyT }}>Montant du règlement</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.main }}>{eur(total)}</div>
          </div>
          <Btn onClick={submit} disabled={busy || !form.supplier_id || total === 0}>Enregistrer</Btn>
        </div>

        {error && <div style={{ padding: 12, background: C.redL, color: C.red, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <div style={{ maxHeight: 280, overflowY: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}></th><th style={th}>Date</th><th style={th}>Document</th><th style={th}>Fournisseur</th>
              <th style={th}>Échéance</th><th style={{ ...th, textAlign: 'right' }}>Reste dû</th>
            </tr></thead>
            <tbody>
              {candidates.length === 0 && (
                <tr><td style={{ ...td, textAlign: 'center', color: C.greyM, padding: 20 }} colSpan={6}>
                  {form.supplier_id ? 'Rien à régler pour ce fournisseur.' : 'Choisir un fournisseur.'}
                </td></tr>
              )}
              {candidates.map((d) => {
                const retard = d.days_overdue > 0;
                return (
                  <tr key={d.document_id}>
                    <td style={td}>
                      <input type="checkbox" checked={!!selected[d.document_id]}
                        onChange={(e) => setSelected({ ...selected, [d.document_id]: e.target.checked })} />
                    </td>
                    <td style={td}>{date(d.doc_date)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {d.number} {d.doc_type === 'credit_note' && <Badge tone="green">avoir</Badge>}
                    </td>
                    <td style={td}>{d.supplier_name}</td>
                    <td style={{ ...td, color: retard ? C.red : C.dark, fontWeight: retard ? 700 : 400 }}>
                      {date(d.effective_due_date)}{retard ? ` (+${d.days_overdue} j)` : ''}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{eur(d.remaining_amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT, marginBottom: 8 }}>RÈGLEMENTS ENREGISTRÉS</div>
        <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 10, background: C.white }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Fournisseur</th><th style={th}>Moyen</th><th style={th}>Référence</th>
              <th style={{ ...th, textAlign: 'center' }}>Documents</th>
              <th style={{ ...th, textAlign: 'right' }}>Montant</th>
              <th style={{ ...th, textAlign: 'right' }}>Non imputé</th>
            </tr></thead>
            <tbody>
              {payments.length === 0 && (
                <tr><td style={{ ...td, textAlign: 'center', color: C.greyM, padding: 24 }} colSpan={7}>Aucun règlement enregistré.</td></tr>
              )}
              {payments.map((p) => (
                <tr key={p.id}>
                  <td style={td}>{date(p.paid_at)}</td>
                  <td style={td}>{p.supplier_name}</td>
                  <td style={td}><Badge tone="blue">{(METHODS.find((m) => m[0] === p.method) || [])[1] || p.method}</Badge></td>
                  <td style={td}>{p.reference || '—'}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{p.document_count}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{eur(p.amount)}</td>
                  <td style={{ ...td, textAlign: 'right', color: Math.abs(Number(p.unallocated_amount)) > 0.009 ? C.red : C.greyM }}>
                    {eur(p.unallocated_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
const TABS = [
  ['control', 'Contrôle'],
  ['filing', 'Classeur'],
  ['payments', 'Règlements'],
];

export default function SupplierInvoicesApp() {
  const mobile = useIsMobile();
  const [tab, setTab] = useState('control');
  const [suppliers, setSuppliers] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);

  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    // Seuls les fournisseurs dont on sait lire les factures sont proposés :
    // en choisir un autre ne donnerait qu'une erreur de parseur.
    Promise.all([
      axios.get(`${API}/purchases/suppliers`),
      axios.get(`${BASE}/parsers`),
    ]).then(([s, p]) => {
      // `/purchases/suppliers` répond `{ success, data }`, pas un tableau nu —
      // contrairement à la plupart des routeurs de l'app. On accepte les deux
      // formes plutôt que de parier sur l'une d'elles.
      const list = Array.isArray(s.data) ? s.data : (s.data?.data || s.data?.suppliers || []);
      const known = new Set(p.data.suppliers || []);
      const usable = list.filter((x) => known.has(x.code)).sort((a, b) => a.name.localeCompare(b.name));
      setSuppliers(usable);
      // Une liste vide n'est pas un état normal : sans message, l'écran donne
      // un menu déroulant muet et rien n'explique pourquoi.
      setLoadError(usable.length === 0 ? 'Aucun fournisseur exploitable n’a pu être chargé.' : null);
    }).catch((e) => {
      setSuppliers([]);
      setLoadError(e.response?.data?.error || e.message || 'Chargement des fournisseurs impossible');
    });
  }, []);

  return (
    <AppShell currentPath="/factures-fournisseurs">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey }}>
        <section style={{ padding: mobile ? '18px 16px 0' : '26px 40px 0', background: C.white, borderBottom: `1px solid ${C.greyB}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: C.main, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <InvoiceIcon size={26} color="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: C.dark, margin: 0, fontFamily: "'Tilt Warp', cursive" }}>
                Factures Fournisseurs
              </h1>
              <p style={{ fontSize: 13, color: C.greyT, margin: '3px 0 0' }}>
                Contrôler une facture contre sa commande, réclamer les écarts de tarif, ranger les documents et suivre les règlements.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 16 }}>
            {TABS.map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13.5, fontWeight: tab === key ? 800 : 600,
                color: tab === key ? C.main : C.greyT,
                borderBottom: `3px solid ${tab === key ? C.main : 'transparent'}`,
              }}>{label}</button>
            ))}
          </div>
        </section>

        {loadError && (
          <div style={{
            margin: mobile ? '16px' : '18px 40px 0', padding: 13, background: C.redL, color: C.red,
            borderRadius: 10, fontSize: 13, fontWeight: 600,
          }}>{loadError}</div>
        )}

        {tab === 'control' && <ControlTab suppliers={suppliers} mobile={mobile} onSaved={bump} />}
        {tab === 'filing' && <FilingTab suppliers={suppliers} mobile={mobile} reloadKey={reloadKey} />}
        {tab === 'payments' && <PaymentsTab suppliers={suppliers} mobile={mobile} reloadKey={reloadKey} onSaved={bump} />}
      </main>
    </AppShell>
  );
}
