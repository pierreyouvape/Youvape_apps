import { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── DESIGN TOKENS ─────────────────────────────────────── */
const C = {
  orange: '#E28F00', orangeGrad: '#F59E0B', orangeDark: '#C97F09',
  saphir: '#135E84', saphirF: '#003A56',
  bleu: '#0071EB', violet: '#6366F1',
  vert: '#4AB866', rouge: '#DE2020',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

/* ─── PETITS COMPOSANTS UI ──────────────────────────────── */
function Card({ children, style }) {
  return (
    <div style={{
      background: C.blanc, borderRadius: 12,
      border: `1px solid ${C.grisCL}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      padding: '22px 24px', marginBottom: 18,
      ...style,
    }}>
      {children}
    </div>
  );
}

function CardLabel({ n, title, required }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{
        width: 24, height: 24, borderRadius: 6,
        background: 'rgba(226,143,0,0.12)', color: C.orange,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 800,
      }}>{n}</span>
      <h3 style={{ fontSize: 14.5, fontWeight: 800, color: C.grisTF, margin: 0 }}>
        {title} {required && <span style={{ color: C.rouge }}>*</span>}
      </h3>
    </div>
  );
}

function Th({ label, align = 'left', width }) {
  return (
    <th style={{
      padding: '12px 14px', fontSize: 11.5, fontWeight: 800,
      color: C.grisF, textTransform: 'uppercase', letterSpacing: '0.04em',
      textAlign: align, whiteSpace: 'nowrap',
      background: '#FAFBFC', borderBottom: `1px solid ${C.grisCL}`,
      position: 'sticky', top: 0, zIndex: 2,
      width,
    }}>{label}</th>
  );
}

function NumInput({ value, onChange, step = '1', width = 70, suffix, placeholder }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      border: `1px solid ${C.grisCL}`, borderRadius: 6,
      padding: '3px 7px', background: C.blanc,
    }}>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value === '' ? '' : parseFloat(e.target.value))}
        style={{
          width, border: 'none', outline: 'none',
          fontSize: 13, fontFamily: 'Lato', color: C.grisTF,
          textAlign: 'center', background: 'transparent',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
      {suffix && <span style={{ fontSize: 11, color: C.grisM, fontWeight: 600 }}>{suffix}</span>}
    </div>
  );
}

const BackIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
  </svg>
);

const UploadIcon = ({ color = C.saphir }) => (
  <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>
  </svg>
);

const DocIcon = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/>
  </svg>
);

const SparkleIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/>
    <path d="M19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14z"/>
  </svg>
);

const InfoIcon = () => (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#1B4F78" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
  </svg>
);

/* ─── PAGE ──────────────────────────────────────────────── */
const ImportPdfPage = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();
  const inputRef = useRef(null);

  // Etape 1 : Upload
  const [suppliers, setSuppliers] = useState([]);
  const [availableParsers, setAvailableParsers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');

  // Etape 2 : Preview
  const [parsedData, setParsedData] = useState(null);
  const [items, setItems] = useState([]);
  const [newSupplierSkus, setNewSupplierSkus] = useState([]);

  // Etape 2 : Dernier tarif validé (commande BMS vérifiée) par wp_product_id
  const [lastVerified, setLastVerified] = useState({});
  const fetchedVerifiedRef = useRef(new Set());

  // Etape 2 : Recherche pour lignes non matchées
  const [searchingIdx, setSearchingIdx] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeoutRef = useRef(null);

  // Etape 3 : Création
  const [creating, setCreating] = useState(false);

  // Charger fournisseurs + parseurs disponibles
  useEffect(() => {
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      axios.get(`${API_URL}/purchases/suppliers`, { headers }),
      axios.get(`${API_URL}/purchases/parsers`, { headers })
    ]).then(([suppRes, parsRes]) => {
      setSuppliers(suppRes.data.data || []);
      setAvailableParsers(parsRes.data.data || []);
    }).catch(err => console.error('Erreur chargement:', err));
  }, [token]);

  // Réinitialiser le cache « dernier tarif validé » si le fournisseur change
  useEffect(() => {
    fetchedVerifiedRef.current = new Set();
    setLastVerified({});
  }, [supplierId]);

  // Charger le dernier tarif validé pour chaque produit matché (une fois par produit),
  // puis l'appliquer AUTOMATIQUEMENT : le tarif validé est prioritaire sur le prix du
  // document (PDF/CSV) et sur le prix BDD. On ne touche pas une ligne éditée à la main.
  useEffect(() => {
    if (!supplierId) return;
    const ids = [...new Set(
      items
        .filter(i => i.matched && i.product_id)
        .map(i => i.product_id)
        .filter(id => !fetchedVerifiedRef.current.has(id))
    )];
    if (ids.length === 0) return;
    ids.forEach(id => fetchedVerifiedRef.current.add(id));
    axios.post(
      `${API_URL}/purchases/last-verified-prices`,
      { supplier_id: parseInt(supplierId), product_ids: ids },
      { headers: { Authorization: `Bearer ${token}` } }
    ).then(res => {
      const data = res.data.data || {};
      setLastVerified(prev => ({ ...prev, ...data }));
      setItems(prev => prev.map(item => {
        if (item.item_type === 'discount' || !item.matched || item.priceEdited) return item;
        const v = data[item.product_id];
        if (!v) return item;
        // Tarif validé net → on le pose comme prix et on annule la remise
        return { ...item, unit_price: v.unit_price, discount: 0, verifiedApplied: true };
      }));
    }).catch(err => console.error('Erreur dernier tarif validé:', err));
  }, [items, supplierId, token]);

  const selectedSupplier = suppliers.find(s => s.id === parseInt(supplierId));
  const hasParser = selectedSupplier ? availableParsers.includes(selectedSupplier.code) : false;
  const isReady = supplierId && pdfFile && hasParser;

  // ==================== ETAPE 1 ====================

  const pickFile = (f) => {
    if (!f) return;
    const name = f.name.toLowerCase();
    const isPdf = f.type === 'application/pdf' || name.endsWith('.pdf');
    const isCsv = f.type === 'text/csv' || name.endsWith('.csv');
    if (!isPdf && !isCsv) {
      alert('Merci de sélectionner un fichier PDF ou CSV.');
      return;
    }
    setPdfFile(f);
    setParseError('');
  };

  const handleParsePdf = async () => {
    if (!supplierId || !pdfFile) return;
    setParsing(true);
    setParseError('');
    try {
      const formData = new FormData();
      formData.append('pdf', pdfFile);
      formData.append('supplier_id', supplierId);
      const response = await axios.post(`${API_URL}/purchases/orders/parse-pdf`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      const data = response.data.data;
      setParsedData(data);
      setItems(data.items.map(item => ({
        ...item,
        unit_price: item.item_type === 'discount' ? item.unit_price : (item.pdf_price ?? item.unit_price),
        discount: item.discount_percent || 0,
      })));
      setNewSupplierSkus([]);
    } catch (err) {
      setParseError(err.response?.data?.error || 'Erreur lors du parsing du fichier');
    } finally {
      setParsing(false);
    }
  };

  // ==================== ETAPE 2 ====================

  const handleSearchProduct = (value, idx) => {
    setSearchTerm(value);
    setSearchingIdx(idx);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (value.length < 2) { setSearchResults([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await axios.get(
          `${API_URL}/purchases/products/search?q=${encodeURIComponent(value)}&limit=20`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setSearchResults(response.data.data || []);
      } catch (err) {
        console.error('Erreur recherche:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  };

  const handleMatchProduct = (idx, product) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      return {
        ...item,
        matched: true,
        product_id: product.id,
        product_name: product.post_title,
        product_sku: product.sku,
        current_stock: product.stock,
        image_url: product.image_url || null,
        ambiguous_match: false,
        supplier_price: product.cost_price != null ? parseFloat(product.cost_price) : null,
        unit_price: item.unit_price ?? product.cost_price ?? null,
      };
    }));
    const item = items[idx];
    setNewSupplierSkus(prev => [
      ...prev.filter(e => e.supplier_sku !== item.supplier_sku),
      { product_id: product.id, supplier_sku: item.supplier_sku }
    ]);
    setSearchingIdx(null);
    setSearchTerm('');
    setSearchResults([]);
  };

  const handleUpdateQty = (idx, value) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, qty_ordered: Math.max(1, parseInt(value) || 1) } : item
    ));
  };

  const handleUpdatePrice = (idx, value) => {
    // priceEdited : saisie manuelle → l'auto-application du tarif validé ne la réécrit pas.
    // verifiedApplied conservé pour que le prix saisi parte tel quel dans BMS (sans plafond BDD).
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, unit_price: value === '' ? null : parseFloat(value) || null, priceEdited: true } : item
    ));
  };

  const handleUpdateDiscount = (idx, value) => {
    const d = value === '' ? 0 : Math.min(100, Math.max(0, parseFloat(value) || 0));
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, discount: d } : item));
  };

  // Appliquer le dernier tarif validé (commande vérifiée) à une ligne.
  // Le prix validé est net → on le pose comme prix et on remet la remise à 0.
  // verifiedApplied = true fait que effectivePrice l'utilise tel quel (sans le
  // plafonner au prix BDD, justement peu fiable ici).
  const applyVerifiedPrice = (idx) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const v = lastVerified[item.product_id];
      if (!v) return item;
      return { ...item, unit_price: v.unit_price, discount: 0, verifiedApplied: true };
    }));
  };

  const applyAllVerifiedPrices = () => {
    setItems(prev => prev.map(item => {
      if (item.item_type === 'discount' || !item.matched) return item;
      const v = lastVerified[item.product_id];
      if (!v) return item;
      return { ...item, unit_price: v.unit_price, discount: 0, verifiedApplied: true };
    }));
  };

  const handleRemoveItem = (idx) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleRematch = (idx) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, matched: false, product_id: null, product_name: null, product_sku: null, current_stock: null } : item
    ));
    setSearchingIdx(idx);
    setSearchTerm('');
    setSearchResults([]);
  };

  const effectivePrice = (item) => {
    if (item.item_type === 'discount') return item.unit_price;
    // Tarif validé explicitement appliqué : utilisé tel quel (pas de plafond BDD)
    if (item.verifiedApplied && item.unit_price) return item.unit_price * (1 - (item.discount || 0) / 100);
    if (!item.unit_price) return item.supplier_price ?? null;
    const pdfNet = item.unit_price * (1 - (item.discount || 0) / 100);
    if (item.supplier_price != null && item.supplier_price < pdfNet) return item.supplier_price;
    return pdfNet;
  };

  const lineTotalOf = (item) => {
    const p = effectivePrice(item);
    return p ? item.qty_ordered * p : null;
  };

  // Contrôle ligne à ligne vs le montant du document fournisseur.
  // ATTENTION : ces PDF sont des PRO FORMA — le tarif définitif est celui appliqué
  // dans BMS après réception de la vraie facture. Un écart de PRIX est donc NORMAL
  // (ex. Hello Cloudy 6,60 € en pro forma, 6,20 € facturés) et ne doit pas alerter.
  // On ne signale que les écarts de FACTEUR (×1,5 et plus), signature d'une erreur
  // de conditionnement ou de quantité — typiquement un « pack offre » compté 1 au
  // lieu de 3 — jamais d'une simple révision tarifaire.
  const ECART_FACTEUR = 1.5;
  const ECART_MINI_EUR = 5;
  const lineMismatch = (item) => {
    if (item.item_type === 'discount' || !item.matched) return null;
    const invoice = item.invoice_line_total_ht;
    if (invoice == null || invoice <= 0) return null;
    const lineTotal = lineTotalOf(item);
    if (lineTotal == null) return null;
    const diff = lineTotal - invoice;
    if (Math.abs(diff) < ECART_MINI_EUR) return null;
    const ratio = lineTotal / invoice;
    if (ratio < ECART_FACTEUR && ratio > 1 / ECART_FACTEUR) return null;
    // Facteur lisible : ×3 si trop haut, ÷3 si trop bas
    const facteur = ratio >= 1
      ? `×${(Math.round(ratio * 10) / 10).toString().replace('.', ',')}`
      : `÷${(Math.round((1 / ratio) * 10) / 10).toString().replace('.', ',')}`;
    return { invoice, diff, facteur };
  };

  // ==================== ETAPE 3 ====================

  const productItems = items.filter(i => i.item_type !== 'discount');
  const discountItems = items.filter(i => i.item_type === 'discount');
  const matchedItems = productItems.filter(i => i.matched && i.product_id);
  const mismatchedCount = productItems.filter(i => lineMismatch(i)).length;
  const mismatchedTotal = productItems.reduce((sum, i) => {
    const m = lineMismatch(i);
    return sum + (m ? m.diff : 0);
  }, 0);
  // Produits déjà associés à une ligne : on les masque des suggestions de recherche
  const usedProductIds = new Set(matchedItems.map(i => i.product_id));

  // Refus BMS « décidable » : on affiche la raison et on laisse l'utilisateur choisir
  // d'envoyer la commande en l'état. Chaque acceptation renvoie les drapeaux fournis par
  // l'API (skip_missing, ignore_total_mismatch) ; un nouveau refus relance le dialogue.
  const resolveBmsRefusal = async (orderId, orderNum, refusal, flags = {}) => {
    if (!refusal.can_send_anyway) {
      alert(`Commande ${orderNum} créée, mais NON envoyée à BMS :\n\n${refusal.message}`);
      return false;
    }
    const label = refusal.code === 'BMS_MISSING_PRODUCTS'
      ? `sans ${(refusal.missing_skus || []).length > 1 ? 'ces produits' : 'ce produit'}`
      : 'en l\'état';
    if (!confirm(`Commande ${orderNum} créée, mais NON envoyée à BMS.\n\n${refusal.message}\n\nEnvoyer quand même la commande à BMS ${label} ?`)) {
      alert(`Commande ${orderNum} conservée, non envoyée à BMS. Vous pourrez l'envoyer depuis l'onglet Commandes.`);
      return false;
    }
    try {
      const sent = await axios.post(
        `${API_URL}/purchases/orders/${orderId}/send-bms`,
        { ...flags, ...refusal.retry_flags },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const skipped = sent.data.skipped_items || [];
      alert(skipped.length
        ? `Commande ${orderNum} envoyée à BMS sans ${skipped.length} produit(s) :\n` +
          skipped.map(p => `  • ${p.name} (${p.sku})`).join('\n') +
          `\n\nCes produits ne sont PAS dans le bon de commande BMS (une note a été ajoutée à la commande) : créez-les dans BMS puis ajoutez-les au bon de commande.`
        : `Commande ${orderNum} envoyée à BMS.`);
      return true;
    } catch (e) {
      const data = e.response?.data;
      // Nouveau refus décidable (ex. après l'écart de total, des produits manquants)
      if (data?.retry_flags) {
        return resolveBmsRefusal(orderId, orderNum, {
          message: data.error,
          code: data.code,
          missing_skus: data.missing_skus,
          retry_flags: data.retry_flags,
          can_send_anyway: data.can_send_anyway
        }, { ...flags, ...refusal.retry_flags });
      }
      alert(data?.error || 'Erreur lors de l\'envoi à BMS');
      return false;
    }
  };

  const handleCreateOrder = async (sendToBms = false) => {
    if (matchedItems.length === 0) { alert('Aucune ligne matchée à créer'); return; }
    setCreating(true);
    try {
      const payload = {
        supplier_id: parseInt(supplierId),
        order_number: parsedData.order_number || undefined,
        order_date: parsedData.order_date || undefined,
        // Total HT produits lu sur la facture — garde-fou de réconciliation à l'envoi BMS.
        invoice_total_ht: parsedData.invoice_total_ht ?? undefined,
        status: 'confirmed',
        items: [
          ...matchedItems.map(item => ({
            product_id: item.product_id,
            product_name: item.product_name,
            supplier_sku: item.supplier_sku,
            qty_ordered: item.qty_ordered,
            unit_price: effectivePrice(item),
            discount_percent: item.discount || 0,
            stock_before: item.current_stock,
          })),
          ...discountItems.map(item => ({
            item_type: 'discount',
            product_name: item.product_name,
            unit_price: item.unit_price,
          })),
        ],
        new_supplier_skus: newSupplierSkus,
        send_to_bms: sendToBms,
      };
      const response = await axios.post(`${API_URL}/purchases/orders`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const created = response.data.data;
      const orderNum = created?.order_number || parsedData.order_number || '';

      // La commande locale est TOUJOURS conservée quand BMS refuse pour une raison
      // « décidable » (produits pas encore créés dans BMS, écart avec le total du
      // document parce qu'on ne commande qu'une partie des lignes) : on ne perd pas
      // l'import, on demande simplement quoi faire.
      if (response.data.bms_error) {
        await resolveBmsRefusal(created.id, orderNum, response.data.bms_error);
      } else {
        const skipped = response.data.skipped_items || [];
        alert(`Commande ${orderNum} créée avec ${matchedItems.length} article(s)${sendToBms ? ' et envoyée à BMS' : ''}` +
              (skipped.length ? `\n\n${skipped.length} produit(s) absent(s) de BMS non envoyé(s) : ` +
                                skipped.map(p => p.sku).join(', ') : ''));
      }
      navigate('/purchases?tab=orders');
    } catch (err) {
      console.error('Erreur création:', err);
      alert(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  };

  const totalQty = matchedItems.reduce((sum, i) => sum + i.qty_ordered, 0);
  const totalHtProduits = matchedItems.reduce((sum, i) => { const p = effectivePrice(i); return sum + (p ? i.qty_ordered * p : 0); }, 0);
  const totalRemises = discountItems.reduce((sum, i) => sum + (i.unit_price || 0), 0);
  const totalHt = totalHtProduits + totalRemises;
  const totalTtc = totalHt * 1.2;
  const fmt = n => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const goBack = () => navigate('/purchases?tab=orders');

  return (
    <AppShell currentPath="/purchases">
      <main className="main-scroll" style={{
        flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: "'Lato', sans-serif",
      }}>
        {/* Top bar */}
        <header style={{
          background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
          padding: '0 28px', minHeight: 58,
          display: 'flex', alignItems: 'center', gap: 14,
          position: 'sticky', top: 0, zIndex: 20,
        }}>
          <button onClick={goBack} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: `linear-gradient(155deg, ${C.orangeGrad}, ${C.orangeDark})`,
            color: '#fff', border: 'none', borderRadius: 8,
            padding: '7px 14px', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 2px 6px rgba(245,158,11,0.35)',
          }}>
            <BackIcon /> Retour aux commandes
          </button>
          <h1 style={{
            fontSize: 16, fontWeight: 800, color: C.grisTF,
            fontFamily: "'Tilt Warp', cursive", margin: 0,
          }}>Import fournisseur (PDF / CSV)</h1>
        </header>

        <div style={{ padding: '28px', flex: 1 }}>
          <div style={{ maxWidth: parsedData ? 'none' : 760, margin: parsedData ? 0 : '0 auto' }}>

            {/* ==================== ETAPE 1 : UPLOAD ==================== */}
            {!parsedData && (
              <>
                <p style={{ fontSize: 13.5, color: C.grisF, marginBottom: 22, lineHeight: 1.5 }}>
                  Déposez le bon de commande reçu de votre fournisseur — PDF, ou export CSV de
                  commande (LVP Distribution). Les lignes sont extraites automatiquement pour créer
                  une commande pré-remplie.
                </p>

                {/* Card fournisseur */}
                <Card>
                  <CardLabel n={1} title="Fournisseur" required />
                  <p style={{ fontSize: 12.5, color: C.grisM, marginBottom: 12 }}>
                    Sélectionnez le fournisseur émetteur du bon de commande.
                  </p>
                  <div style={{ position: 'relative' }}>
                    <select
                      value={supplierId}
                      onChange={e => { setSupplierId(e.target.value); setParseError(''); }}
                      style={{
                        width: '100%', appearance: 'none', WebkitAppearance: 'none',
                        border: `1px solid ${C.grisCL}`, borderRadius: 9,
                        padding: '11px 36px 11px 14px',
                        fontSize: 14, fontFamily: 'Lato',
                        color: supplierId ? C.grisTF : C.grisM,
                        background: C.blanc, cursor: 'pointer',
                      }}
                    >
                      <option value="">— Sélectionner un fournisseur —</option>
                      {(() => {
                        const active = suppliers.filter(s => s.is_active);
                        const withParser = active.filter(s => availableParsers.includes(s.code));
                        const withoutParser = active.filter(s => !availableParsers.includes(s.code));
                        return (
                          <>
                            {withParser.length > 0 && <option disabled>── Avec parseur ──</option>}
                            {withParser.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            {withoutParser.length > 0 && <option disabled>── Sans parseur ──</option>}
                            {withoutParser.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </>
                        );
                      })()}
                    </select>
                    <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 4 L6 8 L10 4" stroke={C.grisM} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </div>
                  {supplierId && !hasParser && (
                    <div style={{ marginTop: 10, color: C.rouge, fontSize: 13 }}>
                      Aucun parseur PDF configuré pour ce fournisseur (code : {selectedSupplier?.code || 'non défini'}).
                      Parseurs disponibles : {availableParsers.join(', ') || 'aucun'}
                    </div>
                  )}
                </Card>

                {/* Card fichier PDF/CSV */}
                <Card>
                  <CardLabel n={2} title="Fichier PDF ou CSV" required />
                  <p style={{ fontSize: 12.5, color: C.grisM, marginBottom: 14 }}>
                    Glissez-déposez ou cliquez pour parcourir. PDF ou CSV, max 5 Mo.
                  </p>

                  {!pdfFile ? (
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
                      onClick={() => inputRef.current?.click()}
                      style={{
                        border: `2px dashed ${dragOver ? C.orange : C.grisCL}`,
                        background: dragOver ? '#FFF7E8' : '#FAFBFC',
                        borderRadius: 12, padding: '36px 24px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                        cursor: 'pointer', transition: 'all 0.18s', textAlign: 'center',
                      }}
                    >
                      <div style={{
                        width: 56, height: 56, borderRadius: 14,
                        background: dragOver ? 'rgba(226,143,0,0.18)' : 'rgba(19,94,132,0.08)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.18s',
                      }}>
                        <UploadIcon color={dragOver ? C.orange : C.saphir} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.grisTF, marginBottom: 3 }}>
                          {dragOver ? 'Relâchez pour ajouter le fichier' : 'Glissez votre PDF ou CSV ici'}
                        </div>
                        <div style={{ fontSize: 12.5, color: C.grisM }}>
                          ou <span style={{ color: C.orange, fontWeight: 700 }}>parcourez vos fichiers</span>
                        </div>
                      </div>
                      <input
                        ref={inputRef}
                        type="file"
                        accept="application/pdf,.pdf,.csv,text/csv"
                        onChange={e => pickFile(e.target.files?.[0])}
                        style={{ display: 'none' }}
                      />
                    </div>
                  ) : (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '14px 16px',
                      background: 'linear-gradient(180deg, #F8FBFD 0%, #F2F6F8 100%)',
                      border: `1px solid ${C.grisCL}`, borderRadius: 10,
                    }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 9, flexShrink: 0,
                        background: `linear-gradient(155deg, ${C.saphir}, ${C.saphirF})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(19,94,132,0.25)',
                      }}>
                        <DocIcon />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 14, fontWeight: 700, color: C.grisTF,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{pdfFile.name}</div>
                        <div style={{ fontSize: 12, color: C.grisM, marginTop: 2 }}>
                          {(pdfFile.size / 1024).toFixed(0)} Ko · {(pdfFile.name.split('.').pop() || '').toUpperCase()}
                        </div>
                      </div>
                      <button onClick={() => setPdfFile(null)} style={{
                        width: 32, height: 32, borderRadius: 7,
                        background: C.blanc, border: `1px solid ${C.grisCL}`,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', padding: 0, color: C.grisM,
                        fontSize: 18, fontWeight: 700,
                      }}>×</button>
                    </div>
                  )}
                </Card>

                {/* Erreur */}
                {parseError && (
                  <div style={{
                    background: '#FBE8EA', borderRadius: 10,
                    padding: '12px 16px', marginBottom: 18,
                    color: '#C24555', fontSize: 13.5,
                    border: '1px solid #F4C5CB',
                  }}>
                    {parseError}
                  </div>
                )}

                {/* Footer actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '4px 0 24px' }}>
                  <button onClick={goBack} style={{
                    background: C.blanc, color: C.grisF,
                    border: `1px solid ${C.grisCL}`, borderRadius: 8,
                    padding: '10px 18px', fontSize: 13.5, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    Annuler
                  </button>
                  <button
                    onClick={handleParsePdf}
                    disabled={parsing || !isReady}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      background: isReady && !parsing
                        ? `linear-gradient(155deg, ${C.orangeGrad}, ${C.orangeDark})`
                        : C.grisCL,
                      color: '#fff', border: 'none', borderRadius: 8,
                      padding: '10px 22px', fontSize: 13.5, fontWeight: 800,
                      cursor: isReady && !parsing ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit',
                      boxShadow: isReady && !parsing ? '0 4px 12px rgba(245,158,11,0.4)' : 'none',
                      opacity: isReady && !parsing ? 1 : 0.7,
                      transition: 'transform 0.15s',
                    }}
                  >
                    <SparkleIcon />
                    {parsing ? 'Analyse en cours…' : 'Analyser le document'}
                  </button>
                </div>
              </>
            )}

            {/* ==================== ETAPE 2 : REVUE ==================== */}
            {parsedData && (
              <>
                {/* Recap header */}
                <Card>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                    <div>
                      <h2 style={{
                        fontSize: 18, fontWeight: 800, color: C.grisTF,
                        fontFamily: "'Tilt Warp', cursive", marginBottom: 8,
                      }}>
                        {parsedData.supplier_name} <span style={{ color: C.grisM }}>—</span> Commande {parsedData.order_number || '?'}
                      </h2>
                      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: C.grisF }}>
                        {parsedData.order_date && <span><strong style={{ color: C.grisTF }}>Date</strong> : {parsedData.order_date}</span>}
                        <span><strong style={{ color: C.grisTF }}>{parsedData.total_items}</strong> ligne{parsedData.total_items > 1 ? 's' : ''}</span>
                        <span style={{ color: '#2A8049', fontWeight: 700 }}>
                          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#2A8049', marginRight: 5 }} />
                          {parsedData.matched_count} matchée{parsedData.matched_count > 1 ? 's' : ''}
                        </span>
                        {parsedData.unmatched_count > 0 && (
                          <span style={{ color: C.orange, fontWeight: 700 }}>
                            {parsedData.unmatched_count} non matchée{parsedData.unmatched_count > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => { setParsedData(null); setItems([]); setNewSupplierSkus([]); }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                        background: C.blanc, color: C.grisF, border: `1px solid ${C.grisCL}`,
                        borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      <BackIcon /> Nouveau document
                    </button>
                  </div>

                  {/* Anomalie de lecture du document : une ligne du PDF n'a pas ete
                      reprise, ou le total imprime ne colle pas aux lignes lues.
                      En rouge et au-dessus de tout : c'est le seul signal qui
                      empeche de commander une facture amputee sans s'en rendre compte. */}
                  {(parsedData.parse_warnings || []).map((w, wi) => (
                    <div key={wi} style={{ marginTop: 14, padding: '12px 14px', background: '#FEF2F2', borderRadius: 8, border: '1px solid #FCA5A5', fontSize: 13, color: '#991B1B' }}>
                      <div style={{ fontWeight: 700 }}>⚠️ {w.message}</div>
                      {(w.rows || []).length > 0 && (
                        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                          {w.rows.map((r, ri) => (
                            <li key={ri} style={{ marginTop: 2 }}>
                              {r.context ? <span style={{ opacity: 0.85 }}>{r.context} — </span> : null}
                              <strong>{r.qty} × {Number(r.unit_price).toFixed(2)} € = {Number(r.total).toFixed(2)} € HT</strong>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}

                  {parsedData.duplicate_warning && (
                    <div style={{ marginTop: 14, padding: '10px 14px', background: '#FFF4E0', borderRadius: 8, border: '1px solid #F5D78E', fontSize: 13, color: '#92400e', display: 'flex', gap: 10 }}>
                      ⚠️ {parsedData.duplicate_warning}
                    </div>
                  )}

                  {!parsedData.has_price && (
                    <div style={{ marginTop: 14, padding: '10px 14px', background: '#EAF3FB', borderRadius: 8, border: '1px solid #BFDCEF', fontSize: 13, color: '#1B4F78', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <InfoIcon />
                      Ce document ne contient pas de prix. Les prix sont pré-remplis depuis la base fournisseur (modifiables).
                    </div>
                  )}

                  <div style={{ marginTop: 14, padding: '10px 14px', background: parsedData.parse_mode === 'clean' ? '#F0FDF4' : '#FFF4E0', borderRadius: 8, border: `1px solid ${parsedData.parse_mode === 'clean' ? '#86EFAC' : '#F5D78E'}`, fontSize: 13, color: parsedData.parse_mode === 'clean' ? '#166534' : '#92400e', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {parsedData.parse_mode === 'clean' ? '✓ Parsé avec le cleaner' : '⚠️ Parsé de façon classique (cleaner inactif)'}
                  </div>
                </Card>

                {/* Barre : appliquer tous les derniers tarifs validés */}
                {(() => {
                  const nb = matchedItems.filter(i => lastVerified[i.product_id]).length;
                  if (nb === 0) return null;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginBottom: 12 }}>
                      <span style={{ fontSize: 12.5, color: C.grisF }}>
                        {nb} produit{nb > 1 ? 's' : ''} pré-rempli{nb > 1 ? 's' : ''} avec leur dernier tarif validé (prioritaire sur le prix du document)
                      </span>
                      <button
                        onClick={applyAllVerifiedPrices}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7,
                          background: '#FFF7E8', color: C.orangeDark, border: '1px solid #F3D9A6',
                          borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        Réappliquer tous les tarifs validés
                      </button>
                    </div>
                  );
                })()}

                {/* Lignes qui ne collent pas au montant facturé */}
                {mismatchedCount > 0 && (
                  <div style={{
                    marginBottom: 12, padding: '11px 14px', background: '#FDECEE',
                    border: '1px solid #F4C5CB', borderRadius: 8,
                    fontSize: 13, color: '#8E2233', display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ fontSize: 15 }}>⚠️</span>
                    <span>
                      <strong>{mismatchedCount} ligne{mismatchedCount > 1 ? 's' : ''}</strong> s'écarte
                      {mismatchedCount > 1 ? 'nt' : ''} d'un facteur du montant de la pro forma
                      (total <strong>{mismatchedTotal > 0 ? '+' : ''}{fmt(mismatchedTotal)} €</strong>) —
                      surlignée{mismatchedCount > 1 ? 's' : ''} en rouge ci-dessous.
                      Vérifiez la <strong>quantité</strong> (pack offre, conditionnement).
                      Les écarts de prix, eux, sont normaux : le tarif définitif vient de BMS.
                    </span>
                  </div>
                )}

                {/* Table des lignes */}
                <div style={{
                  background: C.blanc, borderRadius: 12,
                  border: `1px solid ${C.grisCL}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  marginBottom: 18,
                }}>
                  <div style={{ overflowX: 'auto', borderRadius: 12 }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 13.5, color: C.grisTF, width: '100%' }}>
                      <thead>
                        <tr>
                          <Th label="" width={24} />
                          <Th label="Image" width={64} align="center" />
                          <Th label="Ref fournisseur" width={160} />
                          <Th label="Désignation PDF" width={180} />
                          <Th label="Notre produit" width={210} />
                          <Th label="Stock" align="center" width={60} />
                          <Th label="Qte PDF" align="center" width={70} />
                          <Th label="Pack" align="center" width={52} />
                          <Th label="Qte finale" align="center" width={90} />
                          <Th label="Prix PDF" align="right" width={110} />
                          <Th label="Prix BDD" align="right" width={95} />
                          <Th label="Dernier tarif validé" align="right" width={130} />
                          <Th label="Remise %" align="center" width={90} />
                          <Th label="Total HT" align="right" width={105} />
                          <Th label="" width={40} />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, idx) => {
                          const cell = { padding: '12px 14px', borderTop: `1px solid ${C.grisCL}`, verticalAlign: 'middle' };

                          if (item.item_type === 'discount') {
                            return (
                              <tr key={idx} style={{ background: '#F5F5F5' }}>
                                <td style={cell}>
                                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: C.grisM }} />
                                </td>
                                <td style={{ ...cell, textAlign: 'center' }} />
                                <td colSpan={2} style={{ ...cell, color: C.grisM, fontStyle: 'italic' }}>—</td>
                                <td colSpan={8} style={{ ...cell, fontStyle: 'italic', color: C.grisTF }}>{item.product_name}</td>
                                <td style={{ ...cell, textAlign: 'right', fontWeight: 600, color: C.rouge }}>
                                  {item.unit_price != null ? item.unit_price.toFixed(2) + ' €' : '—'}
                                </td>
                                <td style={{ ...cell, textAlign: 'center' }}>
                                  <button onClick={() => handleRemoveItem(idx)} style={{ background: '#FBE8EA', color: '#C24555', border: '1px solid #F4C5CB', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                                </td>
                              </tr>
                            );
                          }

                          const lineTotal = lineTotalOf(item);
                          const mismatch = lineMismatch(item);

                          return (
                            <tr key={idx} style={{ background: mismatch ? '#FDECEE' : (item.matched ? C.blanc : '#FFFBEB') }}>
                              <td style={{ ...cell, textAlign: 'center' }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: item.matched ? '#2A8049' : C.orange }} />
                              </td>
                              <td style={{ ...cell, textAlign: 'center' }}>
                                {item.matched && item.image_url ? (
                                  <img
                                    src={item.image_url}
                                    alt={item.product_name}
                                    style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.grisTL }}
                                    onError={e => { e.currentTarget.style.display = 'none'; }}
                                  />
                                ) : (
                                  <div style={{ width: 44, height: 44, borderRadius: 6, background: C.grisTL, border: `1px solid ${C.grisCL}`, margin: '0 auto' }} />
                                )}
                              </td>
                              <td style={{ ...cell, fontWeight: 700, fontSize: 13, fontFamily: 'monospace' }}>{item.supplier_sku}</td>
                              <td style={{ ...cell, color: C.grisF, lineHeight: 1.4 }}>{item.designation}</td>

                              {/* Notre produit */}
                              <td style={{ ...cell, position: 'relative' }}>
                                {item.matched ? (
                                  <div>
                                    <div style={{ fontWeight: 600, color: C.grisTF, lineHeight: 1.3, marginBottom: 2 }}>{item.product_name}</div>
                                    {item.product_sku && <div style={{ fontSize: 11.5, color: C.grisM, fontFamily: 'monospace' }}>SKU: {item.product_sku}</div>}
                                    {item.ambiguous_match && (
                                      <div
                                        title={`Cette référence fournisseur est associée à plusieurs produits :\n${(item.match_candidates || '').split(' • ').join('\n')}\n\nLe produit en ligne a été retenu — vérifiez que c'est le bon.`}
                                        style={{ marginTop: 3, display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 5, padding: '1px 6px', cursor: 'help' }}
                                      >
                                        réf. partagée — à vérifier
                                      </div>
                                    )}
                                    <button onClick={() => handleRematch(idx)} style={{ marginTop: 4, fontSize: 12, color: C.bleu, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}>
                                      modifier
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{ position: 'relative' }}>
                                    <input
                                      type="text"
                                      placeholder="Rechercher…"
                                      value={searchingIdx === idx ? searchTerm : ''}
                                      onFocus={() => { setSearchingIdx(idx); setSearchTerm(''); setSearchResults([]); }}
                                      onChange={e => handleSearchProduct(e.target.value, idx)}
                                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.orange}`, fontSize: 13, background: '#FFFBEB', fontFamily: 'inherit', outline: 'none' }}
                                    />
                                    {(() => {
                                      const availableResults = searchResults.filter(p => !usedProductIds.has(p.id));
                                      return searchingIdx === idx && availableResults.length > 0 && (
                                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: '0 0 8px 8px', maxHeight: 240, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
                                        {availableResults.map(product => (
                                          <div key={product.id} onClick={() => handleMatchProduct(idx, product)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid ${C.grisTL}`, fontSize: 13 }}
                                            onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                                            onMouseLeave={e => e.currentTarget.style.background = C.blanc}
                                          >
                                            <div style={{ fontWeight: 600 }}>{product.post_title}</div>
                                            <div style={{ color: C.grisM, fontSize: 12 }}>SKU: {product.sku || '—'} | Stock: {product.stock ?? '—'}</div>
                                          </div>
                                        ))}
                                      </div>
                                      );
                                    })()}
                                    {searchingIdx === idx && searchLoading && (
                                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: C.blanc, padding: '8px 12px', fontSize: 13, color: C.grisM, border: `1px solid ${C.grisCL}` }}>Recherche…</div>
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* Stock */}
                              <td style={{ ...cell, textAlign: 'center', fontWeight: 600, color: item.matched && item.current_stock <= 0 ? C.rouge : C.grisTF }}>
                                {item.matched ? (item.current_stock ?? '—') : '—'}
                              </td>
                              {/* Qte PDF */}
                              <td style={{ ...cell, textAlign: 'center', color: C.grisF }}>{item.qty_from_pdf}</td>
                              {/* Pack */}
                              <td style={{ ...cell, textAlign: 'center', color: C.grisM }}>{item.pack_qty > 1 ? `×${item.pack_qty}` : '—'}</td>
                              {/* Qte finale */}
                              <td style={{ ...cell, textAlign: 'center' }}>
                                <NumInput value={item.qty_ordered} onChange={v => handleUpdateQty(idx, v)} width={60} />
                              </td>
                              {/* Prix PDF */}
                              <td style={{ ...cell, textAlign: 'right' }}>
                                <NumInput value={item.unit_price} step="0.01" onChange={v => handleUpdatePrice(idx, v)} width={72} suffix="€" placeholder="—" />
                              </td>
                              {/* Prix BDD */}
                              <td style={{ ...cell, textAlign: 'right', color: C.grisF, fontVariantNumeric: 'tabular-nums' }}>
                                {item.supplier_price != null ? item.supplier_price.toFixed(2) + ' €' : '—'}
                              </td>
                              {/* Dernier tarif validé */}
                              <td style={{ ...cell, textAlign: 'right' }}>
                                {(() => {
                                  const v = item.matched ? lastVerified[item.product_id] : null;
                                  if (!v) return <span style={{ color: C.grisM }}>—</span>;
                                  const applied = item.verifiedApplied && Math.abs((item.unit_price || 0) - v.unit_price) < 0.0001;
                                  const tip = `Commande ${v.bms_reference || ''}${v.order_date ? ' du ' + new Date(v.order_date).toLocaleDateString('fr-FR') : ''}`;
                                  return (
                                    <button
                                      onClick={() => applyVerifiedPrice(idx)}
                                      title={`Appliquer ce tarif — ${tip}`}
                                      style={{
                                        background: applied ? '#E7F5EC' : '#FFF7E8',
                                        color: applied ? '#2A8049' : C.orangeDark,
                                        border: `1px solid ${applied ? '#B5E0C3' : '#F3D9A6'}`,
                                        borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                                        fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                                        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {applied ? '✓ ' : ''}{v.unit_price.toFixed(2)} €
                                    </button>
                                  );
                                })()}
                              </td>
                              {/* Remise % */}
                              <td style={{ ...cell, textAlign: 'center' }}>
                                <NumInput value={item.discount || ''} step="0.1" onChange={v => handleUpdateDiscount(idx, v)} width={58} suffix="%" placeholder="0" />
                              </td>
                              {/* Total HT */}
                              <td style={{ ...cell, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: mismatch ? '#C24555' : C.grisTF }}>
                                {lineTotal != null ? fmt(lineTotal) + ' €' : '—'}
                                {mismatch && (
                                  <div
                                    title="Montant HT de cette ligne sur la pro forma"
                                    style={{ marginTop: 3, fontSize: 11.5, fontWeight: 700, color: '#8E2233', whiteSpace: 'nowrap' }}
                                  >
                                    pro forma {fmt(mismatch.invoice)} € ({mismatch.facteur})
                                  </div>
                                )}
                              </td>
                              {/* Supprimer */}
                              <td style={{ ...cell, textAlign: 'center' }}>
                                <button onClick={() => handleRemoveItem(idx)} style={{ background: '#FBE8EA', color: '#C24555', border: '1px solid #F4C5CB', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Totaux */}
                <Card>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 36, flexWrap: 'wrap', fontSize: 13.5, color: C.grisF }}>
                    {discountItems.length > 0 && (
                      <>
                        <div>
                          <span style={{ color: C.grisM, marginRight: 8 }}>Total HT brut :</span>
                          <strong style={{ fontSize: 15, color: C.grisTF, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalHtProduits)} €</strong>
                        </div>
                        <div>
                          <span style={{ color: C.grisM, marginRight: 8 }}>Total remises :</span>
                          <strong style={{ fontSize: 15, color: C.rouge, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalRemises)} €</strong>
                        </div>
                      </>
                    )}
                    <div>
                      <span style={{ color: C.grisM, marginRight: 8 }}>Total HT :</span>
                      <strong style={{ fontSize: 15, color: C.grisTF, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalHt)} €</strong>
                    </div>
                    <div>
                      <span style={{ color: C.grisM, marginRight: 8 }}>Total TTC (20%) :</span>
                      <strong style={{ fontSize: 15, color: C.orange, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalTtc)} €</strong>
                    </div>
                  </div>
                </Card>

                {/* Actions */}
                <Card>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 13, color: C.grisF }}>
                      <strong style={{ color: C.grisTF }}>{matchedItems.length}</strong> article{matchedItems.length > 1 ? 's' : ''} prêt{matchedItems.length > 1 ? 's' : ''}
                      <span style={{ color: C.grisCL, margin: '0 8px' }}>—</span>
                      <strong style={{ color: C.grisTF }}>{totalQty}</strong> unité{totalQty > 1 ? 's' : ''}
                      {productItems.filter(i => !i.matched).length > 0 && (
                        <span style={{ color: C.orange, marginLeft: 10, fontSize: 12.5 }}>
                          ({productItems.filter(i => !i.matched).length} ligne{productItems.filter(i => !i.matched).length > 1 ? 's' : ''} non matchée{productItems.filter(i => !i.matched).length > 1 ? 's' : ''} ignorée{productItems.filter(i => !i.matched).length > 1 ? 's' : ''})
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={() => handleCreateOrder(false)}
                        disabled={creating || matchedItems.length === 0}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7,
                          background: creating || matchedItems.length === 0 ? C.grisCL : `linear-gradient(155deg, ${C.orangeGrad}, ${C.orangeDark})`,
                          color: '#fff', border: 'none', borderRadius: 8,
                          padding: '10px 18px', fontSize: 13.5, fontWeight: 800,
                          cursor: creating || matchedItems.length === 0 ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                          boxShadow: creating || matchedItems.length === 0 ? 'none' : '0 4px 12px rgba(245,158,11,0.4)',
                          opacity: creating || matchedItems.length === 0 ? 0.7 : 1,
                        }}
                      >
                        {creating ? 'Création…' : 'Créer la commande'}
                      </button>
                      <button
                        onClick={() => handleCreateOrder(true)}
                        disabled={creating || matchedItems.length === 0}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7,
                          background: creating || matchedItems.length === 0 ? C.grisCL : 'linear-gradient(155deg, #7C68F0, #5D49D6)',
                          color: '#fff', border: 'none', borderRadius: 8,
                          padding: '10px 18px', fontSize: 13.5, fontWeight: 800,
                          cursor: creating || matchedItems.length === 0 ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                          boxShadow: creating || matchedItems.length === 0 ? 'none' : '0 4px 12px rgba(110,90,230,0.4)',
                          opacity: creating || matchedItems.length === 0 ? 0.7 : 1,
                        }}
                      >
                        {creating ? 'Création…' : 'Créer + Envoyer BMS'}
                      </button>
                    </div>
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
};

export default ImportPdfPage;
