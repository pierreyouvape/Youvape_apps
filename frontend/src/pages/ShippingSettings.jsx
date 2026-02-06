import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace('/auth', '');

const ShippingSettings = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();

  // Onglet parent actif
  const [activeParentTab, setActiveParentTab] = useState('transporteur');
  // Sous-onglet actif
  const [activeSubTab, setActiveSubTab] = useState('general');
  // Sous-sous-onglet pour les tarifs (transporteur sélectionné)
  const [activeCarrier, setActiveCarrier] = useState('laposte');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Data Transporteur
  const [packagingWeight, setPackagingWeight] = useState('50');
  const [carriersConfig, setCarriersConfig] = useState({});
  const [carrierZones, setCarrierZones] = useState({});
  const [countryMappings, setCountryMappings] = useState([]);
  const [allZoneNames, setAllZoneNames] = useState([]);
  const [countriesList, setCountriesList] = useState({});
  const [postalPrefixes, setPostalPrefixes] = useState([]);

  // New zone/mapping input
  const [newZoneName, setNewZoneName] = useState('');
  const [newCountryCode, setNewCountryCode] = useState('');
  const [newCountryZone, setNewCountryZone] = useState('');
  const [newCountryIsPostal, setNewCountryIsPostal] = useState(false);
  const [newZoneNameForMapping, setNewZoneNameForMapping] = useState('');

  // Collapsed states
  const [collapsedMethods, setCollapsedMethods] = useState({});
  const [collapsedZones, setCollapsedZones] = useState({});
  const [collapsedMappingZones, setCollapsedMappingZones] = useState({});

  const toggleMethod = (methodKey) => {
    setCollapsedMethods(prev => ({ ...prev, [methodKey]: prev[methodKey] === false ? true : false }));
  };

  const toggleZone = (zoneId) => {
    setCollapsedZones(prev => ({ ...prev, [zoneId]: prev[zoneId] === false ? true : false }));
  };

  const toggleMappingZone = (zoneName) => {
    setCollapsedMappingZones(prev => ({ ...prev, [zoneName]: prev[zoneName] === false ? true : false }));
  };

  // Data Paiement
  const [paymentMethods, setPaymentMethods] = useState([]);

  // Date range for applying
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [calculationResult, setCalculationResult] = useState(null);
  const [calculating, setCalculating] = useState(false);

  const parentTabs = [
    { id: 'transporteur', label: 'Transporteur' },
    { id: 'paiement', label: 'Paiement' }
  ];

  const transporteurSubTabs = [
    { id: 'general', label: 'Général' },
    { id: 'tarifs', label: 'Tarifs' },
    { id: 'zones_pays', label: 'Zones/Pays' },
    { id: 'apply', label: 'Appliquer' }
  ];

  const paiementSubTabs = [
    { id: 'frais', label: 'Frais par méthode' }
  ];

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeParentTab === 'transporteur') {
      setActiveSubTab('general');
    } else {
      setActiveSubTab('frais');
    }
  }, [activeParentTab]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load shipping settings
      const settingsRes = await axios.get(`${API_URL}/shipping/settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (settingsRes.data.success) {
        setPackagingWeight(settingsRes.data.settings.packaging_weight || '50');
      }

      // Load carriers config
      const carriersRes = await axios.get(`${API_URL}/tariffs/carriers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (carriersRes.data.success) {
        setCarriersConfig(carriersRes.data.carriers);
      }

      // Load country mappings
      const mappingsRes = await axios.get(`${API_URL}/tariffs/country-mapping`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (mappingsRes.data.success) {
        setCountryMappings(mappingsRes.data.mappings);
      }

      // Load all zone names
      const zonesRes = await axios.get(`${API_URL}/tariffs/zone-names`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (zonesRes.data.success) {
        setAllZoneNames(zonesRes.data.zones);
      }

      // Load countries list
      const countriesRes = await axios.get(`${API_URL}/tariffs/countries`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (countriesRes.data.success) {
        setCountriesList(countriesRes.data.countries);
        setPostalPrefixes(countriesRes.data.postalPrefixes);
      }

      // Load payment settings
      try {
        const paymentRes = await axios.get(`${API_URL}/payment/methods`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (paymentRes.data.success && paymentRes.data.methods.length > 0) {
          setPaymentMethods(paymentRes.data.methods);
        }
      } catch (e) {
        setPaymentMethods([
          { id: 1, code: 'mollie_cc', name: 'Mollie - Carte Bancaire', monthly_fee: 0, fixed_fee: 0.25, percent_fee: 1.28 },
          { id: 2, code: 'mollie_bancontact', name: 'Mollie - Bancontact', monthly_fee: 0, fixed_fee: 0.25, percent_fee: 0.96 },
          { id: 3, code: 'paypal', name: 'PayPal', monthly_fee: 0, fixed_fee: 0.35, percent_fee: 3.55 },
          { id: 4, code: 'alma', name: 'Alma (Paiement en plusieurs fois)', monthly_fee: 0, fixed_fee: 0, percent_fee: 2.00 },
          { id: 5, code: 'virement', name: 'Virement Bancaire', monthly_fee: 0, fixed_fee: 0, percent_fee: 0 }
        ]);
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setMessage({ type: 'error', text: 'Erreur lors du chargement' });
    } finally {
      setLoading(false);
    }
  };

  const loadCarrierZones = async (carrier, method) => {
    const key = `${carrier}_${method}`;
    try {
      const res = await axios.get(`${API_URL}/tariffs/zones/${carrier}/${method}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setCarrierZones(prev => ({ ...prev, [key]: res.data.zones }));
      }
    } catch (err) {
      console.error('Error loading carrier zones:', err);
    }
  };

  const savePackagingWeight = async () => {
    try {
      setSaving(true);
      await axios.put(`${API_URL}/shipping/settings`, { packaging_weight: packagingWeight }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessage({ type: 'success', text: 'Poids d\'emballage sauvegardé' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors de la sauvegarde' });
    } finally {
      setSaving(false);
    }
  };

  const addZone = async (carrier, method) => {
    if (!newZoneName.trim()) return;
    try {
      await axios.post(`${API_URL}/tariffs/zones/${carrier}/${method}`, { zone_name: newZoneName }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNewZoneName('');
      loadCarrierZones(carrier, method);
      // Refresh zone names for mapping dropdown
      const zonesRes = await axios.get(`${API_URL}/tariffs/zone-names`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (zonesRes.data.success) {
        setAllZoneNames(zonesRes.data.zones);
      }
      setMessage({ type: 'success', text: 'Zone ajoutée' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Erreur lors de l\'ajout' });
    }
  };

  const deleteZone = async (zoneId, carrier, method) => {
    if (!confirm('Supprimer cette zone et tous ses tarifs ?')) return;
    try {
      await axios.delete(`${API_URL}/tariffs/zones/${zoneId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadCarrierZones(carrier, method);
      setMessage({ type: 'success', text: 'Zone supprimée' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors de la suppression' });
    }
  };

  const addRate = async (zoneId, carrier, method) => {
    try {
      await axios.post(`${API_URL}/tariffs/rates`, { zone_id: zoneId, weight_from: 0, weight_to: 250, price_ht: 0 }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadCarrierZones(carrier, method);
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors de l\'ajout' });
    }
  };

  const updateRate = async (rateId, data, carrier, method) => {
    try {
      await axios.put(`${API_URL}/tariffs/rates/${rateId}`, data, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadCarrierZones(carrier, method);
      setMessage({ type: 'success', text: 'Tarif sauvegardé' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors de la sauvegarde' });
    }
  };

  const deleteRate = async (rateId, carrier, method) => {
    if (!confirm('Supprimer cette tranche ?')) return;
    try {
      await axios.delete(`${API_URL}/tariffs/rates/${rateId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadCarrierZones(carrier, method);
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors de la suppression' });
    }
  };

  const addCountryMapping = async () => {
    if (!newCountryCode.trim() || !newCountryZone) return;
    try {
      const res = await axios.post(`${API_URL}/tariffs/country-mapping`, {
        country_code: newCountryCode,
        zone_name: newCountryZone,
        is_postal_prefix: newCountryIsPostal
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNewCountryCode('');
      setNewCountryZone('');
      setNewCountryIsPostal(false);
      const mappingsRes = await axios.get(`${API_URL}/tariffs/country-mapping`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (mappingsRes.data.success) {
        setCountryMappings(mappingsRes.data.mappings);
      }
      setMessage({ type: res.data.moved ? 'warning' : 'success', text: res.data.message || 'Mapping ajouté' });
      setTimeout(() => setMessage(null), 4000);
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors de l\'ajout' });
    }
  };

  const updateFuelSurcharge = async (zoneId, fuelSurcharge, carrier, method) => {
    try {
      await axios.put(`${API_URL}/tariffs/zones/${zoneId}/fuel-surcharge`, { fuel_surcharge: fuelSurcharge }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadCarrierZones(carrier, method);
      setMessage({ type: 'success', text: 'Surcharge carburant sauvegardée' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors de la sauvegarde' });
    }
  };

  const bulkImportRates = async (zoneId, rates, carrier, method) => {
    try {
      const res = await axios.post(`${API_URL}/tariffs/rates/bulk-import`, { zone_id: zoneId, rates }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setMessage({ type: 'success', text: res.data.message });
        loadCarrierZones(carrier, method);
        setTimeout(() => setMessage(null), 3000);
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors de l\'import' });
    }
  };

  const deleteCountryMapping = async (id) => {
    if (!confirm('Supprimer ce mapping ?')) return;
    try {
      await axios.delete(`${API_URL}/tariffs/country-mapping/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCountryMappings(countryMappings.filter(m => m.id !== id));
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors de la suppression' });
    }
  };

  const calculateCosts = async () => {
    if (!dateFrom || !dateTo) {
      setMessage({ type: 'error', text: 'Veuillez sélectionner une plage de dates' });
      return;
    }
    try {
      setCalculating(true);
      const res = await axios.post(`${API_URL}/shipping/calculate`, { date_from: dateFrom, date_to: dateTo }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setCalculationResult(res.data);
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors du calcul' });
    } finally {
      setCalculating(false);
    }
  };

  const applyCosts = async () => {
    if (!dateFrom || !dateTo) {
      setMessage({ type: 'error', text: 'Veuillez sélectionner une plage de dates' });
      return;
    }
    if (!confirm(`Appliquer les frais de port calculés aux commandes du ${dateFrom} au ${dateTo} ?`)) return;
    try {
      setCalculating(true);
      const res = await axios.post(`${API_URL}/shipping/apply`, { date_from: dateFrom, date_to: dateTo }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setMessage({ type: 'success', text: res.data.message });
        setCalculationResult(null);
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Erreur lors de l\'application' });
    } finally {
      setCalculating(false);
    }
  };

  const updatePaymentMethod = (methodId, field, value) => {
    setPaymentMethods(paymentMethods.map(m =>
      m.id === methodId ? { ...m, [field]: parseFloat(value) || 0 } : m
    ));
  };

  const savePaymentMethod = async (method) => {
    try {
      setSaving(true);
      await axios.put(`${API_URL}/payment/methods/${method.id}`, {
        monthly_fee: method.monthly_fee,
        fixed_fee: method.fixed_fee,
        percent_fee: method.percent_fee
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessage({ type: 'success', text: `${method.name} sauvegardé` });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'success', text: `${method.name} sauvegardé (local)` });
      setTimeout(() => setMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  // ==================== RENDER FUNCTIONS ====================

  const renderGeneralTab = () => (
    <div style={{ padding: '20px' }}>
      <h3>Paramètres généraux</h3>
      <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
        <label style={{ fontWeight: '500' }}>Poids de l'emballage (g):</label>
        <input
          type="number"
          value={packagingWeight}
          onChange={(e) => setPackagingWeight(e.target.value)}
          style={{ width: '100px', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
        />
        <button onClick={savePackagingWeight} disabled={saving} style={btnSuccess}>
          {saving ? 'Sauvegarde...' : 'Sauvegarder'}
        </button>
      </div>
      <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
        Ce poids sera ajouté au poids total des produits pour calculer les frais de port.
      </p>
    </div>
  );

  const renderTarifsTab = () => {
    const carrierTabs = Object.entries(carriersConfig).map(([code, config]) => ({
      id: code,
      label: config.name
    }));

    const currentCarrier = carriersConfig[activeCarrier];

    return (
      <div style={{ padding: '20px' }}>
        {/* Carrier tabs */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {carrierTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveCarrier(tab.id)}
              style={{
                padding: '8px 16px',
                backgroundColor: activeCarrier === tab.id ? '#135E84' : '#e9ecef',
                color: activeCarrier === tab.id ? 'white' : '#333',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: activeCarrier === tab.id ? 'bold' : 'normal'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Methods for current carrier */}
        {currentCarrier && Object.entries(currentCarrier.methods).map(([methodCode, methodName]) => {
          const key = `${activeCarrier}_${methodCode}`;
          const zones = carrierZones[key] || [];
          const isMethodCollapsed = collapsedMethods[key] !== false; // Replié par défaut

          // Load zones if not loaded
          if (!carrierZones[key]) {
            loadCarrierZones(activeCarrier, methodCode);
          }

          return (
            <div key={methodCode} style={{ marginBottom: '15px', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}>
              <div
                onClick={() => toggleMethod(key)}
                style={{ backgroundColor: '#135E84', color: 'white', padding: '12px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <h4 style={{ margin: 0 }}>{methodName} <span style={{ fontSize: '13px', opacity: 0.8 }}>({zones.length} zone{zones.length > 1 ? 's' : ''})</span></h4>
                <span style={{ fontSize: '18px' }}>{isMethodCollapsed ? '▶' : '▼'}</span>
              </div>

              {!isMethodCollapsed && (
                <div style={{ padding: '15px' }}>
                  {/* Add zone */}
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', alignItems: 'center' }}>
                    <select
                      value={newZoneName}
                      onChange={(e) => setNewZoneName(e.target.value)}
                      style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
                    >
                      <option value="">-- Sélectionner une zone existante --</option>
                      {allZoneNames
                        .filter(z => !(carrierZones[`${activeCarrier}_${methodCode}`] || []).some(cz => cz.name === z))
                        .map(z => (
                          <option key={z} value={z}>{z}</option>
                        ))
                      }
                    </select>
                    <span style={{ color: '#999', fontSize: '13px' }}>ou</span>
                    <input
                      type="text"
                      placeholder="Nouvelle zone..."
                      value={newZoneName && !allZoneNames.includes(newZoneName) ? newZoneName : ''}
                      onChange={(e) => setNewZoneName(e.target.value)}
                      style={{ width: '200px', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
                    />
                    <button onClick={() => addZone(activeCarrier, methodCode)} style={btnPrimary}>
                      + Ajouter zone
                    </button>
                  </div>

                  {/* Zones list */}
                  {zones.map(zone => (
                    <FuelSurchargeZone
                      key={zone.id}
                      zone={zone}
                      carrier={activeCarrier}
                      methodCode={methodCode}
                      onAddRate={addRate}
                      onDeleteZone={deleteZone}
                      onUpdateRate={updateRate}
                      onDeleteRate={deleteRate}
                      onUpdateFuelSurcharge={updateFuelSurcharge}
                      onBulkImport={bulkImportRates}
                      isCollapsed={collapsedZones[zone.id] !== false}
                      onToggle={() => toggleZone(zone.id)}
                    />
                  ))}

                  {zones.length === 0 && (
                    <p style={{ color: '#999', textAlign: 'center' }}>Aucune zone configurée pour cette méthode</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderZonesPaysTab = () => {
    const sortedCountries = Object.entries(countriesList).sort((a, b) => a[1].localeCompare(b[1]));

    // Grouper les mappings par zone
    const mappingsByZone = {};
    countryMappings.forEach(mapping => {
      const zone = mapping.zone_name;
      if (!mappingsByZone[zone]) mappingsByZone[zone] = [];
      mappingsByZone[zone].push(mapping);
    });
    // Trier les zones alphabétiquement
    const sortedZones = Object.keys(mappingsByZone).sort();

    return (
      <div style={{ padding: '20px' }}>
        <h3>Mapping Pays / Zones</h3>
        <p style={{ color: '#666', marginBottom: '20px' }}>
          Associez chaque pays (ou préfixe de code postal) à une zone tarifaire. Les pays sont regroupés par zone.
        </p>

        {/* Create new zone */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', alignItems: 'center', padding: '12px 15px', backgroundColor: '#e8f4f8', borderRadius: '8px', border: '1px dashed #135E84' }}>
          <span style={{ fontWeight: '500', color: '#135E84', whiteSpace: 'nowrap' }}>Créer une zone :</span>
          <input
            type="text"
            placeholder="Nom de la nouvelle zone (ex: Zone 1, France...)"
            value={newZoneNameForMapping}
            onChange={(e) => setNewZoneNameForMapping(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newZoneNameForMapping.trim()) {
                const zoneName = newZoneNameForMapping.trim();
                if (allZoneNames.includes(zoneName)) {
                  setMessage({ type: 'error', text: 'Cette zone existe déjà' });
                  setTimeout(() => setMessage(null), 3000);
                  return;
                }
                setAllZoneNames(prev => [...prev, zoneName].sort());
                setNewZoneNameForMapping('');
                setMessage({ type: 'success', text: `Zone "${zoneName}" créée (disponible dans le dropdown)` });
                setTimeout(() => setMessage(null), 3000);
              }
            }}
            style={{ flex: 1, padding: '8px', border: '1px solid #135E84', borderRadius: '4px' }}
          />
          <button
            onClick={() => {
              const zoneName = newZoneNameForMapping.trim();
              if (!zoneName) return;
              if (allZoneNames.includes(zoneName)) {
                setMessage({ type: 'error', text: 'Cette zone existe déjà' });
                setTimeout(() => setMessage(null), 3000);
                return;
              }
              setAllZoneNames(prev => [...prev, zoneName].sort());
              setNewZoneNameForMapping('');
              setMessage({ type: 'success', text: `Zone "${zoneName}" créée (disponible dans le dropdown)` });
              setTimeout(() => setMessage(null), 3000);
            }}
            style={btnPrimary}
          >
            + Créer zone
          </button>
        </div>

        {/* Add mapping */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '25px', flexWrap: 'wrap', alignItems: 'center', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
          {newCountryIsPostal ? (
            <select
              value={newCountryCode}
              onChange={(e) => setNewCountryCode(e.target.value)}
              style={{ width: '280px', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
            >
              <option value="">-- Sélectionner un préfixe postal --</option>
              {postalPrefixes.map(p => (
                <option key={p.code} value={p.code}>{p.code} - {p.name}</option>
              ))}
            </select>
          ) : (
            <select
              value={newCountryCode}
              onChange={(e) => setNewCountryCode(e.target.value)}
              style={{ width: '280px', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
            >
              <option value="">-- Sélectionner un pays --</option>
              {sortedCountries.map(([code, name]) => (
                <option key={code} value={code}>{code} - {name}</option>
              ))}
            </select>
          )}
          <select
            value={newCountryZone}
            onChange={(e) => setNewCountryZone(e.target.value)}
            style={{ width: '200px', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
          >
            <option value="">-- Sélectionner une zone --</option>
            {allZoneNames.map(z => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <input
              type="checkbox"
              checked={newCountryIsPostal}
              onChange={(e) => {
                setNewCountryIsPostal(e.target.checked);
                setNewCountryCode('');
              }}
            />
            Préfixe postal
          </label>
          <button onClick={addCountryMapping} style={btnPrimary}>
            + Ajouter
          </button>
        </div>

        {/* Zones avec leurs pays */}
        {sortedZones.length === 0 ? (
          <p style={{ color: '#999', textAlign: 'center', padding: '40px' }}>Aucun mapping configuré</p>
        ) : (
          sortedZones.map(zoneName => {
            const mappings = mappingsByZone[zoneName];
            const isZoneCollapsed = collapsedMappingZones[zoneName] !== false; // Replié par défaut
            return (
              <div key={zoneName} style={{ marginBottom: '15px', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}>
                <div
                  onClick={() => toggleMappingZone(zoneName)}
                  style={{ backgroundColor: '#135E84', color: 'white', padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                >
                  <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '14px' }}>{isZoneCollapsed ? '▶' : '▼'}</span>
                    {zoneName}
                  </h4>
                  <span style={{ fontSize: '13px', opacity: 0.8 }}>{mappings.length} pays/préfixe{mappings.length > 1 ? 's' : ''}</span>
                </div>
                {!isZoneCollapsed && (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#e9ecef' }}>
                        <th style={{ ...thStyle, width: '80px' }}>Code</th>
                        <th style={thStyle}>Pays / Préfixe</th>
                        <th style={{ ...thStyle, width: '120px' }}>Type</th>
                        <th style={{ ...thStyle, width: '80px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.map(mapping => (
                        <tr key={mapping.id}>
                          <td style={tdStyle}><strong>{mapping.country_code}</strong></td>
                          <td style={tdStyle}>
                            {mapping.is_postal_prefix
                              ? postalPrefixes.find(p => p.code === mapping.country_code)?.name || mapping.country_code
                              : countriesList[mapping.country_code] || mapping.country_code
                            }
                          </td>
                          <td style={tdStyle}>{mapping.is_postal_prefix ? 'Préfixe postal' : 'Pays'}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <button onClick={() => deleteCountryMapping(mapping.id)} style={btnSmallDanger}>
                              Suppr.
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  };

  const renderApplyTab = () => (
    <div style={{ padding: '20px' }}>
      <h3>Appliquer les tarifs aux commandes</h3>
      <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
        <label>Plage de dates:</label>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
        <span>au</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
        <button onClick={calculateCosts} disabled={calculating} style={btnPrimary}>
          {calculating ? 'Calcul...' : 'Calculer'}
        </button>
        <button onClick={applyCosts} disabled={calculating} style={btnSuccess}>
          Appliquer
        </button>
      </div>

      {calculationResult && (
        <div style={{ marginTop: '30px' }}>
          <div style={{ padding: '15px', backgroundColor: '#e9ecef', borderRadius: '8px', marginBottom: '20px' }}>
            <h4 style={{ margin: '0 0 10px 0' }}>Résumé</h4>
            <p>Total commandes: <strong>{calculationResult.summary.total_orders}</strong></p>
            <p>Commandes matchées: <strong>{calculationResult.summary.orders_matched}</strong></p>
            <p>Commandes non matchées: <strong>{calculationResult.summary.orders_unmatched}</strong></p>
            <p>Total frais calculés: <strong>{calculationResult.summary.total_calculated.toFixed(2)} € HT</strong></p>
          </div>
        </div>
      )}
    </div>
  );

  const renderPaymentFraisTab = () => (
    <div style={{ padding: '20px' }}>
      <h3>Frais par méthode de paiement</h3>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        Configurez les frais prélevés par chaque méthode de paiement (fixe + pourcentage).
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#e9ecef' }}>
            <th style={thStyle}>Méthode</th>
            <th style={{ ...thStyle, width: '150px' }}>Fixe (€)</th>
            <th style={{ ...thStyle, width: '150px' }}>Pourcentage (%)</th>
            <th style={{ ...thStyle, width: '120px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paymentMethods.map(method => (
            <PaymentMethodRow
              key={method.id}
              method={method}
              onUpdate={updatePaymentMethod}
              onSave={savePaymentMethod}
              saving={saving}
            />
          ))}
        </tbody>
      </table>
    </div>
  );

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>Chargement...</div>;
  }

  const currentSubTabs = activeParentTab === 'transporteur' ? transporteurSubTabs : paiementSubTabs;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
        <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        <div style={{ position: 'absolute', right: '20px' }}>
          <button onClick={() => navigate('/stats/reports')} style={btnWhite}>Retour aux stats</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, maxWidth: '1400px', margin: '30px auto', padding: '20px', width: '100%' }}>
        <h1 style={{ marginBottom: '20px' }}>Paramètres</h1>

        {message && (
          <div style={{
            padding: '10px 15px', marginBottom: '20px', borderRadius: '4px',
            backgroundColor: message.type === 'error' ? '#f8d7da' : message.type === 'warning' ? '#fff3cd' : '#d4edda',
            color: message.type === 'error' ? '#721c24' : message.type === 'warning' ? '#856404' : '#155724'
          }}>{message.text}</div>
        )}

        {/* Parent Tabs */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          {parentTabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveParentTab(tab.id)} style={{
              padding: '12px 30px',
              backgroundColor: activeParentTab === tab.id ? '#135E84' : '#e9ecef',
              color: activeParentTab === tab.id ? 'white' : '#333',
              border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer'
            }}>{tab.label}</button>
          ))}
        </div>

        {/* Sub Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #ddd', marginBottom: '20px' }}>
          {currentSubTabs.map(tab => (
            <div key={tab.id} onClick={() => setActiveSubTab(tab.id)} style={{
              padding: '12px 25px', cursor: 'pointer',
              borderBottom: activeSubTab === tab.id ? '3px solid #007bff' : '3px solid transparent',
              color: activeSubTab === tab.id ? '#007bff' : '#666',
              fontWeight: activeSubTab === tab.id ? 'bold' : 'normal'
            }}>{tab.label}</div>
          ))}
        </div>

        {/* Content */}
        <div style={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e9ecef', minHeight: '400px' }}>
          {activeParentTab === 'transporteur' && (
            <>
              {activeSubTab === 'general' && renderGeneralTab()}
              {activeSubTab === 'tarifs' && renderTarifsTab()}
              {activeSubTab === 'zones_pays' && renderZonesPaysTab()}
              {activeSubTab === 'apply' && renderApplyTab()}
            </>
          )}
          {activeParentTab === 'paiement' && (
            <>
              {activeSubTab === 'frais' && renderPaymentFraisTab()}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', textAlign: 'center', color: 'white' }}>
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits réservés</p>
      </div>
    </div>
  );
};

/**
 * Parse une valeur de poids brute (tous formats) et retourne des grammes.
 * Formats supportés :
 *   "jusqu'à 250g" | "jusqu'à 1kg" | "jusqu'a 0,5 Kg"  → borne haute seule
 *   "0.00 - 1.00"  | "0,25 à 0,50 Kg" | "0 - 250"      → from - to
 *   "250" (>50 = grammes) | "0.50" (<50 avec décimale = kg)
 */
const parseWeightCell = (raw) => {
  if (!raw || !raw.toString().trim()) return null;
  let s = raw.toString().trim().toLowerCase();

  // Détecte unité explicite
  const hasKg = /kg/i.test(s);
  const hasG = /[^k]g\b/i.test(s) || /^\d+g$/i.test(s);

  // Nettoie le texte pour ne garder que les chiffres et séparateurs
  // Remplace virgules décimales par des points
  s = s.replace(/,/g, '.');

  // Extrait les nombres
  const numbers = s.match(/[\d.]+/g);
  if (!numbers || numbers.length === 0) return null;

  const toGrams = (val) => {
    const n = parseFloat(val);
    if (isNaN(n)) return null;
    // Si kg explicite, ou si pas de "g" explicite et valeur < 50 avec décimale
    if (hasKg || (!hasG && n < 50 && val.includes('.'))) {
      return Math.round(n * 1000);
    }
    return Math.round(n);
  };

  if (numbers.length >= 2) {
    // Format "from - to" ou "from à to"
    return { from: toGrams(numbers[0]), to: toGrams(numbers[1]) };
  }
  // Borne haute seule
  return { from: null, to: toGrams(numbers[0]) };
};

/**
 * Parse un prix brut : "3.50" ou "3,50" ou "€3.50"
 */
const parsePriceCell = (raw) => {
  if (!raw || !raw.toString().trim()) return null;
  const s = raw.toString().trim().replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};

/**
 * Parse un CSV complet (poids;prix ou poids,prix ou tab) et retourne un tableau de { weight_from, weight_to, price_ht }
 */
const parseCSV = (csvText) => {
  // Filtre les lignes vides et celles qui ne contiennent que des séparateurs
  const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim() && /\d/.test(l));
  if (lines.length === 0) return { rates: [], errors: [] };

  // Détecte le séparateur (tab, ; ou ,) - priorité à tab si présent
  const firstLine = csvText.split(/\r?\n/)[0];
  let sep = '\t';
  if (!firstLine.includes('\t')) {
    sep = firstLine.includes(';') ? ';' : ',';
  }

  const rates = [];
  const errors = [];
  let prevTo = 0;

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim()).filter(c => c); // Filtre les colonnes vides
    if (cols.length < 2) {
      errors.push(`Ligne ${i + 1}: pas assez de colonnes`);
      continue;
    }

    const weight = parseWeightCell(cols[0]);
    const price = parsePriceCell(cols[1]);

    if (!weight || weight.to === null) {
      errors.push(`Ligne ${i + 1}: poids non reconnu "${cols[0]}"`);
      continue;
    }
    if (price === null) {
      errors.push(`Ligne ${i + 1}: prix non reconnu "${cols[1]}"`);
      continue;
    }

    const from = weight.from !== null ? weight.from : (prevTo > 0 ? prevTo + 1 : 0);
    const to = weight.to;

    rates.push({ weight_from: from, weight_to: to, price_ht: price });
    prevTo = to;
  }

  return { rates, errors };
};

// Zone component with fuel surcharge + rates + CSV import
const FuelSurchargeZone = ({ zone, carrier, methodCode, onAddRate, onDeleteZone, onUpdateRate, onDeleteRate, onUpdateFuelSurcharge, onBulkImport, isCollapsed, onToggle }) => {
  const [fuelSurcharge, setFuelSurcharge] = useState(zone.fuel_surcharge || 0);
  const [csvPreview, setCsvPreview] = useState(null);
  const [csvErrors, setCsvErrors] = useState([]);

  const handleCSVFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const { rates, errors } = parseCSV(evt.target.result);
      setCsvPreview(rates);
      setCsvErrors(errors);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const confirmImport = () => {
    if (csvPreview && csvPreview.length > 0) {
      onBulkImport(zone.id, csvPreview, carrier, methodCode);
      setCsvPreview(null);
      setCsvErrors([]);
    }
  };

  return (
    <div style={{ marginBottom: '10px', backgroundColor: '#f8f9fa', borderRadius: '6px', border: '1px solid #ddd' }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 15px', cursor: 'pointer', backgroundColor: '#e9ecef', borderRadius: isCollapsed ? '6px' : '6px 6px 0 0' }}
      >
        <h5 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px' }}>{isCollapsed ? '▶' : '▼'}</span>
          {zone.name}
          <span style={{ fontSize: '12px', color: '#666', fontWeight: 'normal' }}>({zone.rates.length} tranche{zone.rates.length > 1 ? 's' : ''})</span>
        </h5>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: '12px', color: '#555' }}>Carburant:</span>
          <input
            type="number"
            step="0.1"
            value={fuelSurcharge}
            onChange={(e) => setFuelSurcharge(parseFloat(e.target.value) || 0)}
            style={{ width: '60px', padding: '3px', border: '1px solid #ccc', borderRadius: '3px', fontSize: '12px' }}
          />
          <span style={{ fontSize: '12px', color: '#555' }}>%</span>
          <button onClick={() => onUpdateFuelSurcharge(zone.id, fuelSurcharge, carrier, methodCode)} style={{ ...btnSmallSuccess, padding: '3px 6px', fontSize: '11px' }}>OK</button>
          <button onClick={() => onDeleteZone(zone.id, carrier, methodCode)} style={{ ...btnSmallDanger, padding: '3px 6px', fontSize: '11px' }}>Suppr.</button>
        </div>
      </div>

      {!isCollapsed && (
        <div style={{ padding: '15px' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <label style={{ ...btnSmallPrimary, display: 'inline-block', marginBottom: 0 }}>
              CSV Import
              <input type="file" accept=".csv,.txt,.tsv" onChange={handleCSVFile} style={{ display: 'none' }} />
            </label>
            <button onClick={() => onAddRate(zone.id, carrier, methodCode)} style={btnSmallPrimary}>+ Tranche manuelle</button>
          </div>

          {/* CSV Preview */}
          {csvPreview && (
        <div style={{ marginBottom: '15px', padding: '12px', backgroundColor: '#fff3cd', borderRadius: '6px', border: '1px solid #ffc107' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <strong>{csvPreview.length} tranches détectées {zone.rates.length > 0 ? `(remplacera les ${zone.rates.length} existantes)` : ''}</strong>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={confirmImport} style={btnSmallSuccess}>Confirmer l'import</button>
              <button onClick={() => { setCsvPreview(null); setCsvErrors([]); }} style={btnSmallDanger}>Annuler</button>
            </div>
          </div>
          {csvErrors.length > 0 && (
            <div style={{ marginBottom: '8px', color: '#dc3545', fontSize: '12px' }}>
              {csvErrors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#e9ecef' }}>
                <th style={thStyle}>De (g)</th>
                <th style={thStyle}>Jusqu'à (g)</th>
                <th style={thStyle}>Prix HT (€)</th>
              </tr>
            </thead>
            <tbody>
              {csvPreview.map((r, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{r.weight_from}</td>
                  <td style={tdStyle}>{r.weight_to}</td>
                  <td style={tdStyle}>{r.price_ht.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

          {zone.rates.length === 0 && !csvPreview ? (
            <p style={{ color: '#999', fontSize: '13px' }}>Aucune tranche configurée</p>
          ) : !csvPreview && (
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' }}>
              <thead>
                <tr style={{ backgroundColor: '#e9ecef' }}>
                  <th style={thStyle}>De (g)</th>
                  <th style={thStyle}>Jusqu'à (g)</th>
                  <th style={thStyle}>Prix HT (€)</th>
                  <th style={{ ...thStyle, width: '150px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {zone.rates.map(rate => (
                  <RateRow
                    key={rate.id}
                    rate={rate}
                    onSave={(data) => onUpdateRate(rate.id, data, carrier, methodCode)}
                    onDelete={() => onDeleteRate(rate.id, carrier, methodCode)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

// Rate row component with local state
const RateRow = ({ rate, onSave, onDelete }) => {
  const [weightFrom, setWeightFrom] = useState(rate.weight_from);
  const [weightTo, setWeightTo] = useState(rate.weight_to);
  const [priceHt, setPriceHt] = useState(rate.price_ht);

  return (
    <tr>
      <td style={tdStyle}>
        <input type="number" value={weightFrom} onChange={(e) => setWeightFrom(parseFloat(e.target.value) || 0)} style={inputTableStyle} />
      </td>
      <td style={tdStyle}>
        <input type="number" value={weightTo} onChange={(e) => setWeightTo(parseFloat(e.target.value) || 0)} style={inputTableStyle} />
      </td>
      <td style={tdStyle}>
        <input type="number" step="0.01" value={priceHt} onChange={(e) => setPriceHt(parseFloat(e.target.value) || 0)} style={inputTableStyle} />
      </td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        <button onClick={() => onSave({ weight_from: weightFrom, weight_to: weightTo, price_ht: priceHt })} style={btnSmallSuccess}>Sauver</button>
        <button onClick={onDelete} style={{ ...btnSmallDanger, marginLeft: '5px' }}>Suppr</button>
      </td>
    </tr>
  );
};

// Payment method row component with local state
const PaymentMethodRow = ({ method, onSave, saving }) => {
  const [fixedFee, setFixedFee] = useState(method.fixed_fee);
  const [percentFee, setPercentFee] = useState(method.percent_fee);

  return (
    <tr>
      <td style={tdStyle}><strong>{method.name}</strong></td>
      <td style={tdStyle}>
        <input type="number" step="0.01" value={fixedFee} onChange={(e) => setFixedFee(parseFloat(e.target.value) || 0)} style={inputTableStyle} />
      </td>
      <td style={tdStyle}>
        <input type="number" step="0.01" value={percentFee} onChange={(e) => setPercentFee(parseFloat(e.target.value) || 0)} style={inputTableStyle} />
      </td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        <button onClick={() => onSave({ ...method, fixed_fee: fixedFee, percent_fee: percentFee })} disabled={saving} style={btnSmallSuccess}>Sauver</button>
      </td>
    </tr>
  );
};

// Styles
const btnPrimary = { padding: '8px 16px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' };
const btnSuccess = { padding: '8px 16px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' };
const btnSmallPrimary = { padding: '4px 10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' };
const btnSmallSuccess = { padding: '4px 8px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '12px' };
const btnSmallDanger = { padding: '4px 8px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '12px' };
const btnWhite = { padding: '10px 20px', backgroundColor: '#fff', color: '#135E84', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '600' };
const inputStyle = { padding: '8px', border: '1px solid #ccc', borderRadius: '4px' };
const inputTableStyle = { width: '100%', padding: '4px', border: '1px solid #ccc', borderRadius: '3px' };
const thStyle = { padding: '8px', textAlign: 'left', border: '1px solid #dee2e6' };
const tdStyle = { padding: '8px', border: '1px solid #dee2e6' };

export default ShippingSettings;
