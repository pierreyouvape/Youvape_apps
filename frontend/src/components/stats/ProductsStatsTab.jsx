import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import CopyButton from '../CopyButton';

const API_BASE_URL = 'http://54.37.156.233:3000/api';

const ProductsStatsTab = () => {
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 50,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('qty_sold');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [variations, setVariations] = useState({});

  useEffect(() => {
    fetchProducts();
  }, [pagination.pageIndex, pagination.pageSize, searchTerm, sortBy, sortOrder]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const offset = pagination.pageIndex * pagination.pageSize;
      const response = await axios.get(`${API_BASE_URL}/products/stats-list`, {
        params: {
          limit: pagination.pageSize,
          offset: offset,
          search: searchTerm,
          sortBy: sortBy,
          sortOrder: sortOrder,
        },
      });

      if (response.data.success) {
        setData(response.data.data);
        setTotalCount(response.data.pagination.total);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchVariations = async (productId) => {
    if (variations[productId]) return;

    try {
      const response = await axios.get(`${API_BASE_URL}/products/${productId}/variations-stats`);
      if (response.data.success) {
        setVariations(prev => ({ ...prev, [productId]: response.data.data }));
      }
    } catch (error) {
      console.error('Error fetching variations:', error);
    }
  };

  const handleRowClick = (product) => {
    if (product.product_type === 'variable' && product.variations_count > 0) {
      if (expandedProductId === product.wp_product_id) {
        setExpandedProductId(null);
      } else {
        setExpandedProductId(product.wp_product_id);
        fetchVariations(product.wp_product_id);
      }
    }
  };

  const handleNameClick = (e, productId) => {
    e.stopPropagation();
    navigate(`/products/${productId}`);
  };

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(column);
      setSortOrder('DESC');
    }
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleExport = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/products/stats-list`, {
        params: { limit: 10000, search: searchTerm, sortBy, sortOrder }
      });

      if (response.data.success) {
        const products = response.data.data;
        const csv = [
          ['Nom', 'SKU', 'Stock', 'Vendu', 'CA TTC', 'CA HT', 'Coût HT', 'Marge HT', '% Marge'],
          ...products.map(p => [
            p.post_title || '',
            p.sku || '',
            p.stock || 0,
            p.qty_sold || 0,
            parseFloat(p.ca_ttc || 0).toFixed(2),
            parseFloat(p.ca_ht || 0).toFixed(2),
            parseFloat(p.cost_ht || 0).toFixed(2),
            parseFloat(p.margin_ht || 0).toFixed(2),
            parseFloat(p.margin_percent || 0).toFixed(1)
          ])
        ].map(row => row.join(';')).join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `produits_stats_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (error) {
      console.error('Error exporting:', error);
      alert('Erreur lors de l\'export des données');
    }
  };

  const goToPage = (page) => setPagination((prev) => ({ ...prev, pageIndex: page }));
  const nextPage = () => {
    if (pagination.pageIndex < Math.ceil(totalCount / pagination.pageSize) - 1) {
      setPagination((prev) => ({ ...prev, pageIndex: prev.pageIndex + 1 }));
    }
  };
  const previousPage = () => {
    if (pagination.pageIndex > 0) {
      setPagination((prev) => ({ ...prev, pageIndex: prev.pageIndex - 1 }));
    }
  };

  const canPreviousPage = pagination.pageIndex > 0;
  const canNextPage = pagination.pageIndex < Math.ceil(totalCount / pagination.pageSize) - 1;
  const pageCount = Math.ceil(totalCount / pagination.pageSize);

  const formatPrice = (price) => parseFloat(price || 0).toFixed(2) + ' €';
  const formatPercent = (percent) => parseFloat(percent || 0).toFixed(1) + '%';

  const getSortIcon = (column) => {
    if (sortBy !== column) return '';
    return sortOrder === 'ASC' ? ' ▲' : ' ▼';
  };

  const headerStyle = (column) => ({
    padding: '15px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: '600',
    color: '#6c757d',
    textTransform: 'uppercase',
    cursor: 'pointer',
    userSelect: 'none',
    backgroundColor: sortBy === column ? '#e9ecef' : '#f8f9fa',
    transition: 'background-color 0.2s'
  });

  return (
    <div>
      {/* Header avec filtres */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <div style={{ display: 'flex', gap: '15px', flex: 1 }}>
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Rechercher par nom, SKU..."
            style={{
              padding: '10px 15px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '16px',
              flex: 1,
              minWidth: '250px'
            }}
          />
        </div>
        <button
          onClick={handleExport}
          style={{
            padding: '10px 20px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          📥 Exporter CSV
        </button>
      </div>

      {/* Card de statistique */}
      <div style={{ marginBottom: '30px' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', display: 'inline-block' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Total produits</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', margin: 0 }}>{totalCount}</p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>Chargement...</div>
      ) : (
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...headerStyle('name'), width: '50px', cursor: 'default' }}></th>
                  <th style={headerStyle('name')} onClick={() => handleSort('name')}>Nom{getSortIcon('name')}</th>
                  <th style={headerStyle('sku')} onClick={() => handleSort('sku')}>SKU{getSortIcon('sku')}</th>
                  <th style={headerStyle('stock')} onClick={() => handleSort('stock')}>Stock{getSortIcon('stock')}</th>
                  <th style={headerStyle('qty_sold')} onClick={() => handleSort('qty_sold')}>Vendu{getSortIcon('qty_sold')}</th>
                  <th style={headerStyle('ca_ttc')} onClick={() => handleSort('ca_ttc')}>CA TTC{getSortIcon('ca_ttc')}</th>
                  <th style={headerStyle('ca_ht')} onClick={() => handleSort('ca_ht')}>CA HT{getSortIcon('ca_ht')}</th>
                  <th style={headerStyle('cost_ht')} onClick={() => handleSort('cost_ht')}>Coût HT{getSortIcon('cost_ht')}</th>
                  <th style={headerStyle('margin_ht')} onClick={() => handleSort('margin_ht')}>Marge HT{getSortIcon('margin_ht')}</th>
                  <th style={headerStyle('margin_percent')} onClick={() => handleSort('margin_percent')}>% Marge{getSortIcon('margin_percent')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((product) => {
                  const isExpanded = expandedProductId === product.wp_product_id;
                  const hasVariations = product.product_type === 'variable' && product.variations_count > 0;
                  const productVariations = variations[product.wp_product_id] || [];

                  return (
                    <>
                      <tr
                        key={product.wp_product_id}
                        onClick={() => handleRowClick(product)}
                        style={{
                          borderTop: '1px solid #dee2e6',
                          cursor: hasVariations ? 'pointer' : 'default',
                          backgroundColor: isExpanded ? '#f8f9fa' : 'white',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => { if (hasVariations) e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'white'; }}
                      >
                        <td style={{ padding: '8px 10px', width: '50px' }}>
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt=""
                              style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }}
                            />
                          ) : (
                            <div style={{ width: '40px', height: '40px', backgroundColor: '#f0f0f0', borderRadius: '4px' }} />
                          )}
                        </td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {hasVariations && (
                              <span style={{ color: '#6c757d', fontSize: '12px' }}>{isExpanded ? '▼' : '▶'}</span>
                            )}
                            <span
                              onClick={(e) => handleNameClick(e, product.wp_product_id)}
                              style={{ fontWeight: 'bold', color: '#007bff', cursor: 'pointer' }}
                            >
                              {product.post_title}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '15px', fontSize: '14px', color: '#6c757d' }}>
                          {product.sku || '-'}
                          {product.sku && <CopyButton text={product.sku} size={12} />}
                        </td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            backgroundColor: product.stock > 10 ? '#d1e7dd' : product.stock > 0 ? '#fff3cd' : '#f8d7da',
                            color: product.stock > 10 ? '#0f5132' : product.stock > 0 ? '#856404' : '#721c24'
                          }}>
                            {product.stock}
                          </span>
                        </td>
                        <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold' }}>{product.qty_sold}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(product.ca_ttc)}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(product.ca_ht)}</td>
                        <td style={{ padding: '15px', fontSize: '14px', color: '#dc3545' }}>{formatPrice(product.cost_ht)}</td>
                        <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: '#28a745' }}>{formatPrice(product.margin_ht)}</td>
                        <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: product.margin_percent >= 30 ? '#28a745' : product.margin_percent >= 15 ? '#ffc107' : '#dc3545' }}>
                          {formatPercent(product.margin_percent)}
                        </td>
                      </tr>
                      {isExpanded && productVariations.length > 0 && productVariations.map((variation) => (
                        <tr key={variation.wp_product_id} style={{ backgroundColor: '#f8f9fa', borderTop: '1px solid #e9ecef' }}>
                          <td style={{ padding: '8px 10px', width: '50px' }}></td>
                          <td style={{ padding: '10px 15px 10px 15px', fontSize: '13px', color: '#6c757d' }}>
                            ↳ {variation.post_title}
                          </td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: '#6c757d' }}>
                            {variation.sku || '-'}
                            {variation.sku && <CopyButton text={variation.sku} size={11} />}
                          </td>
                          <td style={{ padding: '10px 15px', fontSize: '13px' }}>
                            <span style={{
                              padding: '3px 8px',
                              borderRadius: '10px',
                              fontSize: '11px',
                              fontWeight: 'bold',
                              backgroundColor: variation.stock > 10 ? '#d1e7dd' : variation.stock > 0 ? '#fff3cd' : '#f8d7da',
                              color: variation.stock > 10 ? '#0f5132' : variation.stock > 0 ? '#856404' : '#721c24'
                            }}>
                              {variation.stock}
                            </span>
                          </td>
                          <td style={{ padding: '10px 15px', fontSize: '13px' }}>{variation.qty_sold}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(variation.ca_ttc)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(variation.ca_ht)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: '#dc3545' }}>{formatPrice(variation.cost_ht)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: '#28a745' }}>{formatPrice(variation.margin_ht)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: variation.margin_percent >= 30 ? '#28a745' : variation.margin_percent >= 15 ? '#ffc107' : '#dc3545' }}>
                            {formatPercent(variation.margin_percent)}
                          </td>
                        </tr>
                      ))}
                      {isExpanded && productVariations.length === 0 && (
                        <tr key={`${product.wp_product_id}-loading`} style={{ backgroundColor: '#f8f9fa' }}>
                          <td colSpan={10} style={{ padding: '15px 45px', fontSize: '13px', color: '#6c757d' }}>
                            Chargement des variations...
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>
              Aucun produit trouvé
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!loading && data.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', backgroundColor: 'white', padding: '15px 20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => goToPage(0)} disabled={!canPreviousPage} style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', backgroundColor: canPreviousPage ? 'white' : '#f8f9fa', cursor: canPreviousPage ? 'pointer' : 'not-allowed', fontSize: '14px' }}>{'<<'}</button>
            <button onClick={previousPage} disabled={!canPreviousPage} style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', backgroundColor: canPreviousPage ? 'white' : '#f8f9fa', cursor: canPreviousPage ? 'pointer' : 'not-allowed', fontSize: '14px' }}>{'<'}</button>
            <button onClick={nextPage} disabled={!canNextPage} style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', backgroundColor: canNextPage ? 'white' : '#f8f9fa', cursor: canNextPage ? 'pointer' : 'not-allowed', fontSize: '14px' }}>{'>'}</button>
            <button onClick={() => goToPage(pageCount - 1)} disabled={!canNextPage} style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', backgroundColor: canNextPage ? 'white' : '#f8f9fa', cursor: canNextPage ? 'pointer' : 'not-allowed', fontSize: '14px' }}>{'>>'}</button>
          </div>
          <div style={{ fontSize: '14px', color: '#6c757d' }}>
            Page <strong>{pagination.pageIndex + 1}</strong> sur <strong>{pageCount}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '14px', color: '#6c757d' }}>Afficher:</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => setPagination((prev) => ({ ...prev, pageSize: Number(e.target.value), pageIndex: 0 }))}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            >
              {[25, 50, 100, 200].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductsStatsTab;
