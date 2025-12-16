import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_BASE_URL = 'http://54.37.156.233:3000/api';

const CategoriesStatsTab = () => {
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedCategoryName, setExpandedCategoryName] = useState(null);
  const [subCategories, setSubCategories] = useState({});
  const [sortBy, setSortBy] = useState('ca_ttc');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/categories`);
      if (response.data.success) {
        setCategories(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubCategories = async (categoryName) => {
    if (subCategories[categoryName]) return;

    try {
      const response = await axios.get(`${API_BASE_URL}/categories/${encodeURIComponent(categoryName)}`);
      if (response.data.success) {
        setSubCategories(prev => ({
          ...prev,
          [categoryName]: response.data.data.sub_categories || []
        }));
      }
    } catch (error) {
      console.error('Error fetching sub-categories:', error);
    }
  };

  const handleRowClick = (category) => {
    if (category.sub_category_count > 0) {
      if (expandedCategoryName === category.category) {
        setExpandedCategoryName(null);
      } else {
        setExpandedCategoryName(category.category);
        fetchSubCategories(category.category);
      }
    }
  };

  const handleCategoryNameClick = (e, categoryName) => {
    e.stopPropagation();
    navigate(`/categories/${encodeURIComponent(categoryName)}`);
  };

  const handleSubCategoryNameClick = (e, subCategoryName) => {
    e.stopPropagation();
    navigate(`/sub-categories/${encodeURIComponent(subCategoryName)}`);
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
  const filteredCategories = categories.filter(c => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return c.category?.toLowerCase().includes(search);
  });

  const sortedCategories = [...filteredCategories].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];

    if (sortBy === 'category') {
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
      ['Categorie', 'Nb Produits', 'Nb Sous-categories', 'Qte Vendue', 'CA TTC', 'CA HT', 'Cout HT', 'Marge HT', '% Marge'],
      ...sortedCategories.map(c => [
        c.category || '',
        c.product_count || 0,
        c.sub_category_count || 0,
        c.qty_sold || 0,
        parseFloat(c.ca_ttc || 0).toFixed(2),
        parseFloat(c.ca_ht || 0).toFixed(2),
        parseFloat(c.cost_ht || 0).toFixed(2),
        parseFloat(c.margin_ht || 0).toFixed(2),
        parseFloat(c.margin_percent || 0).toFixed(1)
      ])
    ].map(row => row.join(';')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `categories_stats_${new Date().toISOString().split('T')[0]}.csv`;
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

  // Calcul des totaux (sur les categories filtrees)
  const totals = filteredCategories.reduce((acc, c) => ({
    product_count: acc.product_count + (c.product_count || 0),
    sub_category_count: acc.sub_category_count + (c.sub_category_count || 0),
    qty_sold: acc.qty_sold + (c.qty_sold || 0),
    ca_ttc: acc.ca_ttc + parseFloat(c.ca_ttc || 0),
    margin_ht: acc.margin_ht + parseFloat(c.margin_ht || 0)
  }), { product_count: 0, sub_category_count: 0, qty_sold: 0, ca_ttc: 0, margin_ht: 0 });

  return (
    <div>
      {/* Header avec recherche et bouton export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <div style={{ display: 'flex', gap: '15px', flex: 1 }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher une categorie..."
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
          Exporter CSV
        </button>
      </div>

      {/* Cards de statistiques */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px', marginBottom: '30px' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Categories</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#135E84', margin: 0 }}>{filteredCategories.length}{searchTerm && ` / ${categories.length}`}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Sous-categories</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#135E84', margin: 0 }}>{totals.sub_category_count}</p>
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
                  <th style={headerStyle('category')} onClick={() => handleSort('category')}>Categorie{getSortIcon('category')}</th>
                  <th style={headerStyle('product_count')} onClick={() => handleSort('product_count')}>Produits{getSortIcon('product_count')}</th>
                  <th style={headerStyle('sub_category_count')} onClick={() => handleSort('sub_category_count')}>Sous-cat.{getSortIcon('sub_category_count')}</th>
                  <th style={headerStyle('qty_sold')} onClick={() => handleSort('qty_sold')}>Qte Vendue{getSortIcon('qty_sold')}</th>
                  <th style={headerStyle('ca_ttc')} onClick={() => handleSort('ca_ttc')}>CA TTC{getSortIcon('ca_ttc')}</th>
                  <th style={headerStyle('ca_ht')} onClick={() => handleSort('ca_ht')}>CA HT{getSortIcon('ca_ht')}</th>
                  <th style={headerStyle('cost_ht')} onClick={() => handleSort('cost_ht')}>Cout HT{getSortIcon('cost_ht')}</th>
                  <th style={headerStyle('margin_ht')} onClick={() => handleSort('margin_ht')}>Marge HT{getSortIcon('margin_ht')}</th>
                  <th style={headerStyle('margin_percent')} onClick={() => handleSort('margin_percent')}>% Marge{getSortIcon('margin_percent')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedCategories.map((category) => {
                  const isExpanded = expandedCategoryName === category.category;
                  const hasSubCategories = category.sub_category_count > 0;
                  const categorySubCategories = subCategories[category.category] || [];

                  return (
                    <>
                      <tr
                        key={category.category}
                        onClick={() => handleRowClick(category)}
                        style={{
                          borderTop: '1px solid #dee2e6',
                          cursor: hasSubCategories ? 'pointer' : 'default',
                          backgroundColor: isExpanded ? '#f8f9fa' : 'white',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => { if (hasSubCategories) e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'white'; }}
                      >
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {hasSubCategories && (
                              <span style={{ color: '#6c757d', fontSize: '12px' }}>{isExpanded ? '▼' : '▶'}</span>
                            )}
                            <span
                              onClick={(e) => handleCategoryNameClick(e, category.category)}
                              style={{ fontWeight: 'bold', color: '#007bff', cursor: 'pointer' }}
                            >
                              {category.category}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{formatNumber(category.product_count)}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{category.sub_category_count}</td>
                        <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold' }}>{formatNumber(category.qty_sold)}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(category.ca_ttc)}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(category.ca_ht)}</td>
                        <td style={{ padding: '15px', fontSize: '14px', color: '#dc3545' }}>{formatPrice(category.cost_ht)}</td>
                        <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: category.margin_ht >= 0 ? '#28a745' : '#dc3545' }}>{formatPrice(category.margin_ht)}</td>
                        <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: category.margin_percent >= 30 ? '#28a745' : category.margin_percent >= 15 ? '#ffc107' : '#dc3545' }}>
                          {formatPercent(category.margin_percent)}
                        </td>
                      </tr>
                      {isExpanded && categorySubCategories.length > 0 && categorySubCategories.map((sc) => (
                        <tr key={sc.sub_category} style={{ backgroundColor: '#f8f9fa', borderTop: '1px solid #e9ecef' }}>
                          <td style={{ padding: '10px 15px 10px 45px', fontSize: '13px' }}>
                            <span
                              onClick={(e) => handleSubCategoryNameClick(e, sc.sub_category)}
                              style={{ color: '#007bff', cursor: 'pointer' }}
                            >
                              ↳ {sc.sub_category}
                            </span>
                          </td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: '#6c757d' }}>{formatNumber(sc.product_count)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: '#6c757d' }}>-</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatNumber(sc.qty_sold)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sc.ca_ttc)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sc.ca_ht)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: '#dc3545' }}>{formatPrice(sc.cost_ht)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: sc.margin_ht >= 0 ? '#28a745' : '#dc3545' }}>{formatPrice(sc.margin_ht)}</td>
                          <td style={{ padding: '10px 15px', fontSize: '13px', color: sc.margin_percent >= 30 ? '#28a745' : sc.margin_percent >= 15 ? '#ffc107' : '#dc3545' }}>
                            {formatPercent(sc.margin_percent)}
                          </td>
                        </tr>
                      ))}
                      {isExpanded && categorySubCategories.length === 0 && (
                        <tr key={`${category.category}-loading`} style={{ backgroundColor: '#f8f9fa' }}>
                          <td colSpan={9} style={{ padding: '15px 45px', fontSize: '13px', color: '#6c757d' }}>
                            Chargement des sous-categories...
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          {categories.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>
              Aucune categorie trouvee
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CategoriesStatsTab;
