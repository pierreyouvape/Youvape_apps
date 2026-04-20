import { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const ImportPdfPage = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();

  // Etape 1 : Upload
  const [suppliers, setSuppliers] = useState([]);
  const [availableParsers, setAvailableParsers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');

  // Etape 2 : Preview
  const [parsedData, setParsedData] = useState(null);
  const [items, setItems] = useState([]);
  const [newSupplierSkus, setNewSupplierSkus] = useState([]);

  // Etape 2 : Recherche pour lignes non matchees
  const [searchingIdx, setSearchingIdx] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeoutRef = useRef(null);

  // Etape 3 : Creation
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

  // Fournisseur selectionne — verifier si parseur dispo
  const selectedSupplier = suppliers.find(s => s.id === parseInt(supplierId));
  const hasParser = selectedSupplier ? availableParsers.includes(selectedSupplier.code) : false;

  // ==================== ETAPE 1 : UPLOAD + PARSE ====================

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
        // Pour les lignes produit : afficher le prix brut dans le champ éditable
        unit_price: item.item_type === 'discount' ? item.unit_price : (item.pdf_price ?? item.unit_price),
        discount: item.discount_percent || 0,
      })));
      setNewSupplierSkus([]);
    } catch (err) {
      setParseError(err.response?.data?.error || 'Erreur lors du parsing du PDF');
    } finally {
      setParsing(false);
    }
  };

  // ==================== ETAPE 2 : PREVIEW + MATCHING ====================

  const handleSearchProduct = (value, idx) => {
    setSearchTerm(value);
    setSearchingIdx(idx);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (value.length < 2) {
      setSearchResults([]);
      return;
    }

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
        supplier_price: product.cost_price || null,
        // Conserver le prix PDF s'il existe, sinon utiliser le prix BDD
        unit_price: item.unit_price ?? product.cost_price ?? null,
      };
    }));

    // Enregistrer l'association supplier_sku pour le produit
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
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, unit_price: value === '' ? null : parseFloat(value) || null } : item
    ));
  };

  const handleUpdateDiscount = (idx, value) => {
    const d = value === '' ? 0 : Math.min(100, Math.max(0, parseFloat(value) || 0));
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, discount: d } : item));
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
    if (item.item_type === 'discount') return item.unit_price;  // déjà négatif
    if (!item.unit_price) return item.supplier_price ?? null;
    const pdfNet = item.unit_price * (1 - (item.discount || 0) / 100);
    // Retenir le moins cher entre prix PDF net et prix BDD
    if (item.supplier_price != null && item.supplier_price < pdfNet) return item.supplier_price;
    return pdfNet;
  };

  // ==================== ETAPE 3 : CREATION ====================

  const productItems = items.filter(i => i.item_type !== 'discount');
  const discountItems = items.filter(i => i.item_type === 'discount');
  const matchedItems = productItems.filter(i => i.matched && i.product_id);

  const handleCreateOrder = async (sendToBms = false) => {
    if (matchedItems.length === 0) {
      alert('Aucune ligne matchée à créer');
      return;
    }

    setCreating(true);
    try {
      const payload = {
        supplier_id: parseInt(supplierId),
        order_number: parsedData.order_number || undefined,
        order_date: parsedData.order_date || undefined,
        status: 'confirmed',
        items: [
          ...matchedItems.map(item => ({
            product_id: item.product_id,
            product_name: item.product_name,
            supplier_sku: item.supplier_sku,
            qty_ordered: item.qty_ordered,
            unit_price: effectivePrice(item),  // prix net (brut × remise) → stocké en BDD
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

      const orderNum = response.data.data?.order_number || parsedData.order_number || '';
      alert(`Commande ${orderNum} créée avec ${matchedItems.length} article(s)${sendToBms ? ' et envoyée à BMS' : ''}`);
      navigate('/purchases?tab=orders');
    } catch (err) {
      console.error('Erreur création:', err);
      alert(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  };

  // ==================== RENDU ====================

  const totalQty = matchedItems.reduce((sum, i) => sum + i.qty_ordered, 0);
  const totalHtProduits = matchedItems.reduce((sum, i) => { const p = effectivePrice(i); return sum + (p ? i.qty_ordered * p : 0); }, 0);
  const totalRemises = discountItems.reduce((sum, i) => sum + (i.unit_price || 0), 0);
  const totalHt = totalHtProduits + totalRemises;  // totalRemises est négatif
  const totalTtc = totalHt * 1.2;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#f59e0b', color: 'white', padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button
            onClick={() => navigate('/purchases?tab=orders')}
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
          >
            ← Retour aux commandes
          </button>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Import PDF fournisseur</h1>
        </div>
      </div>

      <div style={{ maxWidth: '1400px', margin: '30px auto', padding: '0 20px' }}>

        {/* ==================== ETAPE 1 : UPLOAD ==================== */}
        {!parsedData && (
          <>
            {/* Choix fournisseur */}
            <div style={{ background: 'white', borderRadius: '8px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <label style={{ fontWeight: 600, display: 'block', marginBottom: '10px', fontSize: '16px' }}>
                Fournisseur *
              </label>
              <select
                value={supplierId}
                onChange={e => { setSupplierId(e.target.value); setParseError(''); }}
                style={{ width: '100%', maxWidth: '400px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '15px' }}
              >
                <option value="">-- Sélectionner un fournisseur --</option>
                {(() => {
                  const active = suppliers.filter(s => s.is_active);
                  const withParser = active.filter(s => availableParsers.includes(s.code));
                  const withoutParser = active.filter(s => !availableParsers.includes(s.code));
                  return (
                    <>
                      {withParser.length > 0 && <option disabled>── Avec parseur ──</option>}
                      {withParser.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                      {withoutParser.length > 0 && <option disabled>── Sans parseur ──</option>}
                      {withoutParser.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </>
                  );
                })()}
              </select>
              {supplierId && !hasParser && (
                <div style={{ marginTop: '10px', color: '#dc2626', fontSize: '14px' }}>
                  Aucun parseur PDF configuré pour ce fournisseur (code: {selectedSupplier?.code || 'non défini'}).
                  Parseurs disponibles : {availableParsers.join(', ') || 'aucun'}
                </div>
              )}
            </div>

            {/* Upload PDF */}
            <div style={{ background: 'white', borderRadius: '8px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <label style={{ fontWeight: 600, display: 'block', marginBottom: '10px', fontSize: '16px' }}>
                Fichier PDF *
              </label>
              <input
                type="file"
                accept=".pdf"
                onChange={e => { setPdfFile(e.target.files[0] || null); setParseError(''); }}
                style={{ fontSize: '15px' }}
              />
              {pdfFile && (
                <span style={{ marginLeft: '15px', color: '#666', fontSize: '14px' }}>
                  {pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} Ko)
                </span>
              )}
            </div>

            {/* Erreur */}
            {parseError && (
              <div style={{ background: '#fee2e2', borderRadius: '8px', padding: '15px 20px', marginBottom: '20px', color: '#dc2626', fontSize: '14px' }}>
                {parseError}
              </div>
            )}

            {/* Bouton analyser */}
            <div style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => navigate('/purchases?tab=orders')}
                style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '6px', padding: '12px 24px', cursor: 'pointer', fontSize: '15px', fontWeight: 500 }}
              >
                Annuler
              </button>
              <button
                onClick={handleParsePdf}
                disabled={parsing || !supplierId || !pdfFile || !hasParser}
                style={{
                  background: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '12px 24px',
                  cursor: parsing || !supplierId || !pdfFile || !hasParser ? 'not-allowed' : 'pointer',
                  fontSize: '15px',
                  fontWeight: 500,
                  opacity: parsing || !supplierId || !pdfFile || !hasParser ? 0.6 : 1
                }}
              >
                {parsing ? 'Analyse en cours...' : 'Analyser le PDF'}
              </button>
            </div>
          </>
        )}

        {/* ==================== ETAPE 2 : PREVIEW ==================== */}
        {parsedData && (
          <>
            {/* En-tete commande */}
            <div style={{ background: 'white', borderRadius: '8px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                <div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>
                    {parsedData.supplier_name} — Commande {parsedData.order_number || '?'}
                  </h3>
                  <div style={{ color: '#666', fontSize: '14px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    {parsedData.order_date && <span>Date : {parsedData.order_date}</span>}
                    <span>{parsedData.total_items} ligne(s)</span>
                    <span style={{ color: '#10b981' }}>{parsedData.matched_count} matchée(s)</span>
                    {parsedData.unmatched_count > 0 && (
                      <span style={{ color: '#f59e0b' }}>{parsedData.unmatched_count} non matchée(s)</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setParsedData(null); setItems([]); setNewSupplierSkus([]); }}
                  style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', fontSize: '14px' }}
                >
                  ← Nouveau PDF
                </button>
              </div>

              {parsedData.duplicate_warning && (
                <div style={{ marginTop: '12px', background: '#fef3c7', padding: '10px 15px', borderRadius: '6px', color: '#92400e', fontSize: '14px' }}>
                  {parsedData.duplicate_warning}
                </div>
              )}

              {!parsedData.has_price && (
                <div style={{ marginTop: '12px', background: '#dbeafe', padding: '10px 15px', borderRadius: '6px', color: '#1e40af', fontSize: '14px' }}>
                  Ce document ne contient pas de prix. Les prix sont pré-remplis depuis la base fournisseur (modifiables).
                </div>
              )}
            </div>

            {/* Tableau des lignes */}
            <div style={{ background: 'white', borderRadius: '8px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '30px' }}></th>
                    <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600, width: '140px' }}>Ref fournisseur</th>
                    <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600 }}>Designation PDF</th>
                    <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600 }}>Notre produit</th>
                    <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '70px' }}>Stock</th>
                    <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '70px' }}>Qte PDF</th>
                    <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '55px' }}>Pack</th>
                    <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '100px' }}>Qte finale</th>
                    <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '110px' }}>Prix PDF</th>
                    <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '90px' }}>Prix BDD</th>
                    <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '75px' }}>Remise %</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontWeight: 600, width: '100px' }}>Total HT</th>
                    <th style={{ width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    if (item.item_type === 'discount') {
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb', background: '#e5e7eb' }}>
                          <td style={{ padding: '10px', textAlign: 'center' }}>
                            <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#9ca3af' }} />
                          </td>
                          <td colSpan={2} style={{ padding: '10px', fontSize: '13px', color: '#6b7280', fontStyle: 'italic' }}>
                            —
                          </td>
                          <td colSpan={7} style={{ padding: '10px', fontSize: '13px', fontStyle: 'italic', color: '#374151' }}>
                            {item.product_name}
                          </td>
                          <td style={{ padding: '10px', textAlign: 'right', fontSize: '13px', fontWeight: 600, color: '#dc2626' }}>
                            {item.unit_price != null ? item.unit_price.toFixed(2) + ' €' : '-'}
                          </td>
                          <td style={{ padding: '10px', textAlign: 'center' }}>
                            <button
                              onClick={() => handleRemoveItem(idx)}
                              style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '14px' }}
                              title="Retirer cette ligne"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb', background: item.matched ? 'white' : '#fffbeb' }}>
                        {/* Statut */}
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%',
                            background: item.matched ? '#10b981' : '#f59e0b'
                          }} />
                        </td>

                        {/* Ref fournisseur */}
                        <td style={{ padding: '10px', fontSize: '13px' }}>
                          <code>{item.supplier_sku}</code>
                        </td>

                        {/* Designation PDF */}
                        <td style={{ padding: '10px', fontSize: '13px', color: '#666' }}>
                          {item.designation}
                        </td>

                        {/* Notre produit */}
                        <td style={{ padding: '10px', position: 'relative' }}>
                          {item.matched ? (
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 500 }}>{item.product_name}</div>
                              {item.product_sku && (
                                <div style={{ fontSize: '12px', color: '#888' }}>SKU: {item.product_sku}</div>
                              )}
                              <button
                                onClick={() => handleRematch(idx)}
                                style={{ marginTop: '4px', fontSize: '11px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                              >modifier</button>
                            </div>
                          ) : (
                            <div style={{ position: 'relative' }}>
                              <input
                                type="text"
                                placeholder="Rechercher..."
                                value={searchingIdx === idx ? searchTerm : ''}
                                onFocus={() => { setSearchingIdx(idx); setSearchTerm(''); setSearchResults([]); }}
                                onChange={e => handleSearchProduct(e.target.value, idx)}
                                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #f59e0b', fontSize: '13px', background: '#fffbeb' }}
                              />
                              {searchingIdx === idx && searchResults.length > 0 && (
                                <div style={{
                                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
                                  background: 'white', border: '1px solid #ddd', borderRadius: '0 0 6px 6px',
                                  maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                                }}>
                                  {searchResults.map(product => (
                                    <div
                                      key={product.id}
                                      onClick={() => handleMatchProduct(idx, product)}
                                      style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid #eee', fontSize: '13px' }}
                                      onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                                      onMouseLeave={e => e.currentTarget.style.background = 'white'}
                                    >
                                      <div style={{ fontWeight: 500 }}>{product.post_title}</div>
                                      <div style={{ color: '#888', fontSize: '12px' }}>
                                        SKU: {product.sku || '-'} | Stock: {product.stock ?? '-'}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {searchingIdx === idx && searchLoading && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', padding: '8px 10px', fontSize: '13px', color: '#888', border: '1px solid #ddd' }}>
                                  Recherche...
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Stock */}
                        <td style={{ padding: '10px', textAlign: 'center', fontSize: '13px' }}>
                          {item.matched ? (
                            <span style={{ color: item.current_stock <= 0 ? '#dc2626' : 'inherit', fontWeight: 500 }}>
                              {item.current_stock ?? '-'}
                            </span>
                          ) : '-'}
                        </td>

                        {/* Qte PDF */}
                        <td style={{ padding: '10px', textAlign: 'center', fontSize: '13px', color: '#666' }}>
                          {item.qty_from_pdf}
                        </td>

                        {/* Pack */}
                        <td style={{ padding: '10px', textAlign: 'center', fontSize: '13px', color: '#888' }}>
                          {item.pack_qty > 1 ? `x${item.pack_qty}` : '-'}
                        </td>

                        {/* Qte finale (editable) */}
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          <input
                            type="number"
                            min="1"
                            value={item.qty_ordered}
                            onChange={e => handleUpdateQty(idx, e.target.value)}
                            style={{ width: '70px', padding: '6px', borderRadius: '4px', border: '1px solid #ddd', textAlign: 'center', fontSize: '13px' }}
                          />
                        </td>

                        {/* Prix PDF (editable) */}
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.unit_price ?? ''}
                            onChange={e => handleUpdatePrice(idx, e.target.value)}
                            placeholder="—"
                            style={{ width: '85px', padding: '6px', borderRadius: '4px', border: '1px solid #ddd', textAlign: 'center', fontSize: '13px' }}
                          />
                        </td>

                        {/* Prix BDD (lecture seule) */}
                        <td style={{ padding: '10px', textAlign: 'center', fontSize: '13px', color: '#6b7280' }}>
                          {item.supplier_price != null ? item.supplier_price.toFixed(2) + ' €' : '—'}
                        </td>

                        {/* Remise % */}
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            value={item.discount || ''}
                            onChange={e => handleUpdateDiscount(idx, e.target.value)}
                            placeholder="0"
                            style={{ width: '60px', padding: '6px', borderRadius: '4px', border: '1px solid #ddd', textAlign: 'center', fontSize: '13px' }}
                          />
                        </td>

                        {/* Total HT ligne */}
                        <td style={{ padding: '10px', textAlign: 'right', fontSize: '13px', fontWeight: 500 }}>
                          {effectivePrice(item)
                            ? (item.qty_ordered * effectivePrice(item)).toFixed(2) + ' €'
                            : '-'}
                        </td>

                        {/* Supprimer */}
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          <button
                            onClick={() => handleRemoveItem(idx)}
                            style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '14px' }}
                            title="Retirer cette ligne"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totaux */}
            <div style={{ background: 'white', borderRadius: '8px', padding: '15px 20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'flex-end', gap: '30px', fontSize: '15px' }}>
              {discountItems.length > 0 && (
                <>
                  <div>
                    <span style={{ color: '#666' }}>Total HT brut : </span>
                    <span style={{ fontWeight: 600 }}>{totalHtProduits.toFixed(2)} €</span>
                  </div>
                  <div>
                    <span style={{ color: '#666' }}>Total remises : </span>
                    <span style={{ fontWeight: 600, color: '#dc2626' }}>{totalRemises.toFixed(2)} €</span>
                  </div>
                </>
              )}
              <div>
                <span style={{ color: '#666' }}>Total HT : </span>
                <span style={{ fontWeight: 600 }}>{totalHt.toFixed(2)} €</span>
              </div>
              <div>
                <span style={{ color: '#666' }}>Total TTC (20%) : </span>
                <span style={{ fontWeight: 600 }}>{totalTtc.toFixed(2)} €</span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ color: '#666', fontSize: '14px' }}>
                {matchedItems.length} article(s) prêt(s) — {totalQty} unité(s)
                {productItems.filter(i => !i.matched).length > 0 && (
                  <span style={{ color: '#f59e0b', marginLeft: '10px' }}>
                    ({productItems.filter(i => !i.matched).length} ligne(s) non matchée(s) seront ignorées)
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => handleCreateOrder(false)}
                  disabled={creating || matchedItems.length === 0}
                  style={{
                    background: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px',
                    padding: '12px 24px', fontSize: '15px', fontWeight: 500,
                    cursor: creating || matchedItems.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: creating || matchedItems.length === 0 ? 0.6 : 1
                  }}
                >
                  {creating ? 'Création...' : 'Créer la commande'}
                </button>
                <button
                  onClick={() => handleCreateOrder(true)}
                  disabled={creating || matchedItems.length === 0}
                  style={{
                    background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px',
                    padding: '12px 24px', fontSize: '15px', fontWeight: 500,
                    cursor: creating || matchedItems.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: creating || matchedItems.length === 0 ? 0.6 : 1
                  }}
                >
                  {creating ? 'Création...' : 'Créer + Envoyer BMS'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ImportPdfPage;
