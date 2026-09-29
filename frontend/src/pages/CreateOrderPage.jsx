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
  const searchBoxRef = useRef(null);
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [orderItems, setOrderItems] = useState([]);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState(null);

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

  // Search products
  const handleProductSearch = (value) => {
    setProductSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);

    if (value.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchTimeout(setTimeout(async () => {
      setSearchLoading(true);
      try {
        // La recherche N'EST PAS restreinte aux produits du fournisseur choisi.
        // Un produit qu'on vient de créer n'est encore rattaché à personne et
        // serait introuvable ; et on doit pouvoir commander ailleurs un article
        // vu moins cher. Le fournisseur sert ici à ENRICHIR les résultats — ses
        // références, leurs conditionnements et le dernier tarif retenu — pas à
        // les filtrer.
        const supplierParam = supplierId ? `&supplier_id=${supplierId}&all_suppliers=1` : '';
        const response = await axios.get(`${API_URL}/purchases/products/search?q=${encodeURIComponent(value)}&limit=30${supplierParam}`, {
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
    }, 300));
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
    const packQty = ref ? ref.pack_qty : (product.supplier_pack_qty || 1);
    setOrderItems(prev => [...prev, {
      product_id: product.id,
      product_name: product.post_title,
      sku: product.sku,
      stock: product.stock,
      supplier_sku: ref ? ref.supplier_sku : null,
      qty_ordered: 1,
      units_per_qty: packQty,
      unit_price: ref && ref.pack_price != null
        ? ref.pack_price
        : (product.supplier_price != null ? product.supplier_price : (product.cost_price || null)),
      priceRetained: Boolean(ref && ref.retained_at),
    }]);
    setProductSearch('');
    setSearchResults([]);
  };

  // Remove product from order
  const removeProductFromOrder = (productId) => {
    setOrderItems(prev => prev.filter(item => item.product_id !== productId));
  };

  // Conditionnement de la ligne : « 4 × 5 = 20 pièces ». Quatre tout seul ne
  // dit pas si ce sont quatre flacons ou quatre cartons.
  const updateItemPack = (productId, packQty) => {
    setOrderItems(prev => prev.map(item =>
      item.product_id === productId
        ? { ...item, units_per_qty: Math.max(1, parseInt(packQty, 10) || 1) }
        : item
    ));
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
        // Sans lui, « 4 packs de 5 » partirait chez BMS comme 4 pièces.
        units_per_qty: parseInt(item.units_per_qty, 10) || 1,
        supplier_sku: item.supplier_sku || null
      }));

      const response = await axios.post(`${API_URL}/purchases/orders`, {
        order_number: orderNumber.trim() || undefined,
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
      navigate('/purchases?tab=orders');
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
    <AppShell currentPath="/purchases">
    <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#f59e0b', color: 'white', padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <LinkBox
            to="/purchases?tab=orders"
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
          <div style={{ position: 'relative' }} ref={searchBoxRef}>
            <input
              type="text"
              placeholder={supplierId ? 'Nom, SKU, marque ou sous-marque — tous fournisseurs' : 'Sélectionnez un fournisseur d\'abord'}
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

          {orderItems.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', background: '#f9fafb', borderRadius: '6px', color: '#666' }}>
              Aucun produit ajouté. Utilisez la recherche ci-dessus pour ajouter des produits.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600 }}>Produit</th>
                  <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600, width: '120px' }}>SKU</th>
                  <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '80px' }}>Stock</th>
                  <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '110px' }}>Quantité</th>
                  <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '90px' }}>Par</th>
                  <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600, width: '150px' }}>Soit</th>
                  <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '140px' }}>Prix (€)</th>
                  <th style={{ width: '60px' }}></th>
                </tr>
              </thead>
              <tbody>
                {orderItems.map(item => (
                  <tr key={item.product_id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '12px 10px' }}>{item.product_name}</td>
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
                    <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                      <input
                        type="number"
                        min="1"
                        value={item.units_per_qty ?? 1}
                        onChange={e => updateItemPack(item.product_id, e.target.value)}
                        title="Nombre de pièces par lot commandé"
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
            to="/purchases?tab=orders"
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
