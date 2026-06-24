import CloudLogo from '../components/CloudLogo';
import { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import { formatPrice } from '../utils/formatNumber';
import { LinkBox, LinkTr } from '../utils/navHelpers';
import AppShell from '../components/AppShell';
import CopyButton from '../components/CopyButton';
import { useIsMobile } from '../hooks/useIsMobile';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const decodeHtml = (str) => {
  if (!str || typeof str !== 'string') return str || '';
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
};

const fmtPrice = (v) => {
  const n = parseFloat(v);
  if (!n && n !== 0) return '-';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtPct = (v) => {
  const n = parseFloat(v);
  if (isNaN(n)) return '-';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
};

const fmtWeight = (v) => {
  const n = parseFloat(v);
  if (!n) return '-';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const fmtInt = (v) => parseInt(v) || 0;

// Style pour les chiffres : 0 en rouge, le reste en noir
const numStyle = (v) => {
  const n = parseFloat(v) || 0;
  return { color: n === 0 ? '#ef4444' : '#111827' };
};

const STOCK_TABS = [
  { key: 'all',        label: 'Tout' },
  { key: 'instock',    label: 'En stock' },
  { key: 'outofstock', label: 'Rupture de stock' },
  { key: 'restock',    label: 'À réapprovisionner' },
];

const CATALOG_COLUMNS = [
  { key: 'price',       label: 'Prix TTC' },
  { key: 'cost_price',  label: 'Coût HT' },
  { key: 'margin',      label: 'Marge %' },
  { key: 'weight',      label: 'Poids' },
  { key: 'stock',       label: 'Stock' },
  { key: 'incoming_qty',label: 'Arrivages' },
  { key: 'sales_30d',   label: 'Ventes 30j' },
];

const CatalogApp = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();
  const [parents, setParents] = useState([]);
  const [variations, setVariations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0, hasMore: false });

  // Préférences colonnes
  const [hiddenColumns, setHiddenColumns] = useState([]);
  const [compact, setCompact] = useState(false);
  const isMobile = useIsMobile();
  const controlsRef = useRef(null);
  const [controlsHeight, setControlsHeight] = useState(0);

  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      setControlsHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [showColumnPanel, setShowColumnPanel] = useState(false);

  // Onglet statut de stock (équivalent onglets ATUM Stock Central)
  const [stockTab, setStockTab] = useState('all');

  // Tri colonnes (prix, coût, stock, ...)
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  // Filtre marque
  const [selectedBrand, setSelectedBrand] = useState('');
  const [brandsList, setBrandsList] = useState([]);

  // 0 = normaux seulement, 1 = tous (normaux + masqués), 2 = masqués seulement
  const [showHidden, setShowHidden] = useState(0);

  // CSV import state
  const [csvModal, setCsvModal] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [csvMapping, setCsvMapping] = useState({ sku: '', barcode: '' });
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchProducts = async (offset = 0, search = searchTerm, tab = stockTab, sort = sortBy, dir = sortDir, brandVal = selectedBrand, hidden = showHidden) => {
    setLoading(true);
    try {
      const brandParam = brandVal && brandVal.startsWith('brand:') ? brandVal.slice(6) : undefined;
      const subBrandParam = brandVal && brandVal.startsWith('subBrand:') ? brandVal.slice(9) : undefined;
      const res = await axios.get(`${API_URL}/products/catalog`, {
        params: { limit: 50, offset, search, stockTab: tab, sortBy: sort || undefined, sortDir: dir, brand: brandParam, subBrand: subBrandParam, showHidden: hidden === 1 ? 'true' : hidden === 2 ? 'only' : undefined },
        headers
      });
      if (res.data.success) {
        setParents(res.data.data.parents);
        setVariations(res.data.data.variations);
        setPagination(res.data.pagination);
      }
    } catch (err) {
      console.error('Error fetching catalog:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      let tab = 'all';
      try {
        const [prefsRes, brandsRes] = await Promise.all([
          axios.get(`${API_URL}/preferences/catalog`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_URL}/products/catalog-brands`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (prefsRes.data.success) {
          setHiddenColumns(prefsRes.data.hiddenColumns || []);
          setCompact(prefsRes.data.compact || false);
          tab = prefsRes.data.stockTab || 'all';
          setStockTab(tab);
        }
        if (brandsRes.data.success) {
          setBrandsList(brandsRes.data.data || []);
        }
      } catch (err) {
        console.error('Erreur chargement préférences colonnes catalog:', err);
      }
      fetchProducts(0, '', tab);
    };
    if (token) load();
  }, [token]);

  const handleStockTabChange = (tab) => {
    setStockTab(tab);
    savePreferences(hiddenColumns, compact, tab);
    fetchProducts(0, searchTerm, tab, sortBy, sortDir, selectedBrand);
  };

  const handleSort = (column) => {
    const nextDir = (sortBy === column && sortDir === 'desc') ? 'asc' : 'desc';
    setSortBy(column);
    setSortDir(nextDir);
    fetchProducts(0, searchTerm, stockTab, column, nextDir, selectedBrand);
  };

  const handleBrandChange = (brand) => {
    setSelectedBrand(brand);
    fetchProducts(0, searchTerm, stockTab, sortBy, sortDir, brand, showHidden);
  };

  const handleShowHiddenToggle = () => {
    const next = (showHidden + 1) % 3;
    setShowHidden(next);
    fetchProducts(0, searchTerm, stockTab, sortBy, sortDir, selectedBrand, next);
  };

  const savePreferences = async (cols, cmp, tab = stockTab) => {
    try {
      await axios.put(`${API_URL}/preferences/catalog`, { hiddenColumns: cols, compact: cmp, stockTab: tab }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.error('Erreur sauvegarde préférences colonnes catalog:', err);
    }
  };

  const toggleColumn = (key) => {
    const next = hiddenColumns.includes(key)
      ? hiddenColumns.filter(k => k !== key)
      : [...hiddenColumns, key];
    setHiddenColumns(next);
    savePreferences(next, compact);
  };

  const toggleCompact = () => {
    const next = !compact;
    setCompact(next);
    savePreferences(hiddenColumns, next);
  };

  const isVisible = (key) => !hiddenColumns.includes(key);

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    clearTimeout(window._catalogSearchTimeout);
    window._catalogSearchTimeout = setTimeout(() => {
      fetchProducts(0, value);
    }, 300);
  };

  const handlePageChange = (newOffset) => {
    fetchProducts(newOffset);
  };

  // Grouper les produits : variations sous leur parent, simples seuls
  const flatRows = useMemo(() => {
    const rows = [];
    const variationsByParent = new Map();

    for (const v of variations) {
      if (!variationsByParent.has(v.wp_parent_id)) {
        variationsByParent.set(v.wp_parent_id, []);
      }
      variationsByParent.get(v.wp_parent_id).push(v);
    }

    for (const p of parents) {
      const parentTitle = decodeHtml(p.post_title);
      if (p.product_type === 'variable') {
        const children = variationsByParent.get(p.wp_product_id) || [];
        const totalStock = children.reduce((s, c) => s + (parseInt(c.stock) || 0), 0);
        const totalIncoming = children.reduce((s, c) => s + (parseInt(c.incoming_qty) || 0), 0);
        const totalSales = children.reduce((s, c) => s + (parseInt(c.sales_30d) || 0), 0);

        // Parent header row
        rows.push({
          _isParent: true,
          wp_product_id: p.wp_product_id,
          post_title: parentTitle,
          image_url: p.image_url,
          sku: p.sku,
          price: null,
          cost_price: null,
          weight: null,
          stock: totalStock,
          incoming_qty: totalIncoming,
          sales_30d: totalSales
        });

        // Variation rows
        for (const child of children) {
          const childTitle = decodeHtml(child.post_title);
          rows.push({
            ...child,
            _isParent: false,
            _isVariation: true,
            // Strip parent title from variation name
            _displayName: childTitle.replace(parentTitle + ' - ', '').replace(parentTitle, '') || childTitle
          });
        }
      } else {
        // Simple product
        rows.push({
          ...p,
          _isParent: false,
          _isVariation: false,
          post_title: parentTitle,
          _displayName: parentTitle
        });
      }
    }
    return rows;
  }, [parents, variations]);

  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  // Export catalogue
  const [exporting, setExporting] = useState(null);

  const handleExport = async (format) => {
    setExporting(format);
    try {
      const res = await axios.get(`${API_URL}/products/catalog/export`, {
        params: { format, search: searchTerm, stockTab },
        headers,
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', format === 'xlsx' ? 'catalogue.xls' : 'catalogue.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert("Erreur lors de l'export");
    } finally {
      setExporting(null);
    }
  };

  // CSV handling
  const handleCsvFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const sep = text.includes(';') ? ';' : ',';
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return alert('Le fichier doit contenir au moins un entete et une ligne de donnees');
      const hdrs = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map(line => {
        const vals = line.split(sep).map(v => v.trim().replace(/^"|"$/g, ''));
        const obj = {};
        hdrs.forEach((h, i) => { obj[h] = vals[i] || ''; });
        return obj;
      });
      setCsvHeaders(hdrs);
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
      alert("Erreur lors de l'import");
    } finally {
      setCsvImporting(false);
    }
  };

  // Calcul marge %
  const calcMargin = (price, costPrice) => {
    const p = parseFloat(price);
    const c = parseFloat(costPrice);
    if (!p || !c) return null;
    return ((p - c) / p) * 100;
  };

  const cellStyle = { padding: '10px 12px', fontSize: '13px' };
  const cellRight = { ...cellStyle, textAlign: 'right', fontFamily: 'monospace' };
  const headerStyle = { padding: '10px 12px', textAlign: 'left', fontSize: '13px', fontWeight: '600', position: 'sticky', top: controlsHeight, zIndex: 20, backgroundColor: '#f3f4f6', borderBottom: '2px solid #e5e7eb' };
  const headerRight = { ...headerStyle, textAlign: 'right' };
  const headerSortable = { ...headerRight, cursor: 'pointer', userSelect: 'none' };

  const SortableHeader = ({ column, label }) => (
    <th style={headerSortable} onClick={() => handleSort(column)}>
      {label}{sortBy === column ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
    </th>
  );

  return (
    <AppShell currentPath="/catalog">
    <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#059669',
        padding: '20px 0',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative'
      }}>
        <CloudLogo />
        <LinkBox
          to="/home"
          display="inline-block"
          style={{
            position: 'absolute',
            left: '20px',
            padding: '10px 20px',
            backgroundColor: '#fff',
            color: '#059669',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600'
          }}
        >
          Retour
        </LinkBox>
      </div>

      {/* Main Content */}
      <div style={isMobile
        ? { flex: 1, margin: '16px auto', padding: '0 10px', width: '100%' }
        : compact
          ? { flex: 1, maxWidth: '1400px', margin: '30px auto', padding: '0 20px', width: '100%' }
          : { flex: 1, margin: '30px 0', padding: '0 60px', width: '100%' }}>
        <div ref={controlsRef} style={{ position: 'sticky', top: 0, zIndex: 30, backgroundColor: '#f5f5f5', paddingTop: '1px' }}>
        <h1 style={{ color: '#059669', marginBottom: '20px' }}>Catalogue Produits</h1>

        {/* Onglets statut de stock */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '2px solid #e5e7eb' }}>
          {STOCK_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleStockTabChange(tab.key)}
              style={{
                padding: '10px 18px',
                border: 'none',
                borderBottom: stockTab === tab.key ? '3px solid #059669' : '3px solid transparent',
                backgroundColor: 'transparent',
                color: stockTab === tab.key ? '#059669' : '#6b7280',
                fontSize: '14px',
                fontWeight: stockTab === tab.key ? '600' : '500',
                cursor: 'pointer',
                marginBottom: '-2px'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search + CSV */}
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
            {pagination.totalWithVariations ?? pagination.total} produit{(pagination.totalWithVariations ?? pagination.total) > 1 ? 's' : ''}
          </span>
          {pagination.totalStockValue != null && (
            <span style={{
              marginLeft: '16px', padding: '4px 12px',
              backgroundColor: '#f0fdf4', color: '#065f46',
              border: '1px solid #bbf7d0', borderRadius: '20px',
              fontSize: '13px', fontWeight: '600'
            }}>
              Valeur stock HT : {pagination.totalStockValue.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
            </span>
          )}
          <label style={{
            marginLeft: '16px', padding: '8px 16px', backgroundColor: '#fff', color: '#374151',
            border: '1px solid #059669', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'inline-block'
          }}>
            Importer EAN (CSV)
            <input type="file" accept=".csv,.txt" onChange={handleCsvFile} style={{ display: 'none' }} />
          </label>
          <button
            onClick={() => handleExport('csv')}
            disabled={exporting !== null}
            style={{
              marginLeft: '8px', padding: '8px 16px', backgroundColor: '#fff', color: '#374151',
              border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '600',
              cursor: exporting !== null ? 'wait' : 'pointer', opacity: exporting === 'csv' ? 0.6 : 1
            }}
          >
            {exporting === 'csv' ? 'Export...' : 'Export CSV'}
          </button>
          <button
            onClick={() => handleExport('xlsx')}
            disabled={exporting !== null}
            style={{
              marginLeft: '8px', padding: '8px 16px', backgroundColor: '#fff', color: '#374151',
              border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '600',
              cursor: exporting !== null ? 'wait' : 'pointer', opacity: exporting === 'xlsx' ? 0.6 : 1
            }}
          >
            {exporting === 'xlsx' ? 'Export...' : 'Export XLS'}
          </button>
          <div style={{ position: 'relative', marginLeft: '12px', display: 'inline-block' }}>
            <button
              onClick={() => setShowColumnPanel(p => !p)}
              style={{
                padding: '8px 16px', backgroundColor: '#fff', color: '#374151',
                border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px',
                fontWeight: '600', cursor: 'pointer'
              }}
            >
              ⚙ Colonnes
            </button>
            {showColumnPanel && (
              <div style={{
                position: 'absolute', left: 0, top: '110%', zIndex: 100,
                backgroundColor: '#fff', border: '1px solid #d1d5db',
                borderRadius: '8px', padding: '14px 16px', minWidth: '180px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)'
              }}>
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px', color: '#374151' }}>
                  Colonnes visibles
                </div>
                {CATALOG_COLUMNS.map(col => (
                  <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', cursor: 'pointer', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={isVisible(col.key)}
                      onChange={() => toggleColumn(col.key)}
                    />
                    {col.label}
                  </label>
                ))}
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '10px', paddingTop: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={compact}
                      onChange={toggleCompact}
                    />
                    Vue compacte
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Filtre marque */}
          <select
            value={selectedBrand}
            onChange={e => handleBrandChange(e.target.value)}
            style={{
              marginLeft: '12px', padding: '8px 12px', backgroundColor: '#fff', color: selectedBrand ? '#059669' : '#374151',
              border: selectedBrand ? '1px solid #059669' : '1px solid #d1d5db',
              borderRadius: '6px', fontSize: '13px', fontWeight: selectedBrand ? '600' : '500',
              cursor: 'pointer', maxWidth: '180px'
            }}
          >
            <option value="">Toutes les marques</option>
            {brandsList.map(item => (
              item.type === 'brand'
                ? <option key={`brand:${item.value}`} value={`brand:${item.value}`}>{item.value}</option>
                : <option key={`subBrand:${item.value}`} value={`subBrand:${item.value}`}>&nbsp;&nbsp;↳ {item.value}</option>
            ))}
          </select>

          {/* Toggle produits masqués — 3 états */}
          <button
            onClick={handleShowHiddenToggle}
            style={{
              marginLeft: '12px', padding: '8px 16px',
              backgroundColor: showHidden === 2 ? '#fff7ed' : showHidden === 1 ? '#fef3c7' : '#fff',
              color: showHidden === 2 ? '#9a3412' : showHidden === 1 ? '#92400e' : '#6b7280',
              border: showHidden === 2 ? '1px solid #ea580c' : showHidden === 1 ? '1px solid #f59e0b' : '1px solid #d1d5db',
              borderRadius: '6px', fontSize: '13px', fontWeight: showHidden > 0 ? '600' : '500',
              cursor: 'pointer'
            }}
          >
            {showHidden === 2 ? '👁 Masqués seuls' : showHidden === 1 ? '👁 + masqués' : '👁 Afficher masqués'}
          </button>
        </div>
        </div>

        {/* Table */}
        {loading ? (
          <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px 0' }}>Chargement...</p>
        ) : (
          <>
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ ...headerStyle, width: '40px' }}></th>
                    <th style={headerStyle}>Nom</th>
                    <th style={headerStyle}>SKU</th>
                    {isVisible('price') && <SortableHeader column="price" label="Prix TTC" />}
                    {isVisible('cost_price') && <SortableHeader column="cost_price" label="Coût HT" />}
                    {isVisible('margin') && <SortableHeader column="margin" label="Marge %" />}
                    {isVisible('weight') && <SortableHeader column="weight" label="Poids" />}
                    {isVisible('stock') && <SortableHeader column="stock" label="Stock" />}
                    {isVisible('incoming_qty') && <SortableHeader column="incoming_qty" label="Arrivages" />}
                    {isVisible('sales_30d') && <SortableHeader column="sales_30d" label="Ventes 30j" />}
                  </tr>
                </thead>
                <tbody>
                  {(() => { let varIdx = 0; let simpleIdx = 0; return flatRows.map((row, idx) => {
                    if (row._isParent) { varIdx = 0; }
                    else if (row._isVariation) { varIdx++; }
                    else { simpleIdx++; }
                    if (row._isParent) {
                      // Parent header row
                      return (
                        <tr key={`parent-${row.wp_product_id}`} style={{ backgroundColor: '#135E84', color: '#ffffff', fontWeight: 600 }}>
                          <td style={cellStyle}>
                            {row.image_url ? (
                              <img src={row.image_url} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                            ) : (
                              <div style={{ width: '40px', height: '40px', backgroundColor: '#1e6fa0', borderRadius: '4px' }} />
                            )}
                          </td>
                          <td style={cellStyle}>
                            <a
                              href={`/products/${row.wp_product_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#ffffff', textDecoration: 'none' }}
                              onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                              onMouseLeave={e => e.target.style.textDecoration = 'none'}
                            >
                              {row.post_title}
                            </a>
                          </td>
                          <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                            {row.sku ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                                {row.sku}
                                <CopyButton text={String(row.sku)} size={12} />
                              </span>
                            ) : '-'}
                          </td>
                          {isVisible('price') && <td style={cellRight}></td>}
                          {isVisible('cost_price') && <td style={cellRight}></td>}
                          {isVisible('margin') && <td style={cellRight}></td>}
                          {isVisible('weight') && <td style={cellRight}></td>}
                          {isVisible('stock') && <td style={{ ...cellRight, fontWeight: 600 }}>{fmtInt(row.stock)}</td>}
                          {isVisible('incoming_qty') && <td style={{ ...cellRight, fontWeight: 600 }}>{fmtInt(row.incoming_qty)}</td>}
                          {isVisible('sales_30d') && <td style={{ ...cellRight, fontWeight: 600 }}>{fmtInt(row.sales_30d)}</td>}
                        </tr>
                      );
                    }

                    const margin = calcMargin(row.price, row.cost_price);

                    const varBg = row._isVariation
                      ? (varIdx % 2 === 1 ? '#dbeafe' : '#eff6ff')
                      : (simpleIdx % 2 === 1 ? '#ffffff' : '#f3f4f6');
                    return (
                      <LinkTr
                        key={row.id}
                        to={`/products/${row.wp_product_id}`}
                        style={{
                          borderBottom: '1px solid #e5e7eb',
                          transition: 'background-color 0.15s',
                          backgroundColor: varBg
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = varBg}
                      >
                        <td style={cellStyle}>
                          {row.image_url ? (
                            <img src={row.image_url} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                          ) : (
                            <div style={{ width: '40px', height: '40px', backgroundColor: '#e5e7eb', borderRadius: '4px' }} />
                          )}
                        </td>
                        <td style={{ ...cellStyle, paddingLeft: row._isVariation ? '40px' : '10px' }}>
                          <span style={{ fontWeight: row._isVariation ? '400' : '500', color: '#111827' }}>
                            {row._displayName}
                          </span>
                        </td>
                        <td style={{ ...cellStyle, color: '#6b7280', fontFamily: 'monospace', fontSize: '12px' }}>
                          {row.sku ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                              {row.sku}
                              <CopyButton text={String(row.sku)} size={12} />
                            </span>
                          ) : '-'}
                        </td>
                        {isVisible('price') && <td style={{ ...cellRight, ...numStyle(row.price) }}>{fmtPrice(row.price)}</td>}
                        {isVisible('cost_price') && <td style={{ ...cellRight, ...numStyle(row.cost_price) }}>{fmtPrice(row.cost_price)}</td>}
                        {isVisible('margin') && <td style={{ ...cellRight, ...(margin !== null ? numStyle(margin) : {}) }}>{margin !== null ? fmtPct(margin) : '-'}</td>}
                        {isVisible('weight') && <td style={cellRight}>{fmtWeight(row.weight)}</td>}
                        {isVisible('stock') && <td style={{ ...cellRight, fontWeight: '600', ...numStyle(row.stock) }}>{fmtInt(row.stock)}</td>}
                        {isVisible('incoming_qty') && <td style={cellRight}>{fmtInt(row.incoming_qty)}</td>}
                        {isVisible('sales_30d') && <td style={{ ...cellRight, ...numStyle(row.sales_30d) }}>{fmtInt(row.sales_30d)}</td>}
                      </LinkTr>
                    );
                  }); })()}
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
                    color: '#374151',
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
                    color: '#374151',
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
              {csvRows.length} ligne{csvRows.length > 1 ? 's' : ''} detectee{csvRows.length > 1 ? 's' : ''} — Mappez les colonnes :
            </p>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Colonne SKU</label>
                <select
                  value={csvMapping.sku}
                  onChange={e => setCsvMapping(prev => ({ ...prev, sku: e.target.value }))}
                  style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                >
                  <option value="">-- Selectionner --</option>
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
                  <option value="">-- Selectionner --</option>
                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>

            {/* Apercu */}
            {csvMapping.sku && csvMapping.barcode && !csvResult && (
              <div style={{ marginBottom: '16px' }}>
                <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>Apercu (5 premieres lignes) :</p>
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

            {/* Resultat */}
            {csvResult && (
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f0fdf4', borderRadius: '6px', fontSize: '13px' }}>
                <p style={{ margin: '0 0 4px', fontWeight: '600', color: '#059669' }}>Import termine</p>
                <p style={{ margin: '0' }}>{csvResult.inserted} code{csvResult.inserted > 1 ? 's' : ''}-barre{csvResult.inserted > 1 ? 's' : ''} importe{csvResult.inserted > 1 ? 's' : ''}, {csvResult.skipped} ignore{csvResult.skipped > 1 ? 's' : ''} (doublons)</p>
                {csvResult.errors.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <p style={{ margin: '0 0 4px', color: '#dc2626', fontWeight: '600' }}>{csvResult.errors.length} erreur{csvResult.errors.length > 1 ? 's' : ''} :</p>
                    <div style={{ maxHeight: '120px', overflow: 'auto', fontSize: '12px' }}>
                      {csvResult.errors.map((e, i) => (
                        <div key={i} style={{ color: '#dc2626' }}>SKU "{e.sku}" : {e.reason}</div>
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
        <p style={{ margin: 0 }}>&copy; 2024 YouVape - Tous droits reserves</p>
      </div>
    </main>
    </AppShell>
  );
};

export default CatalogApp;
