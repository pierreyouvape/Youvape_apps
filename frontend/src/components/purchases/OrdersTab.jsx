import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatDate } from '../../utils/dateUtils';
import { formatPrice, formatInt } from '../../utils/formatNumber';
import { LinkBox } from '../../utils/navHelpers';
import { brandLabel } from '../../utils/productBrand';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

// Les trois motifs de manquant, tels que le magasinier les choisit à la
// réception. Écrits en clair : « soldé » seul ne dit pas que le fournisseur
// nous a déjà remboursés, et c'est toute la différence avec « manquant ».
const MOTIF_LABEL = {
  reliquat: 'Reliquat — à recevoir',
  solde:    'Soldé — remboursé par le fournisseur',
  manquant: 'Manquant — à réclamer',
};

// Un avoir ou une proforma rattachés à la commande ne sont pas « la facture » :
// on le dit devant le numéro.
const DOC_TYPE_PREFIX = { credit_note: 'Avoir ', proforma: 'Proforma ' };

const PAYMENT_METHOD_LABEL = {
  amex: 'Amex', cb: 'CB', virement: 'Virement', prelevement: 'Prélèvement',
  cheque: 'Chèque', especes: 'Espèces', avoir: 'Avoir', autre: 'Autre',
};

// Où en est le règlement d'un document. Déduit des affectations côté backend
// (vue supplier_document_balances) : le mode imprimé sur la facture n'y compte
// pour rien.
const PaymentCell = ({ doc }) => {
  const methods = (doc.methods || []).map(m => PAYMENT_METHOD_LABEL[m] || m).join(', ');
  if (doc.payment_status === 'paid') {
    return (
      <span style={{ color: '#16a34a', fontWeight: 600 }}>
        Réglée {formatDate(doc.paid_at)}{methods ? ` · ${methods}` : ''}
      </span>
    );
  }
  if (doc.doc_type === 'proforma') return <span style={{ color: '#9ca3af' }}>-</span>;
  if (doc.payment_status === 'unknown') return <span style={{ color: '#9ca3af' }}>Montant inconnu</span>;
  const overdue = doc.effective_due_date && doc.effective_due_date.slice(0, 10) < new Date().toLocaleDateString('sv-SE');
  return (
    <span
      style={{ color: overdue ? '#dc2626' : '#ea580c', fontWeight: 600 }}
      title={doc.effective_due_date ? `Échéance : ${formatDate(doc.effective_due_date)}` : undefined}
    >
      {doc.payment_status === 'partial' ? 'Partielle' : 'À régler'}
      {' · '}{formatPrice(doc.remaining_amount)} €
      {doc.effective_due_date && ` · éch. ${formatDate(doc.effective_due_date)}`}
    </span>
  );
};

