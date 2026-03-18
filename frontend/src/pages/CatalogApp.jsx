import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import { formatPrice } from '../utils/formatNumber';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const CatalogApp = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0, hasMore: false });
  const [csvModal, setCsvModal] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [csvMapping, setCsvMapping] = useState({ sku: '', barcode: '' });
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchProducts = async (offset = 0, search = searchTerm) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/products/catalog`, {
        params: { limit: 50, offset, search },
        headers
      });
      if (res.data.success) {
        setProducts(res.data.data);
        setPagination(res.data.pagination);
      }
    } catch (err) {
      console.error('Error fetching catalog:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts(0, '');
  }, []);

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    // Debounce
    clearTimeout(window._catalogSearchTimeout);
    window._catalogSearchTimeout = setTimeout(() => {
      fetchProducts(0, value);
    }, 300);
  };

  const handlePageChange = (newOffset) => {
    fetchProducts(newOffset);
  };

  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  const handleCsvFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const sep = text.includes(';') ? ';' : ',';
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return alert('Le fichier doit contenir au moins un entête et une ligne de données');
      const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map(line => {
        const vals = line.split(sep).map(v => v.trim().replace(/^"|"$/g, ''));
        const obj = {};
        headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
        return obj;
      });
      setCsvHeaders(headers);
      setCsvRows(rows);
      setCsvMapping({ sku: '', barcode: '' });
      setCsvResult(null);
      setCsvModal(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCsvImport = async () => {
    if (!csvMapping.sku || !csvMapping.barcode) return alert('Veuillez mapper les colonnes SKU et Code-barre');
    setCsvImporting(true);
    try {
      const rows = csvRows
        .map(r => ({ sku: r[csvMapping.sku]?.trim(), barcode: r[csvMapping.barcode]?.trim() }))
        .filter(r => r.sku && r.barcode);
      const res = await axios.post(`${API_URL}/products/barcodes/import`, { rows }, { headers });
      if (res.data.success) setCsvResult(res.data.data);
    } catch (err) {
      console.error('CSV import error:', err);
      alert('Erreur lors de l\'import');
    } finally {
      setCsvImporting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#059669',
        padding: '20px 0',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative'
      }}>
        <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        <button
          onClick={() => navigate('/home')}
          style={{
            position: 'absolute',
            left: '20px',
            padding: '10px 20px',
            backgroundColor: '#fff',
            color: '#059669',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            cursor: 'pointer',
            fontWeight: '600'
          }}
        >
          Retour
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '1200px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        <h1 style={{ color: '#059669', marginBottom: '20px' }}>Catalogue Produits</h1>

        {/* Search */}
        <div style={{ marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="Rechercher par nom ou SKU..."
            value={searchTerm}
            onChange={handleSearch}
            style={{
              width: '100%',
              maxWidth: '400px',
              padding: '10px 14px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              outline: 'none'
            }}
          />
          <span style={{ marginLeft: '12px', color: '#6b7280', fontSize: '14px' }}>
            {pagination.total} produit{pagination.total > 1 ? 's' : ''}
          </span>
          <label style={{
            marginLeft: '16px', padding: '8px 16px', backgroundColor: '#fff', color: '#374151',
            border: '1px solid #059669', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'inline-block'
          }}>
            Importer EAN (CSV)
            <input type="file" accept=".csv,.txt" onChange={handleCsvFile} style={{ display: 'none' }} />
          </label>
        </div>

        {/* Table */}
        {loading ? (
          <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px 0' }}>Chargement...</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', width: '50px' }}></th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Produit</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>SKU</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Stock</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Prix</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => navigate(`/products/${p.wp_product_id}`)}
                      style={{
                        borderBottom: '1px solid #e5e7eb',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <td style={{ padding: '8px 12px' }}>
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt=""
                            style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }}
                          />
                        ) : (
                          <div style={{
                            width: '40px',
                            height: '40px',
                            backgroundColor: '#e5e7eb',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#9ca3af',
                            fontSize: '16px'
                          }}>?</div>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: '500' }}>{p.post_title}</td>
                      <td style={{ padding: '8px 12px', color: '#6b7280', fontFamily: 'monospace' }}>{p.sku}</td>
                      <td style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        fontWeight: '600',
                        color: parseInt(p.stock) <= 0 ? '#ef4444' : 'inherit'
                      }}>
                        {parseInt(p.stock) || 0}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        {p.regular_price ? `${formatPrice(p.regular_price)} \u20AC` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
                <button
                  onClick={() => handlePageChange(pagination.offset - pagination.limit)}
                  disabled={pagination.offset === 0}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: pagination.offset === 0 ? '#f3f4f6' : '#fff',
                    cursor: pagination.offset === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '13px'
                  }}
                >
                  Precedent
                </button>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>
                  Page {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(pagination.offset + pagination.limit)}
                  disabled={!pagination.hasMore}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: !pagination.hasMore ? '#f3f4f6' : '#fff',
                    cursor: !pagination.hasMore ? 'not-allowed' : 'pointer',
                    fontSize: '13px'
                  }}
                >
                  Suivant
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal Import CSV */}
      {csvModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }} onClick={() => setCsvModal(false)}>
          <div style={{
            backgroundColor: '#fff', borderRadius: '8px', padding: '24px', maxWidth: '550px', width: '90%', maxHeight: '80vh', overflow: 'auto'
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', color: '#059669' }}>Import codes-barres unitaires</h3>

            <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px' }}>
              {csvRows.length} ligne{csvRows.length > 1 ? 's' : ''} détectée{csvRows.length > 1 ? 's' : ''} — Mappez les colonnes :
            </p>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Colonne SKU</label>
                <select
                  value={csvMapping.sku}
                  onChange={e => setCsvMapping(prev => ({ ...prev, sku: e.target.value }))}
                  style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                >
                  <option value="">-- Sélectionner --</option>
                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Colonne Code-barre</label>
                <select
                  value={csvMapping.barcode}
                  onChange={e => setCsvMapping(prev => ({ ...prev, barcode: e.target.value }))}
                  style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                >
                  <option value="">-- Sélectionner --</option>
                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>

            {/* Aperçu */}
            {csvMapping.sku && csvMapping.barcode && !csvResult && (
              <div style={{ marginBottom: '16px' }}>
                <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>Aperçu (5 premières lignes) :</p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>SKU</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Code-barre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f3f4f6', fontFamily: 'monospace' }}>{r[csvMapping.sku]}</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f3f4f6', fontFamily: 'monospace' }}>{r[csvMapping.barcode]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Résultat */}
            {csvResult && (
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f0fdf4', borderRadius: '6px', fontSize: '13px' }}>
                <p style={{ margin: '0 0 4px', fontWeight: '600', color: '#059669' }}>Import terminé</p>
                <p style={{ margin: '0' }}>{csvResult.inserted} code{csvResult.inserted > 1 ? 's' : ''}-barre{csvResult.inserted > 1 ? 's' : ''} importé{csvResult.inserted > 1 ? 's' : ''}, {csvResult.skipped} ignoré{csvResult.skipped > 1 ? 's' : ''} (doublons)</p>
                {csvResult.errors.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <p style={{ margin: '0 0 4px', color: '#dc2626', fontWeight: '600' }}>{csvResult.errors.length} erreur{csvResult.errors.length > 1 ? 's' : ''} :</p>
                    <div style={{ maxHeight: '120px', overflow: 'auto', fontSize: '12px' }}>
                      {csvResult.errors.map((e, i) => (
                        <div key={i} style={{ color: '#dc2626' }}>SKU "{e.sku}" → {e.reason}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setCsvModal(false)}
                style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px', backgroundColor: '#fff', color: '#374151', fontSize: '13px', cursor: 'pointer' }}
              >Fermer</button>
              {!csvResult && (
                <button
                  onClick={handleCsvImport}
                  disabled={!csvMapping.sku || !csvMapping.barcode || csvImporting}
                  style={{
                    padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                    backgroundColor: csvMapping.sku && csvMapping.barcode && !csvImporting ? '#059669' : '#fff',
                    color: csvMapping.sku && csvMapping.barcode && !csvImporting ? '#fff' : '#9ca3af'
                  }}
                >{csvImporting ? 'Import en cours...' : 'Importer'}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{
        backgroundColor: '#059669',
        padding: '20px 0',
        textAlign: 'center',
        color: 'white'
      }}>
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits reserves</p>
      </div>
    </div>
  );
};

export default CatalogApp;
