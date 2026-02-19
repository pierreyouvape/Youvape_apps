import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_BASE_URL = 'http://54.37.156.233:3000/api';

const BrandsStatsTab = () => {
  const navigate = useNavigate();
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedBrandName, setExpandedBrandName] = useState(null);
  const [subBrands, setSubBrands] = useState({});
  const [sortBy, setSortBy] = useState('ca_ttc');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchBrands();
  }, []);

  const fetchBrands = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/brands`);
      if (response.data.success) {
        setBrands(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching brands:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubBrands = async (brandName) => {
    if (subBrands[brandName]) return;

    try {
      const response = await axios.get(`${API_BASE_URL}/brands/${encodeURIComponent(brandName)}`);
      if (response.data.success) {
        setSubBrands(prev => ({
          ...prev,
          [brandName]: response.data.data.sub_brands || []
        }));
      }
    } catch (error) {
      console.error('Error fetching sub-brands:', error);
    }
  };

  const handleRowClick = (brand) => {
    if (brand.sub_brand_count > 0) {
      if (expandedBrandName === brand.brand) {
        setExpandedBrandName(null);
      } else {
        setExpandedBrandName(brand.brand);
        fetchSubBrands(brand.brand);
      }
    }
  };

  const handleBrandNameClick = (e, brandName) => {
    e.stopPropagation();
    navigate(`/brands/${encodeURIComponent(brandName)}`);
  };

  const handleSubBrandNameClick = (e, subBrandName) => {
    e.stopPropagation();
    navigate(`/sub-brands/${encodeURIComponent(subBrandName)}`);
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(column);
      setSortOrder('DESC');
    }
  };

  // Filtrer par recherche
  const filteredBrands = brands.filter(b => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return b.brand?.toLowerCase().includes(search);
  });

  const sortedBrands = [...filteredBrands].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];

    if (sortBy === 'brand') {
      aVal = aVal?.toLowerCase() || '';
      bVal = bVal?.toLowerCase() || '';
    } else {
      aVal = parseFloat(aVal) || 0;
      bVal = parseFloat(bVal) || 0;
    }

    if (sortOrder === 'ASC') {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });

  const handleExport = () => {
    const csv = [
      ['Marque', 'Nb Produits', 'Nb Sous-marques', 'Qte Vendue', 'CA TTC', 'CA HT', 'Cout HT', 'Marge HT', '% Marge'],
      ...sortedBrands.map(b => [
        b.brand || '',
        b.product_count || 0,
        b.sub_brand_count || 0,
        b.qty_sold || 0,
        parseFloat(b.ca_ttc || 0).toFixed(2),
        parseFloat(b.ca_ht || 0).toFixed(2),
        parseFloat(b.cost_ht || 0).toFixed(2),
        parseFloat(b.margin_ht || 0).toFixed(2),
        parseFloat(b.margin_percent || 0).toFixed(1)
      ])
    ].map(row => row.join(';')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `marques_stats_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const formatPrice = (price) => parseFloat(price || 0).toFixed(2) + ' €';
  const formatPercent = (percent) => parseFloat(percent || 0).toFixed(1) + '%';
  const formatNumber = (num) => new Intl.NumberFormat('fr-FR').format(num || 0);

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

  // Calcul des totaux (sur les marques filtrées)
  const totals = filteredBrands.reduce((acc, b) => ({
    product_count: acc.product_count + (b.product_count || 0),
    sub_brand_count: acc.sub_brand_count + (b.sub_brand_count || 0),
    qty_sold: acc.qty_sold + (b.qty_sold || 0),
    ca_ttc: acc.ca_ttc + parseFloat(b.ca_ttc || 0),
    margin_ht: acc.margin_ht + parseFloat(b.margin_ht || 0)
  }), { product_count: 0, sub_brand_count: 0, qty_sold: 0, ca_ttc: 0, margin_ht: 0 });

  return (
    <div>
      {/* Header avec recherche et bouton export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <div style={{ display: 'flex', gap: '15px', flex: 1 }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher une marque..."
            style={{
              padding: '10px 15px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '16px',
              flex: 1,
              minWidth: '250px',
              maxWidth: '400px'
            }}
          />
        </div>
        <button
          onClick={handleExport}
          style={{
            padding: '6px 12px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          CSV
        </button>
      </div>

      {/* Cards de statistiques */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px', marginBottom: '30px' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Marques</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#135E84', margin: 0 }}>{filteredBrands.length}{searchTerm && ` / ${brands.length}`}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Sous-marques</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#135E84', margin: 0 }}>{totals.sub_brand_count}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Qte vendue</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', margin: 0 }}>{formatNumber(totals.qty_sold)}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>CA TTC Total</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#28a745', margin: 0 }}>{formatPrice(totals.ca_ttc)}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Marge HT Totale</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: totals.margin_ht >= 0 ? '#28a745' : '#dc3545', margin: 0 }}>{formatPrice(totals.margin_ht)}</p>
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
                  <th style={headerStyle('brand')} onClick={() => handleSort('brand')}>Marque{getSortIcon('brand')}</th>
                  <th style={headerStyle('product_count')} onClick={() => handleSort('product_count')}>Produits{getSortIcon('product_count')}</th>
                  <th style={headerStyle('sub_brand_count')} onClick={() => handleSort('sub_brand_count')}>Sous-marques{getSortIcon('sub_brand_count')}</th>
                  <th style={headerStyle('qty_sold')} onClick={() => handleSort('qty_sold')}>Qte Vendue{getSortIcon('qty_sold')}</th>
                  <th style={headerStyle('ca_ttc')} onClick={() => handleSort('ca_ttc')}>CA TTC{getSortIcon('ca_ttc')}</th>
                  <th style={headerStyle('ca_ht')} onClick={() => handleSort('ca_ht')}>CA HT{getSortIcon('ca_ht')}</th>
                  <th style={headerStyle('cost_ht')} onClick={() => handleSort('cost_ht')}>Cout HT{getSortIcon('cost_ht')}</th>
                  <th style={headerStyle('margin_ht')} onClick={() => handleSort('margin_ht')}>Marge HT{getSortIcon('margin_ht')}</th>
                  <th style={headerStyle('margin_percent')} onClick={() => handleSort('margin_percent')}>% Marge{getSortIcon('margin_percent')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedBrands.map((brand) => {
                  const isExpanded = expandedBrandName === brand.brand;
                  const hasSubBrands = brand.sub_brand_count > 0;
                  const brandSubBrands = subBrands[brand.brand] || [];

                  return (
                    <>
                      <tr
                        key={brand.brand}
                        onClick={() => handleRowClick(brand)}
                        style={{
                          borderTop: '1px solid #dee2e6',
                          cursor: hasSubBrands ? 'pointer' : 'default',
                          backgroundColor: isExpanded ? '#f8f9fa' : 'white',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => { if (hasSubBrands) e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'white'; }}
                      >
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {hasSubBrands && (
                              <span style={{ color: '#6c757d', fontSize: '12px' }}>{isExpanded ? '▼' : '▶'}</span>
                            )}
                            <span
                              onClick={(e) => handleBrandNameClick(e, brand.brand)}
                              style={{ fontWeight: 'bold', color: '#007bff', cursor: 'pointer' }}
                            >
                              {brand.brand}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{formatNumber(brand.product_count)}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{brand.sub_brand_count}</td>
                        <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold' }}>{formatNumber(brand.qty_sold)}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(brand.ca_ttc)}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(brand.ca_ht)}</td>
                        <td style={{ padding: '15px', fontSize: '14px', color: '#dc3545' }}>{formatPrice(brand.cost_ht)}</td>
                        <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: brand.margin_ht >= 0 ? '#28a745' : '#dc3545' }}>{formatPrice(brand.margin_ht)}</td>
                        <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: brand.margin_percent >= 30 ? '#28a745' : brand.margin_percent >= 15 ? '#ffc107' : '#dc3545' }}>
                          {formatPercent(brand.margin_percent)}
                        </td>
                      </tr>
                      {isExpanded && brandSubBrands.length > 0 && brandSubBrands.map((sb) => (
                        <tr key={sb.sub_brand} style={{ backgroundColor: '#f8f9fa', borderTop: '1px solid #e9ecef' }}>
                          <td style={{ padding: '10px 15px 10px 45px', fontSize: '13px' }}>
                            <span
                              onClick={(e) => handleSubBrandNameClick(e, sb.sub_brand)}
                              style={{ color: '#007bff', cursor: 'pointer' }}
                            >
                              ↳ {sb.sub_brand}
                            </span>
                          </td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: '#6c757d' }}>{formatNumber(sb.product_count)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: '#6c757d' }}>-</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatNumber(sb.qty_sold)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sb.ca_ttc)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sb.ca_ht)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: '#dc3545' }}>{formatPrice(sb.cost_ht)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: sb.margin_ht >= 0 ? '#28a745' : '#dc3545' }}>{formatPrice(sb.margin_ht)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: sb.margin_percent >= 30 ? '#28a745' : sb.margin_percent >= 15 ? '#ffc107' : '#dc3545' }}>
                            {formatPercent(sb.margin_percent)}
                          </td>
                        </tr>
                      ))}
                      {isExpanded && brandSubBrands.length === 0 && (
                        <tr key={`${brand.brand}-loading`} style={{ backgroundColor: '#f8f9fa' }}>
                          <td colSpan={9} style={{ padding: '15px 45px', fontSize: '13px', color: '#6c757d' }}>
                            Chargement des sous-marques...
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          {brands.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>
              Aucune marque trouvee
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BrandsStatsTab;
