import { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { LinkBox } from '../utils/navHelpers';
import AppShell from '../components/AppShell';
import { brandLabel } from '../utils/productBrand';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const CreateOrderPage = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();

  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  // Le numéro du bon chez le fournisseur. Saisi ici, il part tel quel dans BMS
  // comme référence : c'est lui qu'on lira sur la facture, et par lequel le
  // contrôle de facture retombera sur la commande.
  const [orderNumber, setOrderNumber] = useState('');
  // La réf libre de BMS : « Précommande JNR ». C'est elle qu'on lira dans la
  // liste des réceptions pour reconnaître une commande au premier coup d'œil,
  // là où un numéro ne dit rien.
  const [supplierReference, setSupplierReference] = useState('');
  const searchBoxRef = useRef(null);
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [orderItems, setOrderItems] = useState([]);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState(null);
  // Par défaut on ne cherche que dans le catalogue du fournisseur choisi. La case
  // ouvre à tout le catalogue, pour le produit fraîchement créé ou l'article vu
  // moins cher ailleurs.
  const [toutLeCatalogue, setToutLeCatalogue] = useState(false);
  // Les lignes cochées, et ce qu'on veut leur appliquer d'un coup : une même
  // quantité, un même lot, un même tarif — dix goûts d'une même gamme se
  // commandent presque toujours pareil. Un champ laissé vide ne touche à rien.
  const [selection, setSelection] = useState(() => new Set());
  const [lot, setLot] = useState({ qty: '', pack: '', price: '', priceUnit: 'lot' });

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

  /**
   * La recherche porte SUR LE CATALOGUE DU FOURNISSEUR CHOISI.
   *
   * Elle avait été ouverte à tout le catalogue pour une bonne raison — un produit
   * qu'on vient de créer n'est rattaché à personne et serait introuvable — mais le
   * remède était pire : choisir LCA proposait toute la gamme Biggy Bear, qui n'a
   * jamais été achetée que chez Joshnoa. Un écran qui propose n'importe quoi ne
   * propose plus rien.
   *
   * La bonne raison garde donc sa porte, mais explicite : « chercher dans tout le
   * catalogue » l'ouvre en un clic, et ce qui vient d'ailleurs est signalé.
   */
  const lancerRecherche = async (value, tout) => {
    setSearchLoading(true);
    try {
      const params = new URLSearchParams({ q: value, limit: '30' });
      if (supplierId) {
        params.set('supplier_id', supplierId);
        // Le fournisseur sert toujours à ENRICHIR les résultats (ses références,
        // leurs conditionnements, le dernier tarif retenu), qu'il filtre ou non.
        if (tout) params.set('all_suppliers', '1');
      }
      const response = await axios.get(`${API_URL}/purchases/products/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // Filter out products already in orderItems
      const existingIds = orderItems.map(item => item.product_id);
      const filtered = (response.data.data || []).filter(p => !existingIds.includes(p.id));
      setSearchResults(filtered);
    } catch (err) {
      console.error('Erreur recherche produits:', err);
    } finally {
      setSearchLoading(false);
    }
  };

  // Search products
  const handleProductSearch = (value) => {
    setProductSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);

    if (value.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchTimeout(setTimeout(() => lancerRecherche(value, toutLeCatalogue), 300));
  };

  // Élargir ou resserrer le périmètre relance la recherche en cours : sans ça, la
  // case cochée ne montre rien avant qu'on retape une lettre.
  const basculerPerimetre = (tout) => {
    setToutLeCatalogue(tout);
    if (productSearch.trim().length >= 2) lancerRecherche(productSearch, tout);
  };

  // Une liste de résultats qui ne se ferme pas recouvre le reste de l'écran.
  // Un clic ailleurs la referme, comme partout.
  useEffect(() => {
    const dehors = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, []);

  /**
   * Ajoute un produit, éventuellement sous une RÉFÉRENCE PRÉCISE du fournisseur.
   *
   * Un produit a souvent plusieurs références chez le même fournisseur — à
   * l'unité, par 50, par 100 — et c'est celle qu'on retient qui fixe ce que la
   * ligne veut dire. Elle apporte son conditionnement et son prix.
   *
   * Le prix part du dernier tarif RETENU sur une facture contrôlée quand il
   * existe : c'est ce qui a été réellement payé, pas un souvenir.
   */
  const addProductToOrder = (product, ref = null) => {
    // LE CONDITIONNEMENT VIENT DU CATALOGUE, et de nulle part ailleurs : BMS
    // impose le sien quoi qu'on lui envoie (vérifié le 29/09/2026 — dix pièces
    // envoyées « par 1 » sont ressorties en deux lots de 5). Laisser croire
    // qu'on le choisit fabriquerait un écart entre l'écran et BMS.
    const packQty = product.supplier_pack_qty || 1;
    // Une référence peut être conditionnée autrement que le lien catalogue :
    // on ramène alors son tarif au lot que BMS utilisera.
    const prixRef = ref && ref.pack_price != null
      ? (ref.pack_price / (ref.pack_qty || 1)) * packQty
      : null;
    setOrderItems(prev => [...prev, {
      product_id: product.id,
      product_name: product.post_title,
      sku: product.sku,
      brand: brandLabel(product) || null,
      stock: product.stock,
      supplier_sku: ref ? ref.supplier_sku : null,
      qty_ordered: 1,
      units_per_qty: packQty,
      unit_price: prixRef != null
        ? Math.round(prixRef * 100) / 100
        : (product.supplier_price != null ? product.supplier_price : (product.cost_price || null)),
      priceRetained: Boolean(ref && ref.retained_at),
    }]);
    setProductSearch('');
    setSearchResults([]);
  };

  // Remove product from order
  const removeProductFromOrder = (productId) => {
    setOrderItems(prev => prev.filter(item => item.product_id !== productId));
    setSelection(prev => { const n = new Set(prev); n.delete(productId); return n; });
  };

  /**
   * Change le lot d'une ligne EN GARDANT LE PRIX DE LA PIÈCE.
   *
   * Le prix saisi est celui du lot : passer de « par 1 à 1,34 € » à « par 10 »
   * sans le recalculer ferait des lots de dix à 1,34 €. On ramène donc le prix
   * à la pièce, puis on le remultiplie par le nouveau lot (4 décimales, comme
   * côté BMS : arrondir au centime perd de l'argent sur un lot de 200).
   */
  const avecLot = (item, pack) => {
    const nouveau = Math.max(1, parseInt(pack, 10) || 1);
    const ancien = parseInt(item.units_per_qty, 10) || 1;
    const prix = item.unit_price == null || item.unit_price === ''
      ? item.unit_price
      : Math.round((parseFloat(item.unit_price) / ancien) * nouveau * 10000) / 10000;
    return { ...item, units_per_qty: nouveau, unit_price: prix };
  };

  const updateItemPack = (productId, pack) => {
    setOrderItems(prev => prev.map(item =>
      item.product_id === productId ? avecLot(item, pack) : item
    ));
  };

  const basculerLigne = (productId) => {
    setSelection(prev => {
      const n = new Set(prev);
      if (n.has(productId)) n.delete(productId); else n.add(productId);
      return n;
    });
  };

  const selectionnerMarque = (marque) => {
    setSelection(new Set(orderItems.filter(i => i.brand === marque).map(i => i.product_id)));
  };

  // Applique quantité / lot / prix aux lignes cochées. Le lot passe d'abord
  // (il recalcule le prix du lot à prix pièce constant), le prix saisi ensuite
  // l'emporte s'il est donné.
  const appliquerALaSelection = () => {
    const qty = parseInt(lot.qty, 10);
    const pack = parseInt(lot.pack, 10);
    const prix = lot.price === '' ? NaN : parseFloat(String(lot.price).replace(',', '.'));
    setOrderItems(prev => prev.map(item => {
      if (!selection.has(item.product_id)) return item;
      let next = item;
      if (Number.isFinite(qty) && qty >= 1) next = { ...next, qty_ordered: qty };
      if (Number.isFinite(pack) && pack >= 1) next = avecLot(next, pack);
      if (Number.isFinite(prix) && prix >= 0) {
        const p = lot.priceUnit === 'piece'
          ? Math.round(prix * (parseInt(next.units_per_qty, 10) || 1) * 10000) / 10000
          : prix;
        next = { ...next, unit_price: p };
      }
      return next;
    }));
  };

  // Update quantity
  const updateItemQty = (productId, qty) => {
    setOrderItems(prev => prev.map(item =>
      item.product_id === productId ? { ...item, qty_ordered: Math.max(1, qty) } : item
    ));
  };

  // Update unit price
  const updateItemPrice = (productId, price) => {
    setOrderItems(prev => prev.map(item =>
      item.product_id === productId
        ? { ...item, unit_price: price === '' ? null : Math.max(0, price) }
        : item
    ));
  };

  // Create order
  const handleCreateOrder = async (sendToBMS = false) => {
    if (!supplierId) {
      alert('Veuillez sélectionner un fournisseur');
      return;
    }
    if (orderItems.length === 0) {
      alert('Veuillez ajouter au moins un produit');
      return;
    }

    setCreatingOrder(true);
    try {
      const items = orderItems.map(item => ({
        product_id: item.product_id,
        product_name: item.product_name,
        qty_ordered: item.qty_ordered,
        stock_before: item.stock || 0,
        supplier_sku: item.supplier_sku || null,
        unit_price: item.unit_price || null,
        // Le conditionnement de la ligne : il fixe le nombre de pièces et le
        // prix à la pièce, dont BMS déduira son propre découpage en lots.
        units_per_qty: parseInt(item.units_per_qty, 10) || 1
      }));

      const response = await axios.post(`${API_URL}/purchases/orders`, {
        order_number: orderNumber.trim() || undefined,
        supplier_reference: supplierReference.trim() || undefined,
        supplier_id: parseInt(supplierId),
        items,
        send_to_bms: sendToBMS
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const created = response.data.data;
      const orderNum = created?.order_number || '';
      const bmsError = response.data.bms_error;

      // La commande locale est conservée quand le refus BMS est « décidable »
      // (produits pas encore créés dans BMS, écart avec le total du document) :
      // on laisse l'utilisateur envoyer la commande en l'état.
      if (bmsError) {
        const label = bmsError.code === 'BMS_MISSING_PRODUCTS'
          ? `sans ${(bmsError.missing_skus || []).length > 1 ? 'ces produits' : 'ce produit'}`
          : 'en l\'état';
        if (bmsError.can_send_anyway &&
            confirm(`Commande ${orderNum} créée, mais NON envoyée à BMS.\n\n${bmsError.message}\n\n` +
                    `Envoyer quand même la commande à BMS ${label} ?`)) {
          try {
            const sent = await axios.post(
              `${API_URL}/purchases/orders/${created.id}/send-bms`,
              bmsError.retry_flags,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            const skipped = sent.data.skipped_items || [];
            alert(skipped.length
              ? `Commande ${orderNum} envoyée à BMS sans ${skipped.length} produit(s) : ` +
                skipped.map(p => p.sku).join(', ')
              : `Commande ${orderNum} envoyée à BMS.`);
          } catch (e) {
            alert(e.response?.data?.error || 'Erreur lors de l\'envoi à BMS');
          }
        } else {
          alert(`Commande ${orderNum} créée avec ${items.length} article(s), mais NON envoyée à BMS :\n\n${bmsError.message}\n\n` +
                `Vous pourrez l'envoyer depuis l'onglet Commandes.`);
        }
      } else {
        alert(`Commande ${orderNum} créée avec ${items.length} article(s)${sendToBMS ? ' et envoyée à BMS' : ''}`);
      }
      navigate('/purchases/commandes');
    } catch (err) {
      console.error('Erreur création commande:', err);
      alert(err.response?.data?.error || 'Erreur lors de la création de la commande');
    } finally {
      setCreatingOrder(false);
    }
  };

  // Ce qu'on commande en LOTS, et ce que ça fait en PIÈCES — les deux comptent,
  // et « 10 » tout seul ne dit pas lequel des deux on lit.
  const totalQty = orderItems.reduce((sum, item) => sum + item.qty_ordered, 0);
  const totalPieces = orderItems.reduce(
    (sum, item) => sum + item.qty_ordered * (parseInt(item.units_per_qty, 10) || 1), 0,
  );
  // Le prix saisi est celui du LOT quand la ligne en porte un : le total de
  // ligne est donc quantité × prix, sans reconversion.
  const totalHT = orderItems.reduce(
    (sum, item) => sum + (parseFloat(item.unit_price) || 0) * item.qty_ordered, 0,
  );
  const totalTTC = totalHT * 1.2;
  const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;

  return (
    <AppShell currentPath="/purchases/commandes">
    <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#f59e0b', color: 'white', padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <LinkBox
            to="/purchases/commandes"
            display="inline-block"
            style={{ background: 'rgba(255,255,255,0.2)', color: 'white', padding: '8px 16px', borderRadius: '6px', fontSize: '14px' }}
          >
            ← Retour aux commandes
          </LinkBox>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Créer une commande</h1>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        {/* Supplier selection */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '10px', fontSize: '16px' }}>
            Fournisseur *
          </label>
          <select
            value={supplierId}
            onChange={e => {
              setSupplierId(e.target.value);
              // Le fournisseur conditionne les produits proposés : on repart à zéro
              setProductSearch('');
              setSearchResults([]);
            }}
            style={{ width: '100%', maxWidth: '400px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '15px' }}
          >
            <option value="">-- Sélectionner un fournisseur --</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          {/* Le numéro du bon chez le fournisseur. Il part tel quel dans BMS
              comme référence : c'est lui qu'on lira sur la facture, et par lui
              que le contrôle de facture retombera sur cette commande. Laissé
              vide, un numéro est engendré. */}
          <label style={{ display: 'block', marginTop: '18px', marginBottom: '8px', fontWeight: 600, fontSize: '14px' }}>
            Numéro de commande
          </label>
          <input
            type="text"
            value={orderNumber}
            onChange={e => setOrderNumber(e.target.value)}
            placeholder="Celui du fournisseur — laissez vide pour en engendrer un"
            style={{ width: '100%', maxWidth: '400px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '15px' }}
          />

          {/* La réf libre. Elle part dans BMS avec la commande, et c'est par
              elle qu'on reconnaîtra le bon dans la liste des réceptions. */}
          <label style={{ display: 'block', marginTop: '18px', marginBottom: '8px', fontWeight: 600, fontSize: '14px' }}>
            Réf fournisseur
          </label>
          <input
            type="text"
            value={supplierReference}
            onChange={e => setSupplierReference(e.target.value)}
            placeholder="Une note libre — « Précommande JNR », « Réassort Aegis »…"
            style={{ width: '100%', maxWidth: '400px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '15px' }}
          />
        </div>

        {/* Product search */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '10px', fontSize: '16px' }}>
            Ajouter des produits
          </label>
          {!supplierId && (
            <div style={{ marginBottom: '10px', color: '#b45309', fontSize: '14px' }}>
              Sélectionnez d'abord un fournisseur : son tarif et ses conditionnements
              prérempliront les lignes.
            </div>
          )}
          {/* Le périmètre de la recherche, dit avant de chercher. Par défaut le
              catalogue du fournisseur — ses références, ce qu'on lui a déjà
              commandé, ses liens tarifés. La case l'ouvre au reste. */}
          {supplierId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '13px', color: '#555', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={toutLeCatalogue}
                onChange={e => basculerPerimetre(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Chercher dans tout le catalogue
              <span style={{ color: '#888' }}>
                — pour un produit jamais commandé chez ce fournisseur
              </span>
            </label>
          )}
          <div style={{ position: 'relative' }} ref={searchBoxRef}>
            <input
              type="text"
              placeholder={supplierId
                ? (toutLeCatalogue
                    ? 'Nom, SKU, marque ou sous-marque — tout le catalogue'
                    : 'Nom, SKU, marque ou sous-marque — catalogue du fournisseur')
                : 'Sélectionnez un fournisseur d\'abord'}
              value={productSearch}
              onChange={e => handleProductSearch(e.target.value)}
              disabled={!supplierId}
              style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '15px', background: supplierId ? 'white' : '#f3f4f6', cursor: supplierId ? 'text' : 'not-allowed' }}
            />
            {searchLoading && (
              <div style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', color: '#666' }}>
                Recherche...
              </div>
            )}

            {/* Search results dropdown */}
            {searchResults.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: 'white',
                border: '1px solid #ddd',
                borderRadius: '0 0 6px 6px',
                maxHeight: '350px',
                overflowY: 'auto',
                zIndex: 1000,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
              }}>
                {searchResults.map(product => (
                  <div
                    key={product.id}
                    onClick={() => addProductToOrder(product)}
                    style={{
                      padding: '12px 15px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #eee',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                    onMouseLeave={e => e.currentTarget.style.background = 'white'}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                        {product.post_title}
                        {brandLabel(product) && <span style={{ fontWeight: 400, color: '#888' }}> — {brandLabel(product)}</span>}
                        {/* Proposer un produit jamais commandé chez ce fournisseur
                            est légitime ; le proposer sans le dire ne l'est pas. */}
                        {product.in_supplier_catalogue === false && (
                          <span style={{
                            marginLeft: '8px', fontSize: '11px', fontWeight: 600,
                            color: '#B45309', background: '#FEF3C7',
                            borderRadius: '5px', padding: '2px 6px', whiteSpace: 'nowrap',
                          }}>
                            jamais commandé ici
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '13px', color: '#666', display: 'flex', gap: '15px' }}>
                        <span>SKU: <code>{product.sku || '-'}</code></span>
                        <span>Stock: <strong style={{ color: product.stock <= 0 ? '#ef4444' : 'inherit' }}>{product.stock ?? 'N/A'}</strong></span>
                      </div>
                      {/* Une référence par conditionnement : à l'unité, par 50,
                          par 100. Celle qu'on choisit fixe le sens de la ligne et
                          apporte son tarif. */}
                      {(product.supplier_refs || []).length > 0 && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '7px' }}>
                          {product.supplier_refs.map(ref => (
                            <button
                              key={ref.supplier_sku}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); addProductToOrder(product, ref); }}
                              style={{
                                border: `1px solid ${ref.retained_at ? '#16A34A' : '#ddd'}`,
                                background: ref.retained_at ? '#F0FDF4' : 'white',
                                borderRadius: '7px', padding: '5px 9px', fontSize: '12px',
                                cursor: 'pointer', textAlign: 'left',
                              }}
                            >
                              <strong>{ref.supplier_sku}</strong>
                              <span style={{ color: '#666' }}>
                                {' '}· par {ref.pack_qty}
                                {ref.pack_price != null && ` · ${Number(ref.pack_price).toFixed(2).replace('.', ',')} €`}
                              </span>
                              {ref.retained_at && (
                                <span style={{ color: '#16A34A', fontWeight: 600 }}> · tarif retenu</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <span style={{ color: '#10b981', fontSize: '24px', fontWeight: 'bold', marginLeft: '15px' }}>+</span>
                  </div>
                ))}

              </div>
            )}
          </div>
        </div>

        {/* Order items */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              Articles ({orderItems.length})
            </h3>
            {orderItems.length > 0 && (
              <span style={{ color: '#666' }}>
                <strong>{totalQty}</strong> lot{totalQty > 1 ? 's' : ''} ·{' '}
                <strong>{totalPieces}</strong> pièce{totalPieces > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {orderItems.length > 0 && (() => {
            const marques = [...new Set(orderItems.map(i => i.brand).filter(Boolean))].sort();
            const champ = { padding: '7px 8px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '14px' };
            const rien = lot.qty === '' && lot.pack === '' && lot.price === '';
            return (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px',
                padding: '12px 14px', marginBottom: '14px', display: 'flex', flexWrap: 'wrap',
                alignItems: 'center', gap: '10px', fontSize: '14px' }}>
                <strong style={{ marginRight: '4px' }}>
                  {selection.size} ligne{selection.size > 1 ? 's' : ''} cochée{selection.size > 1 ? 's' : ''}
                </strong>
                <button type="button" onClick={() => setSelection(new Set(orderItems.map(i => i.product_id)))}
                  style={{ ...champ, background: 'white', color: '#374151', fontWeight: 500, cursor: 'pointer' }}>Tout</button>
                <button type="button" onClick={() => setSelection(new Set())}
                  style={{ ...champ, background: 'white', color: '#374151', fontWeight: 500, cursor: 'pointer' }}>Aucune</button>
                {marques.length > 0 && (
                  <select value="" onChange={e => e.target.value && selectionnerMarque(e.target.value)}
                    style={{ ...champ, background: 'white', color: '#374151' }}>
                    <option value="">Cocher une marque…</option>
                    {marques.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
                <span style={{ color: '#999' }}>→</span>
                <label>Quantité{' '}
                  <input type="number" min="1" value={lot.qty} placeholder="—"
                    onChange={e => setLot(l => ({ ...l, qty: e.target.value }))}
                    style={{ ...champ, width: '70px', textAlign: 'center' }} />
                </label>
                <label>Par{' '}
                  <input type="number" min="1" list="lots-courants" value={lot.pack} placeholder="—"
                    onChange={e => setLot(l => ({ ...l, pack: e.target.value }))}
                    style={{ ...champ, width: '70px', textAlign: 'center' }} />
                </label>
                <label>Prix HT{' '}
                  <input type="number" min="0" step="0.01" value={lot.price} placeholder="—"
                    onChange={e => setLot(l => ({ ...l, price: e.target.value }))}
                    style={{ ...champ, width: '85px', textAlign: 'center' }} />
                </label>
                <select value={lot.priceUnit} onChange={e => setLot(l => ({ ...l, priceUnit: e.target.value }))}
                  style={{ ...champ, background: 'white', color: '#374151' }}>
                  <option value="lot">€ HT le lot</option>
                  <option value="piece">€ HT la pièce</option>
                </select>
                <button type="button" onClick={appliquerALaSelection}
                  disabled={selection.size === 0 || rien}
                  style={{ background: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px',
                    padding: '8px 16px', fontWeight: 600, fontSize: '14px',
                    cursor: selection.size === 0 || rien ? 'not-allowed' : 'pointer',
                    opacity: selection.size === 0 || rien ? 0.5 : 1 }}>
                  Appliquer
                </button>
                <span style={{ color: '#92400e', fontSize: '12px', flexBasis: '100%' }}>
                  Un champ vide ne change rien. Changer le lot garde le prix de la pièce.
                </span>
              </div>
            );
          })()}

          {/* Les lots usuels, proposés sous chaque champ « Par ». */}
          <datalist id="lots-courants">
            {[1, 5, 10, 20, 50, 100, 200].map(n => <option key={n} value={n} />)}
          </datalist>

          {orderItems.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', background: '#f9fafb', borderRadius: '6px', color: '#666' }}>
              Aucun produit ajouté. Utilisez la recherche ci-dessus pour ajouter des produits.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ width: '32px', padding: '10px 4px' }}>
                    <input type="checkbox"
                      checked={selection.size > 0 && selection.size === orderItems.length}
                      onChange={e => setSelection(e.target.checked ? new Set(orderItems.map(i => i.product_id)) : new Set())}
                      title="Tout cocher" style={{ cursor: 'pointer' }} />
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600 }}>Produit</th>
                  <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600, width: '120px' }}>SKU</th>
                  <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '80px' }}>Stock</th>
                  <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '110px' }}>Quantité</th>
                  <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '90px' }}
                      title="Pièces par lot : 1 pour commander à la pièce">Par</th>
                  <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600, width: '150px' }}>Soit</th>
                  <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '130px' }}>Prix du lot HT (€)</th>
                  <th style={{ textAlign: 'right', padding: '10px', fontWeight: 600, width: '110px' }}>Total ligne HT</th>
                  <th style={{ width: '60px' }}></th>
                </tr>
              </thead>
              <tbody>
                {orderItems.map(item => (
                  <tr key={item.product_id} style={{ borderBottom: '1px solid #e5e7eb',
                    background: selection.has(item.product_id) ? '#fffbeb' : 'transparent' }}>
                    <td style={{ padding: '12px 4px', textAlign: 'center' }}>
                      <input type="checkbox" checked={selection.has(item.product_id)}
                        onChange={() => basculerLigne(item.product_id)} style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={{ padding: '12px 10px' }}>
                      {item.product_name}
                      {item.brand && <div style={{ fontSize: '11.5px', color: '#888' }}>{item.brand}</div>}
                    </td>
                    <td style={{ padding: '12px 10px' }}><code style={{ fontSize: '13px' }}>{item.sku || '-'}</code></td>
                    <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                      <span style={{ color: item.stock <= 0 ? '#ef4444' : 'inherit', fontWeight: 500 }}>
                        {item.stock ?? '-'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                      <input
                        type="number"
                        min="1"
                        value={item.qty_ordered}
                        onChange={e => updateItemQty(item.product_id, parseInt(e.target.value) || 1)}
                        style={{ width: '80px', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', textAlign: 'center', fontSize: '14px' }}
                      />
                    </td>
                    {/* Modifiable depuis le 30/09/2026 : BMS ne connaît plus que
                        des pièces (associations à pack_qty = 1) et buildBmsItems
                        envoie quantité × lot pièces au prix du lot ÷ lot. Le lot
                        ne sert plus qu'à dire combien de pièces on commande. */}
                    <td style={{ padding: '12px 10px', textAlign: 'center', fontSize: '14px' }}>
                      <input
                        type="number"
                        min="1"
                        list="lots-courants"
                        value={item.units_per_qty || 1}
                        onChange={e => updateItemPack(item.product_id, e.target.value)}
                        style={{ width: '70px', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', textAlign: 'center', fontSize: '14px' }}
                      />
                    </td>
                    {/* « 4 » tout seul ne dit pas si ce sont quatre flacons ou
                        quatre cartons. Ce sont les pièces qui partent chez le
                        fournisseur et qui reviendront en stock. */}
                    <td style={{ padding: '12px 10px', fontSize: '13px' }}>
                      {(item.units_per_qty || 1) > 1 ? (
                        <span style={{ color: '#E28F00', fontWeight: 600 }}>
                          {item.qty_ordered} × {item.units_per_qty}
                          <span style={{ color: '#666', fontWeight: 400 }}>
                            {' '}= {item.qty_ordered * item.units_per_qty} pièces
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: '#666' }}>
                          {item.qty_ordered} pièce{item.qty_ordered > 1 ? 's' : ''}
                        </span>
                      )}
                      {item.supplier_sku && (
                        <div style={{ fontSize: '11.5px', color: '#888', marginTop: '2px' }}>
                          réf. {item.supplier_sku}
                          {item.priceRetained && (
                            <span style={{ color: '#16A34A', fontWeight: 600 }}> · tarif retenu</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={item.unit_price ?? ''}
                        onChange={e => updateItemPrice(item.product_id, e.target.value === '' ? '' : parseFloat(e.target.value))}
                        style={{
                          width: '100px',
                          padding: '8px',
                          borderRadius: '4px',
                          border: item.unit_price == null ? '1px solid #f59e0b' : '1px solid #ddd',
                          background: item.unit_price == null ? '#fffbeb' : 'white',
                          textAlign: 'center',
                          fontSize: '14px'
                        }}
                      />
                      {/* Le prix saisi porte sur ce qu'on commande : un lot quand
                          la ligne en a un, une pièce sinon. Sans cette mention,
                          « 7,50 » sur une ligne de 5 se lit aussi bien comme le
                          prix du lot que comme celui de la pièce — et l'écart
                          est de un à cinq. */}
                      <div style={{ fontSize: '11px', color: '#888', marginTop: '3px' }}>
                        {(item.units_per_qty || 1) > 1
                          ? `le lot de ${item.units_per_qty}`
                          : 'la pièce'}
                      </div>
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, fontSize: '14px' }}>
                      {eur((parseFloat(item.unit_price) || 0) * item.qty_ordered)}
                      {(item.units_per_qty || 1) > 1 && item.unit_price > 0 && (
                        <div style={{ fontSize: '11px', color: '#888', fontWeight: 400, marginTop: '3px' }}>
                          {eur(parseFloat(item.unit_price) / item.units_per_qty)} HT la pièce
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                      <button
                        onClick={() => removeProductFromOrder(item.product_id)}
                        style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', fontSize: '16px' }}
                        title="Retirer"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Les totaux. Le TTC parce que c'est ce qu'on paiera, le HT parce que
            c'est ce que la facture comparera. */}
        {orderItems.length > 0 && (
          <div style={{ background: 'white', borderRadius: '8px', padding: '16px 20px',
            marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            display: 'flex', justifyContent: 'flex-end', gap: '32px', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pièces</div>
              <div style={{ fontSize: '19px', fontWeight: 700 }}>{totalPieces}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total HT</div>
              <div style={{ fontSize: '19px', fontWeight: 700 }}>{eur(totalHT)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Total TTC <span style={{ textTransform: 'none' }}>(TVA 20 %)</span>
              </div>
              <div style={{ fontSize: '19px', fontWeight: 700, color: '#135E84' }}>{eur(totalTTC)}</div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <LinkBox
            to="/purchases/commandes"
            display="inline-block"
            style={{ background: '#f3f4f6', color: '#374151', borderRadius: '6px', padding: '12px 24px', fontSize: '15px', fontWeight: 500 }}
          >
            Annuler
          </LinkBox>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => handleCreateOrder(false)}
              disabled={creatingOrder || !supplierId || orderItems.length === 0}
              style={{
                background: '#f59e0b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '12px 24px',
                cursor: creatingOrder || !supplierId || orderItems.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: '15px',
                fontWeight: 500,
                opacity: creatingOrder || !supplierId || orderItems.length === 0 ? 0.6 : 1
              }}
            >
              {creatingOrder ? 'Création...' : 'Sauvegarder (Brouillon)'}
            </button>
            <button
              onClick={() => handleCreateOrder(true)}
              disabled={creatingOrder || !supplierId || orderItems.length === 0}
              style={{
                background: '#6366f1',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '12px 24px',
                cursor: creatingOrder || !supplierId || orderItems.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: '15px',
                fontWeight: 500,
                opacity: creatingOrder || !supplierId || orderItems.length === 0 ? 0.6 : 1
              }}
            >
              {creatingOrder ? 'Création...' : 'Créer dans BMS'}
            </button>
          </div>
        </div>
      </div>
    </main>
    </AppShell>
  );
};

export default CreateOrderPage;