const OrdersTab = ({ token }) => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Mode édition
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState(null);
  // Rematch inline d'un item existant
  const [rematchItemId, setRematchItemId] = useState(null); // id ou ref unique de l'item en cours de rematch
  const [rematchSearch, setRematchSearch] = useState('');
  const [rematchResults, setRematchResults] = useState([]);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [rematchTimeout, setRematchTimeout] = useState(null);

  // Filters
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimeoutRef = useRef(null);

  const handleSearchChange = (value) => {
    setSearchInput(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setSearchQuery(value.trim()), 300);
  };

  // BMS sync commandes
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    axios.get(`${API_URL}/purchases/orders/bms-sync-info`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => {
      setLastSync(r.data.data?.last_sync_at);
    }).catch(() => {});
  }, [token]);

  const statusLabels = {
    draft: 'Brouillon',
    sent: 'Envoyée',
    confirmed: 'Attendu',
    shipped: 'Expédiée',
    partial: 'Partielle',
    received: 'Reçue',
    completed: 'Terminée',
    cancelled: 'Annulée'
  };

  // Load suppliers
  useEffect(() => {
    const loadSuppliers = async () => {
      try {
        const response = await axios.get(`${API_URL}/purchases/suppliers`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSuppliers(response.data.data || []);
      } catch (err) {
        console.error('Erreur chargement fournisseurs:', err);
      }
    };
    loadSuppliers();
  }, [token]);

  // Load orders
  const loadOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSupplier) params.append('supplier_id', filterSupplier);
      if (filterStatus === 'active') {
        params.append('exclude_status', 'received,completed,cancelled');
      } else if (filterStatus) {
        params.append('status', filterStatus);
      }
      if (searchQuery) params.append('search', searchQuery);

      const response = await axios.get(`${API_URL}/purchases/orders?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(response.data.data || []);
    } catch (err) {
      console.error('Erreur chargement commandes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [token, filterSupplier, filterStatus, searchQuery]);

  // Open detail modal
  const openDetail = async (orderId) => {
    try {
      const response = await axios.get(`${API_URL}/purchases/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedOrder(response.data.data);
      setShowDetailModal(true);
    } catch (err) {
      console.error('Erreur chargement détail:', err);
    }
  };

  // Update order status
  const updateStatus = async (orderId, newStatus) => {
    try {
      await axios.put(`${API_URL}/purchases/orders/${orderId}/status`, {
        status: newStatus
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadOrders();
      if (selectedOrder?.id === orderId) {
        openDetail(orderId);
      }
    } catch (err) {
      console.error('Erreur mise à jour statut:', err);
      alert('Erreur lors de la mise à jour du statut');
    }
  };

  // Delete order
  const deleteOrder = async (orderId) => {
    if (!confirm('Supprimer cette commande ?\n\nAttention : elle ne sera supprimée que de l\'app, pas de BMS.')) return;

    try {
      await axios.delete(`${API_URL}/purchases/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadOrders();
      setShowDetailModal(false);
    } catch (err) {
      console.error('Erreur suppression:', err);
      alert(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  };

  // Envoyer a BMS
  const [sendingBms, setSendingBms] = useState(false);
  // flags : drapeaux d'envoi forcé décidés par l'utilisateur après un refus BMS
  // « décidable » (skip_missing, ignore_total_mismatch) — cf. bmsRetryFlags côté API.
  const sendToBms = async (orderId, flags = null) => {
    if (!flags && !confirm('Envoyer cette commande à BMS ?')) return;
    setSendingBms(true);
    let retryFlags = null;
    try {
      const response = await axios.post(
        `${API_URL}/purchases/orders/${orderId}/send-bms`,
        flags || {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const skipped = response.data.skipped_items || [];
      alert(skipped.length
        ? `Commande envoyée à BMS sans ${skipped.length} produit(s) absent(s) du catalogue BMS :\n` +
          skipped.map(p => `  • ${p.name} (${p.sku})`).join('\n') +
          `\n\nCes produits ne sont PAS dans le bon de commande BMS (une note a été ajoutée à la commande) : créez-les dans BMS puis ajoutez-les au bon de commande.`
        : 'Commande envoyée à BMS avec succès');
      setSelectedOrder(response.data.data);
      loadOrders();
    } catch (err) {
      console.error('Erreur envoi BMS:', err);
      const data = err.response?.data;
      // Refus décidable (produits pas encore créés dans BMS, écart avec le total du
      // document fournisseur) : laisser l'utilisateur envoyer la commande en l'état
      // plutôt que de bloquer.
      if (data?.retry_flags && data.can_send_anyway) {
        const label = data.code === 'BMS_MISSING_PRODUCTS'
          ? `sans ${(data.missing_skus || []).length > 1 ? 'ces produits' : 'ce produit'}`
          : 'en l\'état';
        if (confirm(`${data.error}\n\nEnvoyer quand même la commande à BMS ${label} ?`)) {
          retryFlags = { ...(flags || {}), ...data.retry_flags };
        }
      } else {
        alert(data?.error || 'Erreur lors de l\'envoi à BMS');
      }
    } finally {
      setSendingBms(false);
    }
    if (retryFlags) return sendToBms(orderId, retryFlags);
  };

  // Export CSV
  const exportOrder = async (orderId, format) => {
    try {
      const response = await axios.get(`${API_URL}/purchases/orders/${orderId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${format}_PO-${orderId}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Erreur export:', err);
      let message = 'Erreur lors de l\'export';
      try {
        if (err.response?.data instanceof Blob) {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          message = json.error || message;
        }
      } catch {}
      alert(message);
    }
  };

  // Sync BMS orders
  const syncBMS = async () => {
    if (!confirm(`Synchroniser les commandes BMS depuis le ${lastSync ? new Date(lastSync).toLocaleString('fr-FR') : 'début'} ?`)) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const response = await axios.post(`${API_URL}/purchases/orders/sync-bms`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = response.data.data;
      setSyncResult(result);
      setLastSync(new Date().toISOString());
      loadOrders();
    } catch (err) {
      console.error('Erreur sync BMS:', err);
      alert(err.response?.data?.error || 'Erreur lors de la synchronisation BMS');
    } finally {
      setSyncing(false);
    }
  };

  // ---- Mode édition ----
  const enterEditMode = () => {
    setEditData({
      supplier_id: selectedOrder.supplier_id,
      order_date: selectedOrder.order_date ? selectedOrder.order_date.slice(0, 10) : '',
      expected_date: selectedOrder.expected_date ? selectedOrder.expected_date.slice(0, 10) : '',
      supplier_reference: selectedOrder.bms_supplier_reference || '',
      items: (selectedOrder.items || []).map((item, idx) => ({ ...item, _delete: false, _tmpId: item.id || `tmp-${idx}` }))
    });
    setEditMode(true);
    setProductSearch('');
    setSearchResults([]);
  };

  const cancelEditMode = () => {
    setEditMode(false);
    setEditData(null);
    setProductSearch('');
    setSearchResults([]);
  };

  const saveEdit = async () => {
    setSavingEdit(true);
    try {
      const payload = {
        supplier_id: parseInt(editData.supplier_id),
        order_date: editData.order_date || null,
        expected_date: editData.expected_date || null,
        // `notes` n'est plus envoyé : le champ ne servait à personne et la
        // colonne reste alimentée par la synchro BMS (private_comments). Ne pas
        // l'envoyer, c'est ne pas l'écraser.
        supplier_reference: editData.supplier_reference,
        items: editData.items.map(item => ({
          id: item.id || undefined,
          product_id: item.product_id,
          product_name: item.product_name,
          supplier_sku: item.supplier_sku || null,
          qty_ordered: parseInt(item.qty_ordered) || 1,
          unit_price: item.unit_price !== '' && item.unit_price !== null ? parseFloat(item.unit_price) : null,
          _delete: item._delete || false
        }))
      };
      const response = await axios.put(`${API_URL}/purchases/orders/${selectedOrder.id}`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedOrder(response.data.data);
      setEditMode(false);
      setEditData(null);
      loadOrders();
    } catch (err) {
      console.error('Erreur sauvegarde:', err);
      alert(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleProductSearch = (value) => {
    setProductSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    if (value.length < 2) { setSearchResults([]); return; }
    setSearchTimeout(setTimeout(async () => {
      setSearchLoading(true);
      try {
        const existingIds = editData.items.filter(i => !i._delete && !i.id).map(i => i.product_id);
        const supplierParam = editData.supplier_id ? `&supplier_id=${editData.supplier_id}` : '';
        const response = await axios.get(`${API_URL}/purchases/products/search?q=${encodeURIComponent(value)}&limit=20${supplierParam}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSearchResults((response.data.data || []).filter(p => !existingIds.includes(p.id)));
      } catch (err) {
        console.error('Erreur recherche:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 300));
  };

  const addProductToEdit = (product) => {
    setEditData(prev => ({
      ...prev,
      items: [...prev.items, {
        product_id: product.id,
        product_name: product.post_title,
        product_sku: product.sku || null,
        product_type: product.product_type || null,
        supplier_sku: product.sku || null,
        qty_ordered: 1,
        unit_price: product.cost_price || null,
        qty_received: 0,
        _delete: false,
        _tmpId: `new-${Date.now()}`
      }]
    }));
    setProductSearch('');
    setSearchResults([]);
  };

  const handleRematchSearch = (value) => {
    setRematchSearch(value);
    if (rematchTimeout) clearTimeout(rematchTimeout);
    if (value.length < 2) { setRematchResults([]); return; }
    setRematchTimeout(setTimeout(async () => {
      setRematchLoading(true);
      try {
        const supplierParam = editData?.supplier_id ? `&supplier_id=${editData.supplier_id}` : '';
        const response = await axios.get(`${API_URL}/purchases/products/search?q=${encodeURIComponent(value)}&limit=20${supplierParam}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setRematchResults(response.data.data || []);
      } catch (err) {
        console.error('Erreur rematch search:', err);
      } finally {
        setRematchLoading(false);
      }
    }, 300));
  };

  const applyRematch = (product) => {
    setEditData(prev => ({
      ...prev,
      items: prev.items.map(i => {
        const key = i.id || i._tmpId;
        if (key !== rematchItemId) return i;
        return {
          ...i,
          product_id: product.id,
          product_name: product.post_title,
          product_sku: product.sku || null,
          product_type: product.product_type || null,
          current_stock: product.stock ?? null,
        };
      })
    }));
    setRematchItemId(null);
    setRematchSearch('');
    setRematchResults([]);
  };

  // Update received qty
  const updateReceivedQty = async (orderId, itemId, qty) => {
    try {
      await axios.put(`${API_URL}/purchases/orders/${orderId}/items/${itemId}/received`, {
        qty_received: qty
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      openDetail(orderId);
      loadOrders();
    } catch (err) {
      console.error('Erreur mise à jour réception:', err);
    }
  };

  // Badge produit manquant : uniquement pour received/partial
  const hasMissingProducts = (order) =>
    ['received', 'partial', 'completed'].includes(order.status) &&
    parseInt(order.total_qty_received) < parseInt(order.total_qty_ordered);

  // Tout est reçu ? En PIÈCES, la seule unité tenue de bout en bout : une ligne
  // comptée en packs a `qty_ordered` en lots, et la comparer à `units_received`
  // dirait qu'un pack de 10 reçu en entier manque encore de 9.
  const toutEstRecu = (order) => {
    const lignes = (order?.items || []).filter(it => it.item_type !== 'discount');
    if (lignes.length === 0) return false;
    return !lignes.some(it =>
      (parseInt(it.qty_ordered, 10) || 0) * (parseInt(it.units_per_qty, 10) || 1)
        > (parseInt(it.units_received, 10) || 0));
  };

  const hasMissingProductsDetail = (order) => {
    if (!order?.items) return false;
    return order.items.some(item => (item.qty_received || 0) < (item.qty_ordered || 0));
  };

  // Tri des colonnes
  const [sortKey, setSortKey] = useState('order_date');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedOrders = [...orders].sort((a, b) => {
    let va = a[sortKey];
    let vb = b[sortKey];
    // Numériques
    if (['total_items', 'total_qty', 'total_amount', 'total_qty_ordered', 'total_qty_received'].includes(sortKey)) {
      va = parseFloat(va) || 0;
      vb = parseFloat(vb) || 0;
    } else {
      va = (va || '').toString().toLowerCase();
      vb = (vb || '').toString().toLowerCase();
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const SortTh = ({ col, label, className }) => (
    <th
      className={className}
      onClick={() => handleSort(col)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label} {sortDir === 'asc' && sortKey === col ? '▲' : '▼'}
    </th>
  );


  return (
    <div className="orders-tab">
      <div className="purchases-card">
        {/* Filters */}
        <div className="filters-bar" style={{ marginBottom: '20px' }}>
          <div className="filter-group">
            <label>Fournisseur</label>
            <select
              value={filterSupplier}
              onChange={e => setFilterSupplier(e.target.value)}
            >
              <option value="">Tous</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Statut</label>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
            >
              <option value="active">Actives (hors reçues)</option>
              <option value="">Toutes</option>
              <option value="draft">Brouillon</option>
              <option value="confirmed">Attendu</option>
              <option value="partial">Partielle</option>
              <option value="received">Reçue</option>
              <option value="completed">Terminée</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Rechercher</label>
            <input
              type="text"
              placeholder="N° de commande ou référence..."
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              style={{
                padding: '6px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '13px',
                width: '220px'
              }}
            />
          </div>

          <button
            className="btn btn-secondary"
            onClick={loadOrders}
            style={{ marginLeft: 'auto' }}
          >
            🔄 Actualiser
          </button>
          <button
            className="btn btn-secondary"
            onClick={syncBMS}
            disabled={syncing}
            title={lastSync ? `Dernier import : ${new Date(lastSync).toLocaleString('fr-FR')}` : 'Aucun import précédent'}
          >
            {syncing ? 'Synchronisation...' : '⬇ Sync commandes BMS'}
          </button>
          <LinkBox
            to="/purchases/import-pdf"
            display="inline-block"
            className="btn btn-secondary"
          >
            Import PDF
          </LinkBox>
          <LinkBox
            to="/purchases/create-order"
            display="inline-block"
            className="btn btn-primary"
          >
            + Créer une commande
          </LinkBox>
        </div>

        {syncResult && (
          <div className="alert alert-success" style={{ marginBottom: '16px' }}>
            Sync commandes — {syncResult.created} créée(s), {syncResult.updated} mise(s) à jour, {syncResult.skipped} ignorée(s) (fournisseur inconnu)
            <button
              onClick={() => setSyncResult(null)}
              style={{ marginLeft: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
            >✕</button>
          </div>
        )}

        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <p>Aucune commande</p>
            <LinkBox to="/purchases/create-order" display="inline-block" className="btn btn-primary">
              + Créer une commande
            </LinkBox>
          </div>
        ) : (
          <table className="purchases-table purchases-table--striped">
            <thead>
              <tr>
                <SortTh col="bms_reference" label="N° Commande" />
                {/* La réf libre de BMS, juste après le numéro comme là-bas : elle
                    porte ce que le numéro ne dit pas (« Précommande JNr 50ml »). */}
                <SortTh col="bms_supplier_reference" label="Réf fournisseur" />
                <SortTh col="supplier_name" label="Fournisseur" />
                <SortTh col="total_items" label="Articles" className="text-center" />
                <SortTh col="total_qty" label="Quantité" className="text-center" />
                {/* « TTC » en toutes lettres : un montant sans son régime se lit
                    de travers, et l'écart est de 20 %. C'est le montant de BMS,
                    donc au taux réel du fournisseur — 0 % pour ceux qui n'en
                    portent pas. */}
                <SortTh col="total_amount" label="Montant TTC" className="text-right" />
                <SortTh col="status" label="Statut" className="text-center" />
                <SortTh col="order_date" label="Date commande" />
                <SortTh col="received_date" label="Date réception" />
                <th>Facture</th>
                <th>Règlement</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedOrders.map(order => (
                <tr key={order.id}>
                  <td>
                    <strong style={{ color: '#f59e0b', cursor: 'pointer' }} onClick={() => openDetail(order.id)}>
                      {order.bms_reference || order.order_number}
                    </strong>
                  </td>
                  <td style={{ color: order.bms_supplier_reference ? undefined : '#9ca3af' }}>
                    {order.bms_supplier_reference || '-'}
                  </td>
                  <td>{order.supplier_name}</td>
                  <td className="text-center">{formatInt(order.total_items)}</td>
                  <td className="text-center">{formatInt(order.total_qty)}</td>
                  {/* Tant que la commande n'est pas dans BMS, nous n'avons que
                      notre total HT : on le dit plutôt que de le ranger sous un
                      en-tête TTC. */}
                  <td className="text-right">
                    {order.total_amount > 0
                      ? `${formatPrice(order.total_amount)} €${order.bms_po_id ? '' : ' HT'}`
                      : '-'}
                  </td>
                  <td className="text-center">
                    <span className={`status-badge status-${order.status}`}>
                      {statusLabels[order.status]}
                    </span>
                    {/* UNE COMMANDE QUI N'EST PAS DANS BMS NE VIT QUE CHEZ NOUS.
                        Le fournisseur ne l'a pas reçue, et la réception ne pourra
                        rien enregistrer : elle a besoin de l'identifiant du bon
                        BMS. Rien ne la distinguait des autres — même statut, même
                        couleur — alors qu'un envoi refusé (un produit pas encore
                        créé dans BMS, par exemple) la laisse précisément là. */}
                    {!order.bms_po_id && order.status !== 'draft' && order.status !== 'cancelled' && (
                      <span
                        className="badge-no-bms"
                        title="Cette commande n'a jamais été créée dans BMS : le fournisseur ne l'a pas reçue, et elle ne peut pas être réceptionnée. Ouvrez-la et utilisez « Envoyer à BMS »."
                      >
                        ⚠ Pas dans BMS
                      </span>
                    )}
                    {hasMissingProducts(order) && (
                      <span
                        className="badge-missing"
                        title={`Reçu : ${order.total_qty_received} / ${order.total_qty_ordered}`}
                      >
                        ⚠ Manquant
                      </span>
                    )}
                  </td>
                  <td>{formatDate(order.order_date)}</td>
                  <td>{formatDate(order.received_date)}</td>
                  {/* Une ligne par document, dans les deux colonnes : une commande
                      facturée en deux fois a deux règlements à suivre. */}
                  <td>
                    {order.documents?.length > 0 ? order.documents.map(d => (
                      <div key={d.id} style={{ whiteSpace: 'nowrap' }}>
                        <LinkBox
                          to={`/factures-fournisseurs?doc=${d.id}`}
                          display="inline"
                          style={{ color: '#f59e0b', fontWeight: 600 }}
                          title="Ouvrir la facture"
                        >
                          {DOC_TYPE_PREFIX[d.doc_type] || ''}{d.number}
                        </LinkBox>
                      </div>
                    )) : <span style={{ color: '#9ca3af' }}>-</span>}
                  </td>
                  <td>
                    {order.documents?.length > 0 ? order.documents.map(d => (
                      <div key={d.id} style={{ whiteSpace: 'nowrap' }}>
                        <PaymentCell doc={d} />
                      </div>
                    )) : <span style={{ color: '#9ca3af' }}>-</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => openDetail(order.id)}
                        title="Détail"
                      >
                        👁️
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => exportOrder(order.id, 'supplier')}
                        title="Export fournisseur"
                      >
                        📄
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Modal */}
      {showDetailModal && selectedOrder && (
        <div className="modal-overlay" onClick={() => { if (!editMode) setShowDetailModal(false); }}>
          <div className="modal-content" style={{ maxWidth: '900px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                Commande {selectedOrder.bms_reference || selectedOrder.order_number}
                {editMode && <span style={{ marginLeft: '10px', fontSize: '14px', color: '#f59e0b', fontWeight: 400 }}>— Mode édition</span>}
              </h3>
              <button className="modal-close" onClick={() => { cancelEditMode(); setShowDetailModal(false); }}>×</button>
            </div>
            <div className="modal-body">

              {/* ===== MODE LECTURE ===== */}
              {!editMode && (
                <>
                  {/* Order info */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                    <div>
                      <strong>Fournisseur</strong>
                      <div>{selectedOrder.supplier_name}</div>
                    </div>
                    <div>
                      <strong>Statut</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={`status-badge status-${selectedOrder.status}`}>
                          {statusLabels[selectedOrder.status]}
                        </span>
                        {hasMissingProductsDetail(selectedOrder) && (
                          <span className="badge-missing">⚠ Produit(s) manquant(s)</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <strong>Date commande</strong>
                      <div>{formatDate(selectedOrder.order_date)}</div>
                    </div>
                  </div>

                  {/* Status actions */}
                  <div style={{ marginBottom: '20px', padding: '10px', background: '#f8f9fa', borderRadius: '6px' }}>
                    <strong style={{ marginRight: '15px' }}>Changer le statut :</strong>
                    {selectedOrder.status === 'draft' && (
                      <button className="btn btn-sm btn-primary" onClick={() => updateStatus(selectedOrder.id, 'sent')}>
                        📤 Marquer envoyée
                      </button>
                    )}
                    {selectedOrder.status === 'sent' && (
                      <>
                        <button className="btn btn-sm btn-success" onClick={() => updateStatus(selectedOrder.id, 'confirmed')}>
                          ✓ Confirmée
                        </button>
                        <button className="btn btn-sm btn-secondary" style={{ marginLeft: '10px' }} onClick={() => updateStatus(selectedOrder.id, 'cancelled')}>
                          ✗ Annuler
                        </button>
                      </>
                    )}
                    {selectedOrder.status === 'confirmed' && (
                      <button className="btn btn-sm btn-primary" onClick={() => updateStatus(selectedOrder.id, 'shipped')}>
                        🚚 Expédiée
                      </button>
                    )}
                    {(selectedOrder.status === 'shipped' || selectedOrder.status === 'partial') && (
                      <button className="btn btn-sm btn-success" onClick={() => updateStatus(selectedOrder.id, 'received')}>
                        ✓ Tout reçu
                      </button>
                    )}
                  </div>

                  {/* Réceptions — qui a compté, quand, et ce qui manquait.
                      Le motif d'un manquant était enregistré et lisible nulle
                      part : c'est ici qu'il sert, là où l'acheteur regarde sa
                      commande, et pas dans une boîte mail. */}
                  {selectedOrder.receptions?.length > 0 && (
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={{ marginBottom: '10px' }}>
                        Réceptions ({selectedOrder.receptions.length})
                      </h4>
                      {selectedOrder.receptions.map(r => (
                        <div key={r.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px',
                          padding: '12px 14px', marginBottom: '10px', background: '#fff' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px',
                            alignItems: 'baseline', fontSize: '13.5px' }}>
                            <strong>
                              {r.status === 'validated' ? '✓ Validée' :
                               r.status === 'counting'  ? '⏳ Comptage en cours' : '✗ Abandonnée'}
                            </strong>
                            <span style={{ color: '#6b7280' }}>
                              {r.validated_at ? formatDate(r.validated_at) : formatDate(r.started_at)}
                              {' — par '}{r.validee_par || r.ouverte_par || 'inconnu'}
                            </span>
                            <span style={{ marginLeft: 'auto', fontWeight: 600 }}>
                              {r.total_envoye} pièce{r.total_envoye > 1 ? 's' : ''} en stock
                              {r.total_compte !== r.total_envoye && (
                                <span style={{ color: '#dc2626', fontWeight: 600 }}>
                                  {' '}/ {r.total_compte} comptée{r.total_compte > 1 ? 's' : ''}
                                </span>
                              )}
                            </span>
                          </div>

                          {r.refuses?.length > 0 && (
                            <div style={{ marginTop: '10px', padding: '9px 12px', borderRadius: '6px',
                              background: '#fef2f2', border: '1px solid #fecaca', fontSize: '13px' }}>
                              <strong style={{ color: '#991b1b' }}>Refusé par BMS — pas en stock :</strong>
                              <ul style={{ margin: '5px 0 0', paddingLeft: '18px' }}>
                                {r.refuses.map((x, i) => (
                                  <li key={i}>
                                    {x.ref || x.product} — {x.envoyees} sur {x.comptees} comptées,
                                    <strong> {x.refusees} refusée{x.refusees > 1 ? 's' : ''}</strong>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {r.manquants?.length > 0 && (
                            <table className="purchases-table" style={{ marginTop: '10px' }}>
                              <thead>
                                <tr>
                                  <th>Manquant</th>
                                  <th>Réf.</th>
                                  <th className="text-right">Attendu</th>
                                  <th className="text-right">Reçu</th>
                                  <th className="text-right">Manque</th>
                                  <th>Motif</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.manquants.map((x, i) => (
                                  <tr key={i}>
                                    <td style={{ maxWidth: '280px' }}>{x.product}</td>
                                    <td>{x.ref || '—'}</td>
                                    <td className="text-right">{x.expected}</td>
                                    <td className="text-right">{x.units}</td>
                                    <td className="text-right" style={{ color: '#ea580c', fontWeight: 600 }}>
                                      {x.manque}
                                    </td>
                                    <td>{MOTIF_LABEL[x.motif] || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}

                          {r.surplus?.length > 0 && (
                            <div style={{ marginTop: '8px', fontSize: '13px', color: '#7c2d12' }}>
                              <strong>Reçu en trop :</strong>{' '}
                              {r.surplus.map(x => `${x.ref || x.product} (+${x.enTrop})`).join(', ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Items */}
                  <h4 style={{ marginBottom: '10px' }}>Articles ({selectedOrder.items?.length || 0})</h4>
                  <table className="purchases-table">
                    <thead>
                      <tr>
                        <th>Produit</th>
                        <th>Réf.</th>
                        <th className="text-right">Commandé</th>
                        <th className="text-right">Par pack</th>
                        <th className="text-right">Total unités</th>
                        <th className="text-right">Reçu</th>
                        <th className="text-right">Prix unit.</th>
                        <th className="text-right">Total HT</th>
                        <th>Stock avant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.items?.map(item => {
                        if (item.item_type === 'discount') {
                          return (
                            <tr key={item.id} style={{ background: '#f3f4f6' }}>
                              <td style={{ maxWidth: '300px', fontStyle: 'italic', color: '#6b7280' }} colSpan={6}>
                                {item.product_name}
                              </td>
                              <td className="text-right">—</td>
                              <td className="text-right" style={{ color: '#dc2626', fontWeight: 600 }}>
                                {item.unit_price != null ? `${formatPrice(item.unit_price)} €` : '-'}
                              </td>
                              <td>—</td>
                            </tr>
                          );
                        }
                        const missing = (item.qty_received || 0) < (item.qty_ordered || 0);
                        return (
                          <tr key={item.id} style={missing ? { background: '#fff7ed' } : {}}>
                            <td style={{ maxWidth: '300px' }}>
                              {item.product_name}
                              {missing && (
                                <span className="badge-missing" style={{ marginLeft: '6px' }}>
                                  ⚠ {item.qty_ordered - item.qty_received} manquant(s)
                                </span>
                              )}
                            </td>
                            <td><code>{item.supplier_sku || item.product_sku || '-'}</code></td>
                            <td className="text-right">{formatInt(item.qty_ordered)}</td>
                            {/* Décomposition en colonnes : commandé × par pack = total
                                unités. Permet de vérifier d'un coup d'œil qu'une ligne
                                comptée en packs entre bien au bon volume en stock. */}
                            <td className="text-right" style={{ color: (item.units_per_qty || 1) > 1 ? '#E28F00' : '#9ca3af' }}>
                              {(item.units_per_qty || 1) > 1 ? `× ${item.units_per_qty}` : '—'}
                            </td>
                            <td className="text-right" style={{ fontWeight: 600 }}>
                              {formatInt(item.qty_ordered * (item.units_per_qty || 1))}
                            </td>
                            <td className="text-right">
                              {['shipped', 'partial'].includes(selectedOrder.status) ? (
                                <input
                                  type="number"
                                  className="qty-input"
                                  min="0"
                                  max={item.qty_ordered}
                                  value={item.qty_received}
                                  onChange={e => updateReceivedQty(selectedOrder.id, item.id, parseInt(e.target.value) || 0)}
                                />
                              ) : (
                                item.qty_received
                              )}
                            </td>
                            <td className="text-right">
                              {item.unit_price ? `${formatPrice(item.unit_price)} €` : '-'}
                            </td>
                            <td className="text-right">
                              {item.unit_price && item.qty_ordered
                                ? `${formatPrice(item.qty_ordered * item.unit_price)} €`
                                : '-'}
                            </td>
                            <td>{item.stock_before ?? '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Totaux */}
                  {(() => {
                    const allItems = selectedOrder.items || [];
                    const productItems = allItems.filter(i => i.item_type !== 'discount');
                    const discountItems = allItems.filter(i => i.item_type === 'discount');
                    const totalHtProduits = productItems.reduce((sum, i) =>
                      sum + (i.unit_price ? i.qty_ordered * i.unit_price : 0), 0);
                    const totalRemises = discountItems.reduce((sum, i) => sum + (parseFloat(i.unit_price) || 0), 0);
                    const totalHt = totalHtProduits + totalRemises;
                    return totalHtProduits > 0 ? (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '30px', marginTop: '12px', fontSize: '14px' }}>
                        {totalRemises < 0 && (
                          <>
                            <div>
                              <span style={{ color: '#666' }}>Total HT brut : </span>
                              <strong>{formatPrice(totalHtProduits)} €</strong>
                            </div>
                            <div>
                              <span style={{ color: '#666' }}>Total remises : </span>
                              <strong style={{ color: '#dc2626' }}>{formatPrice(totalRemises)} €</strong>
                            </div>
                          </>
                        )}
                        <div>
                          <span style={{ color: '#666' }}>Total HT : </span>
                          <strong>{formatPrice(totalHt)} €</strong>
                        </div>
                        <div>
                          <span style={{ color: '#666' }}>Total TTC (20%) : </span>
                          <strong>{formatPrice(totalHt * 1.2)} €</strong>
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* La réf libre, en lecture : on ne doit pas avoir à passer en
                      édition pour voir ce qu'on pourra y modifier. */}
                  {selectedOrder.bms_supplier_reference && (
                    <div style={{ marginTop: '20px', padding: '10px', background: '#eff6ff', borderRadius: '6px' }}>
                      <strong>Réf fournisseur :</strong> {selectedOrder.bms_supplier_reference}
                    </div>
                  )}

                  {/* Notes */}
                  {selectedOrder.notes && (
                    <div style={{ marginTop: '20px', padding: '10px', background: '#fef3c7', borderRadius: '6px' }}>
                      <strong>Notes :</strong> {selectedOrder.notes}
                    </div>
                  )}
                </>
              )}

              {/* ===== MODE ÉDITION ===== */}
              {editMode && editData && (
                <>
                  {/* Champs généraux */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                    <div>
                      <label style={{ display: 'block', fontWeight: 500, marginBottom: '4px' }}>Fournisseur</label>
                      <select
                        value={editData.supplier_id}
                        onChange={e => setEditData(prev => ({ ...prev, supplier_id: e.target.value }))}
                        style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: '4px' }}
                      >
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontWeight: 500, marginBottom: '4px' }}>Date commande</label>
                      <input
                        type="date"
                        value={editData.order_date}
                        onChange={e => setEditData(prev => ({ ...prev, order_date: e.target.value }))}
                        style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: '4px' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontWeight: 500, marginBottom: '4px' }}>Date livraison prévue</label>
                      <input
                        type="date"
                        value={editData.expected_date}
                        onChange={e => setEditData(prev => ({ ...prev, expected_date: e.target.value }))}
                        style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: '4px' }}
                      />
                    </div>
                  </div>
                  {/* La réf libre de BMS, à la place des Notes : celles-ci ne
                      servaient à personne, alors que cette référence se lit dans
                      la liste des réceptions et dans BMS. Elle y est renvoyée à
                      la sauvegarde — sans quoi la synchro l'effacerait. */}
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', fontWeight: 500, marginBottom: '4px' }}>Réf fournisseur</label>
                    <input
                      type="text"
                      value={editData.supplier_reference}
                      onChange={e => setEditData(prev => ({ ...prev, supplier_reference: e.target.value }))}
                      placeholder="Une note libre — « Précommande JNR », « Réassort Aegis »…"
                      style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: '4px' }}
                    />
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                      Visible dans la liste des réceptions et renvoyée dans BMS.
                      BMS refuse de la vider : une fois posée, elle se remplace mais ne s'efface pas.
                    </div>
                  </div>

                  {/* Tableau des lignes éditable */}
                  <h4 style={{ marginBottom: '8px' }}>Articles</h4>
                  <table className="purchases-table" style={{ marginBottom: '12px' }}>
                    <thead>
                      <tr>
                        <th>Produit</th>
                        <th>Réf. fourn.</th>
                        <th className="text-right">Qté commandée</th>
                        <th className="text-right">Prix unit. (€)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editData.items.filter(item => !item._delete).map((item, idx) => {
                        const itemKey = item.id || item._tmpId;
                        const isVariable = item.product_type === 'variable';
                        const isRematching = rematchItemId === itemKey;
                        return (
                        <tr key={itemKey} style={{ background: isVariable && !isRematching ? '#fffbeb' : undefined }}>
                          <td style={{ maxWidth: '300px', position: 'relative' }}>
                            {isRematching ? (
                              <div style={{ position: 'relative' }}>
                                <input
                                  type="text"
                                  placeholder="Rechercher un produit..."
                                  value={rematchSearch}
                                  autoFocus
                                  onChange={e => handleRematchSearch(e.target.value)}
                                  style={{ width: '100%', padding: '5px 8px', border: '1px solid #f59e0b', borderRadius: '4px', fontSize: '13px' }}
                                />
                                {rematchLoading && (
                                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', padding: '6px 10px', fontSize: '12px', color: '#888', border: '1px solid #ddd' }}>Recherche...</div>
                                )}
                                {rematchResults.length > 0 && (
                                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'white', border: '1px solid #ddd', borderRadius: '0 0 6px 6px', maxHeight: '220px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                    {rematchResults.map(product => (
                                      <div
                                        key={product.id}
                                        onClick={() => applyRematch(product)}
                                        style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid #eee', fontSize: '13px' }}
                                        onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'white'}
                                      >
                                        <div style={{ fontWeight: 500 }}>
                                          {product.post_title}
                                          {brandLabel(product) && <span style={{ fontWeight: 400, color: '#888' }}> — {brandLabel(product)}</span>}
                                        </div>
                                        <div style={{ color: '#888', fontSize: '12px' }}>SKU: {product.sku || '-'} | Stock: {product.stock ?? '-'}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <button onClick={() => { setRematchItemId(null); setRematchSearch(''); setRematchResults([]); }} style={{ marginTop: '4px', fontSize: '11px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>annuler</button>
                              </div>
                            ) : (
                              <div>
                                <div style={{ fontSize: '13px' }}>{item.product_name}</div>
                                {item.product_sku && <div style={{ fontSize: '11px', color: isVariable ? '#f59e0b' : '#999' }}>SKU: {item.product_sku}{isVariable ? ' ⚠ variable' : ''}</div>}
                                <button onClick={() => { setRematchItemId(itemKey); setRematchSearch(''); setRematchResults([]); }} style={{ fontSize: '11px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>modifier produit</button>
                              </div>
                            )}
                          </td>
                          <td>
                            <input
                              type="text"
                              value={item.supplier_sku || ''}
                              onChange={e => setEditData(prev => ({
                                ...prev,
                                items: prev.items.map(i =>
                                  (i._tmpId ? i._tmpId === item._tmpId : i === item)
                                    ? { ...i, supplier_sku: e.target.value }
                                    : i
                                )
                              }))}
                              style={{ width: '90px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px' }}
                            />
                          </td>
                          <td className="text-right">
                            <input
                              type="number"
                              min="1"
                              value={item.qty_ordered}
                              onChange={e => setEditData(prev => ({
                                ...prev,
                                items: prev.items.map(i =>
                                  (i._tmpId ? i._tmpId === item._tmpId : i === item)
                                    ? { ...i, qty_ordered: parseInt(e.target.value) || 1 }
                                    : i
                                )
                              }))}
                              style={{ width: '70px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: '4px', textAlign: 'right' }}
                            />
                          </td>
                          <td className="text-right">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unit_price ?? ''}
                              onChange={e => setEditData(prev => ({
                                ...prev,
                                items: prev.items.map(i =>
                                  (i._tmpId ? i._tmpId === item._tmpId : i === item)
                                    ? { ...i, unit_price: e.target.value === '' ? null : e.target.value }
                                    : i
                                )
                              }))}
                              style={{ width: '80px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: '4px', textAlign: 'right' }}
                            />
                          </td>
                          <td>
                            <button
                              onClick={() => setEditData(prev => ({
                                ...prev,
                                items: prev.items.map(i =>
                                  (i._tmpId ? i._tmpId === item._tmpId : i === item)
                                    ? { ...i, _delete: true }
                                    : i
                                )
                              }))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '16px', padding: '0 4px' }}
                              title="Supprimer la ligne"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Recherche pour ajouter une ligne */}
                  <div style={{ position: 'relative', marginBottom: '8px' }}>
                    <input
                      type="text"
                      placeholder="Ajouter un produit..."
                      value={productSearch}
                      onChange={e => handleProductSearch(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px' }}
                    />
                    {searchLoading && (
                      <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#999', fontSize: '12px' }}>
                        Recherche...
                      </div>
                    )}
                    {searchResults.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, background: 'white',
                        border: '1px solid #ccc', borderRadius: '4px', boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
                        zIndex: 100, maxHeight: '200px', overflowY: 'auto'
                      }}>
                        {searchResults.map(p => (
                          <div
                            key={p.id}
                            onClick={() => addProductToEdit(p)}
                            style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: '13px' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                            onMouseLeave={e => e.currentTarget.style.background = 'white'}
                          >
                            <strong>{p.post_title}</strong>
                            {brandLabel(p) && <span style={{ color: '#888', marginLeft: '8px' }}>— {brandLabel(p)}</span>}
                            {p.sku && <span style={{ color: '#666', marginLeft: '8px' }}>{p.sku}</span>}
                            {p.stock != null && <span style={{ color: '#999', marginLeft: '8px' }}>Stock : {p.stock}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
              {!editMode ? (
                <>
                  <button className="btn btn-danger" onClick={() => deleteOrder(selectedOrder.id)} style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer' }}>
                    Supprimer
                  </button>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-secondary" onClick={() => exportOrder(selectedOrder.id, 'supplier')}>
                      📄 Export fournisseur
                    </button>
                    {!selectedOrder.bms_po_id ? (
                      <button className="btn btn-secondary" onClick={() => sendToBms(selectedOrder.id)} disabled={sendingBms}>
                        {sendingBms ? 'Envoi...' : '📤 Envoyer à BMS'}
                      </button>
                    ) : (
                      <span style={{ color: '#10b981', fontSize: '13px', padding: '8px' }}>BMS #{selectedOrder.bms_po_id}</span>
                    )}
                    {/* Le pont vers la réception : on ne devrait pas avoir à
                        retrouver la commande dans une autre liste pour compter
                        ce qui arrive. Inutile sans identifiant BMS — la
                        réception s'y appuie pour enregistrer le stock. */}
                    {/* « Réceptionner » RESTE proposé sur une commande soldée, et
                        ce n'est pas un oubli : c'est le seul chemin pour enregistrer
                        un article qu'on découvre après coup — BMS accepte une ligne
                        neuve sur un bon terminé, et la liste des réceptions ne montre
                        que les bons en attente. Mais il ne doit pas laisser croire
                        qu'il reste de la marchandise à compter : le libellé le dit. */}
                    {selectedOrder.bms_po_id && (
                      <LinkBox
                        to={`/reception?order=${selectedOrder.id}`}
                        className="btn btn-secondary"
                        display="inline-block"
                        title={toutEstRecu(selectedOrder)
                          ? "Tout est déjà reçu. À n'ouvrir que pour enregistrer un article oublié."
                          : undefined}
                      >
                        {toutEstRecu(selectedOrder) ? '📦 Réceptionner un oubli' : '📦 Réceptionner'}
                      </LinkBox>
                    )}
                    <button className="btn btn-secondary" onClick={enterEditMode}>
                      ✏️ Modifier
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowDetailModal(false)}>
                      Fermer
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={cancelEditMode}>
                    Annuler
                  </button>
                  <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit}>
                    {savingEdit ? 'Sauvegarde...' : '💾 Sauvegarder'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrdersTab;
