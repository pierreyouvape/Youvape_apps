import { useState, useEffect } from 'react';
import axios from 'axios';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const API_BASE_URL = 'http://54.37.156.233:3000/api';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#a4de6c', '#d0ed57'];

const AnalysisTab = () => {
  const [filters, setFilters] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [stats, setStats] = useState(null);

  // Filtres sélectionnés
  const [selectedFilters, setSelectedFilters] = useState({
    dateFrom: '',
    dateTo: '',
    categories: [],
    subCategories: [],
    countries: [],
    shippingMethods: [],
    paymentMethods: [],
    statuses: ['wc-completed', 'wc-delivered']
  });

  // Charger les filtres disponibles au montage
  useEffect(() => {
    fetchFilters();
  }, []);

  // Charger les stats au changement de filtres
  useEffect(() => {
    if (filters) {
      fetchStats();
    }
  }, [selectedFilters]);

  const fetchFilters = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/analysis/filters`);
      if (response.data.success) {
        setFilters(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching filters:', error);
    } finally {
      setLoadingFilters(false);
    }
  };

  const fetchStats = async () => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/analysis/stats`, selectedFilters);
      if (response.data.success) {
        setStats(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (filterName, value) => {
    setSelectedFilters(prev => ({
      ...prev,
      [filterName]: value
    }));
  };

  const handleMultiSelect = (filterName, value) => {
    setSelectedFilters(prev => {
      const current = prev[filterName];
      if (current.includes(value)) {
        return { ...prev, [filterName]: current.filter(v => v !== value) };
      } else {
        return { ...prev, [filterName]: [...current, value] };
      }
    });
  };

  const clearFilters = () => {
    setSelectedFilters({
      dateFrom: '',
      dateTo: '',
      categories: [],
      subCategories: [],
      countries: [],
      shippingMethods: [],
      paymentMethods: [],
      statuses: ['wc-completed', 'wc-delivered']
    });
  };

  const formatPrice = (value) => {
    return parseFloat(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  };

  const formatNumber = (value) => {
    return parseInt(value || 0).toLocaleString('fr-FR');
  };

  const exportToPDF = () => {
    if (!stats) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let yPosition = 20;

    // Titre
    doc.setFontSize(20);
    doc.setTextColor(19, 94, 132); // Couleur YouVape
    doc.text('Rapport d\'Analyse YouVape', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 10;

    // Date du rapport
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;

    // Filtres appliqués
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('Filtres appliqués:', 14, yPosition);
    yPosition += 7;
    doc.setFontSize(9);
    doc.setTextColor(80);

    const appliedFilters = [];
    if (selectedFilters.dateFrom || selectedFilters.dateTo) {
      appliedFilters.push(`Période: ${selectedFilters.dateFrom || 'début'} - ${selectedFilters.dateTo || 'aujourd\'hui'}`);
    }
    if (selectedFilters.categories.length > 0) {
      appliedFilters.push(`Catégories: ${selectedFilters.categories.join(', ')}`);
    }
    if (selectedFilters.subCategories.length > 0) {
      appliedFilters.push(`Sous-catégories: ${selectedFilters.subCategories.join(', ')}`);
    }
    if (selectedFilters.countries.length > 0) {
      const countryNames = selectedFilters.countries.map(c => {
        const found = filters?.countries?.find(f => f.value === c);
        return found ? found.label : c;
      });
      appliedFilters.push(`Pays: ${countryNames.join(', ')}`);
    }
    if (selectedFilters.shippingMethods.length > 0) {
      appliedFilters.push(`Transporteurs: ${selectedFilters.shippingMethods.join(', ')}`);
    }
    if (appliedFilters.length === 0) {
      appliedFilters.push('Aucun filtre (toutes les commandes)');
    }

    appliedFilters.forEach(filter => {
      const lines = doc.splitTextToSize(filter, pageWidth - 28);
      lines.forEach(line => {
        doc.text(`• ${line}`, 18, yPosition);
        yPosition += 5;
      });
    });
    yPosition += 10;

    // KPIs
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text('Indicateurs clés', 14, yPosition);
    yPosition += 8;

    doc.autoTable({
      startY: yPosition,
      head: [['Indicateur', 'Valeur']],
      body: [
        ['Nombre de commandes', formatNumber(stats.metrics.orders_count)],
        ['CA TTC', formatPrice(stats.metrics.ca_ttc)],
        ['CA HT', formatPrice(stats.metrics.ca_ht)],
        ['Panier moyen', formatPrice(stats.metrics.avg_basket)],
        ['Marge HT', `${formatPrice(stats.metrics.margin_ht)} (${stats.metrics.margin_percent}%)`],
        ['Coût HT', formatPrice(stats.metrics.cost_ht)],
      ],
      theme: 'striped',
      headStyles: { fillColor: [19, 94, 132] },
      margin: { left: 14, right: 14 },
    });

    yPosition = doc.lastAutoTable.finalY + 15;

    // Répartition par transporteur
    if (stats.breakdowns.byShipping.length > 0) {
      doc.setFontSize(14);
      doc.text('Répartition par transporteur', 14, yPosition);
      yPosition += 8;

      doc.autoTable({
        startY: yPosition,
        head: [['Transporteur', 'Commandes', 'CA TTC']],
        body: stats.breakdowns.byShipping.map(item => [
          item.name,
          formatNumber(item.count),
          formatPrice(item.ca_ttc)
        ]),
        theme: 'striped',
        headStyles: { fillColor: [19, 94, 132] },
        margin: { left: 14, right: 14 },
      });

      yPosition = doc.lastAutoTable.finalY + 15;
    }

    // Nouvelle page si nécessaire
    if (yPosition > 250) {
      doc.addPage();
      yPosition = 20;
    }

    // Répartition par pays
    if (stats.breakdowns.byCountry.length > 0) {
      doc.setFontSize(14);
      doc.text('Répartition par pays', 14, yPosition);
      yPosition += 8;

      doc.autoTable({
        startY: yPosition,
        head: [['Pays', 'Commandes', 'CA TTC']],
        body: stats.breakdowns.byCountry.map(item => [
          item.name || item.code,
          formatNumber(item.count),
          formatPrice(item.ca_ttc)
        ]),
        theme: 'striped',
        headStyles: { fillColor: [19, 94, 132] },
        margin: { left: 14, right: 14 },
      });

      yPosition = doc.lastAutoTable.finalY + 15;
    }

    // Nouvelle page si nécessaire
    if (yPosition > 250) {
      doc.addPage();
      yPosition = 20;
    }

    // Répartition par catégorie
    if (stats.breakdowns.byCategory.length > 0) {
      doc.setFontSize(14);
      doc.text('CA par catégorie', 14, yPosition);
      yPosition += 8;

      doc.autoTable({
        startY: yPosition,
        head: [['Catégorie', 'Commandes', 'CA TTC']],
        body: stats.breakdowns.byCategory.map(item => [
          item.name,
          formatNumber(item.orders_count),
          formatPrice(item.ca_ttc)
        ]),
        theme: 'striped',
        headStyles: { fillColor: [19, 94, 132] },
        margin: { left: 14, right: 14 },
      });
    }

    // Pied de page sur toutes les pages
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`YouVape - Rapport d'analyse - Page ${i}/${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
    }

    // Télécharger le PDF
    const fileName = `analyse_youvape_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
  };

  // Style pour les filtres multi-select
  const MultiSelect = ({ label, options, selected, filterName, maxHeight = '150px' }) => (
    <div style={{ marginBottom: '15px' }}>
      <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px', color: '#333' }}>
        {label} {selected.length > 0 && <span style={{ color: '#007bff' }}>({selected.length})</span>}
      </label>
      <div style={{
        border: '1px solid #ddd',
        borderRadius: '6px',
        maxHeight: maxHeight,
        overflowY: 'auto',
        backgroundColor: '#fff'
      }}>
        {options?.map((option) => (
          <div
            key={option.value}
            onClick={() => handleMultiSelect(filterName, option.value)}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: selected.includes(option.value) ? '#e7f3ff' : 'transparent',
              borderBottom: '1px solid #eee',
              fontSize: '13px'
            }}
          >
            <span style={{
              color: selected.includes(option.value) ? '#007bff' : '#333',
              fontWeight: selected.includes(option.value) ? '600' : 'normal'
            }}>
              {option.label}
            </span>
            <span style={{ color: '#999', fontSize: '11px' }}>({option.count})</span>
          </div>
        ))}
      </div>
    </div>
  );

  // Carte KPI
  const KpiCard = ({ label, value, color = '#333', subValue = null }) => (
    <div style={{
      backgroundColor: 'white',
      padding: '20px',
      borderRadius: '8px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      flex: '1',
      minWidth: '150px'
    }}>
      <p style={{ fontSize: '13px', color: '#6c757d', margin: '0 0 8px 0', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ fontSize: '24px', fontWeight: 'bold', color: color, margin: 0 }}>{value}</p>
      {subValue && <p style={{ fontSize: '12px', color: '#999', margin: '5px 0 0 0' }}>{subValue}</p>}
    </div>
  );

  if (loadingFilters) {
    return (
      <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>
        Chargement des filtres...
      </div>
    );
  }

  return (
    <div>
      {/* Filtres */}
      <div style={{
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', color: '#333' }}>Filtres</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={exportToPDF}
              disabled={!stats}
              style={{
                padding: '8px 15px',
                backgroundColor: stats ? '#dc3545' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: stats ? 'pointer' : 'not-allowed',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              Export PDF
            </button>
            <button
              onClick={clearFilters}
              style={{
                padding: '8px 15px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              Réinitialiser
            </button>
          </div>
        </div>

        {/* Période */}
        <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1', minWidth: '200px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px' }}>Date début</label>
            <input
              type="date"
              value={selectedFilters.dateFrom}
              onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
              style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            />
          </div>
          <div style={{ flex: '1', minWidth: '200px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px' }}>Date fin</label>
            <input
              type="date"
              value={selectedFilters.dateTo}
              onChange={(e) => handleFilterChange('dateTo', e.target.value)}
              style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            />
          </div>
        </div>

        {/* Multi-selects en grille */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
          <MultiSelect
            label="Catégories produit"
            options={filters?.categories}
            selected={selectedFilters.categories}
            filterName="categories"
          />
          <MultiSelect
            label="Sous-catégories"
            options={filters?.subCategories}
            selected={selectedFilters.subCategories}
            filterName="subCategories"
          />
          <MultiSelect
            label="Pays"
            options={filters?.countries}
            selected={selectedFilters.countries}
            filterName="countries"
          />
          <MultiSelect
            label="Transporteurs"
            options={filters?.shippingMethods}
            selected={selectedFilters.shippingMethods}
            filterName="shippingMethods"
          />
          <MultiSelect
            label="Moyens de paiement"
            options={filters?.paymentMethods}
            selected={selectedFilters.paymentMethods}
            filterName="paymentMethods"
          />
          <MultiSelect
            label="Statuts commande"
            options={filters?.statuses}
            selected={selectedFilters.statuses}
            filterName="statuses"
          />
        </div>
      </div>

      {/* Résultats */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>
          Calcul en cours...
        </div>
      ) : stats ? (
        <>
          {/* KPIs */}
          <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <KpiCard label="Commandes" value={formatNumber(stats.metrics.orders_count)} color="#007bff" />
            <KpiCard label="CA TTC" value={formatPrice(stats.metrics.ca_ttc)} color="#28a745" />
            <KpiCard label="CA HT" value={formatPrice(stats.metrics.ca_ht)} />
            <KpiCard label="Panier moyen" value={formatPrice(stats.metrics.avg_basket)} color="#17a2b8" />
            <KpiCard
              label="Marge HT"
              value={formatPrice(stats.metrics.margin_ht)}
              color="#28a745"
              subValue={`${stats.metrics.margin_percent}%`}
            />
            <KpiCard label="Coût HT" value={formatPrice(stats.metrics.cost_ht)} color="#dc3545" />
          </div>

          {/* Graphiques */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', marginBottom: '20px' }}>
            {/* Répartition par transporteur */}
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>Répartition par transporteur</h4>
              {stats.breakdowns.byShipping.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={stats.breakdowns.byShipping}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) => `${name.substring(0, 15)}${name.length > 15 ? '...' : ''} (${(percent * 100).toFixed(0)}%)`}
                      labelLine={false}
                    >
                      {stats.breakdowns.byShipping.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatNumber(value)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ textAlign: 'center', color: '#999' }}>Aucune donnée</p>
              )}
            </div>

            {/* Répartition par pays */}
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>Répartition par pays</h4>
              {stats.breakdowns.byCountry.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={stats.breakdowns.byCountry}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      labelLine={false}
                    >
                      {stats.breakdowns.byCountry.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatNumber(value)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ textAlign: 'center', color: '#999' }}>Aucune donnée</p>
              )}
            </div>
          </div>

          {/* Top catégories */}
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
            <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>CA par catégorie</h4>
            {stats.breakdowns.byCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.breakdowns.byCategory} layout="vertical" margin={{ left: 150 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v) => formatPrice(v)} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => formatPrice(value)} />
                  <Bar dataKey="ca_ttc" fill="#007bff" name="CA TTC" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ textAlign: 'center', color: '#999' }}>Aucune donnée</p>
            )}
          </div>

          {/* Evolution dans le temps */}
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>Evolution du CA</h4>
            {stats.breakdowns.byTime.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={stats.breakdowns.byTime}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis tickFormatter={(v) => `${(v/1000).toFixed(0)}k€`} />
                  <Tooltip
                    labelFormatter={(d) => new Date(d).toLocaleDateString('fr-FR')}
                    formatter={(value) => [formatPrice(value), 'CA TTC']}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="ca_ttc" stroke="#28a745" name="CA TTC" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ textAlign: 'center', color: '#999' }}>Sélectionnez une période pour voir l&apos;évolution</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};

export default AnalysisTab;
