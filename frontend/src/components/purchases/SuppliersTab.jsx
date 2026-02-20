import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const SuppliersTab = ({ token }) => {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState('');
  const [syncing, setSyncing] = useState(false);

  // Form state
  const [form, setForm] = useState({
    name: '',
    code: '',
    email: '',
    phone: '',
    contact_name: '',
    address: '',
    analysis_period_months: 1,
    coverage_months: 1,
    reception_threshold: 50,
    lead_time_days: 2,
    notes: ''
  });

  // Load suppliers
  const loadSuppliers = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/purchases/suppliers?include_inactive=true`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuppliers(response.data.data || []);
    } catch (err) {
      console.error('Erreur chargement fournisseurs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, [token]);

  // Open modal for new supplier
  const openNewModal = () => {
    setEditingSupplier(null);
    setForm({
      name: '',
      code: '',
      email: '',
      phone: '',
      contact_name: '',
      address: '',
      analysis_period_months: 1,
      coverage_months: 1,
      reception_threshold: 50,
      lead_time_days: 2,
      notes: ''
    });
    setShowModal(true);
  };

  // Open modal for editing
  const openEditModal = (supplier) => {
    setEditingSupplier(supplier);
    setForm({
      name: supplier.name || '',
      code: supplier.code || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      contact_name: supplier.contact_name || '',
      address: supplier.address || '',
      analysis_period_months: supplier.analysis_period_months || 1,
      coverage_months: supplier.coverage_months || 1,
      reception_threshold: supplier.reception_threshold || 50,
      lead_time_days: supplier.lead_time_days || 2,
      notes: supplier.notes || ''
    });
    setShowModal(true);
  };

  // Save supplier
  const handleSave = async () => {
    if (!form.name.trim()) {
      alert('Le nom est requis');
      return;
    }

    try {
      if (editingSupplier) {
        await axios.put(`${API_URL}/purchases/suppliers/${editingSupplier.id}`, form, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } else {
        await axios.post(`${API_URL}/purchases/suppliers`, form, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      setShowModal(false);
      loadSuppliers();
    } catch (err) {
      console.error('Erreur sauvegarde fournisseur:', err);
      alert(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    }
  };

  // Delete supplier
  const handleDelete = async (id) => {
    if (!confirm('Êtes-vous sûr de vouloir désactiver ce fournisseur ?')) return;

    try {
      await axios.delete(`${API_URL}/purchases/suppliers/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadSuppliers();
    } catch (err) {
      console.error('Erreur suppression fournisseur:', err);
      alert('Erreur lors de la suppression');
    }
  };

  // Reactivate supplier
  const handleReactivate = async (id) => {
    try {
      await axios.put(`${API_URL}/purchases/suppliers/${id}`, { is_active: true }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadSuppliers();
    } catch (err) {
      console.error('Erreur réactivation fournisseur:', err);
    }
  };

  // Import CSV
  const handleImport = async () => {
    try {
      const lines = importData.trim().split('\n');
      const suppliers = [];

      for (let i = 1; i < lines.length; i++) { // Skip header
        const cols = lines[i].split(';').map(c => c.trim());
        if (cols[0]) {
          suppliers.push({
            name: cols[0],
            code: cols[1] || null,
            email: cols[2] || null,
            phone: cols[3] || null,
            contact_name: cols[4] || null
          });
        }
      }

      if (suppliers.length === 0) {
        alert('Aucun fournisseur à importer');
        return;
      }

      await axios.post(`${API_URL}/purchases/suppliers/import`, { suppliers }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setShowImportModal(false);
      setImportData('');
      loadSuppliers();
      alert(`${suppliers.length} fournisseur(s) importé(s)`);
    } catch (err) {
      console.error('Erreur import:', err);
      alert('Erreur lors de l\'import');
    }
  };

  // Sync from BMS
  const handleSyncBMS = async () => {
    if (!confirm('Synchroniser les fournisseurs depuis BMS ?\n\nCela va importer/mettre à jour les fournisseurs depuis BoostMyShop.')) {
      return;
    }

    setSyncing(true);
    try {
      const response = await axios.post(`${API_URL}/purchases/suppliers/sync-bms`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const result = response.data.data;
      alert(`Synchronisation terminée !\n\n✓ ${result.created} fournisseur(s) créé(s)\n✓ ${result.updated} fournisseur(s) mis à jour\n\nTotal: ${result.total} fournisseurs BMS`);
      loadSuppliers();
    } catch (err) {
      console.error('Erreur sync BMS:', err);
      alert(err.response?.data?.error || 'Erreur lors de la synchronisation BMS');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="suppliers-tab">
      <div className="purchases-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>Fournisseurs ({suppliers.length})</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn"
              onClick={handleSyncBMS}
              disabled={syncing}
              style={{
                background: '#6366f1',
                color: 'white',
                border: 'none',
                opacity: syncing ? 0.7 : 1
              }}
            >
              {syncing ? '⏳ Sync...' : '🔄 Sync BMS'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowImportModal(true)}>
              📥 Import CSV
            </button>
            <button className="btn btn-primary" onClick={openNewModal}>
              + Nouveau fournisseur
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
          </div>
        ) : suppliers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏭</div>
            <p>Aucun fournisseur configuré</p>
            <button className="btn btn-primary" onClick={openNewModal}>
              Ajouter un fournisseur
            </button>
          </div>
        ) : (
          <table className="purchases-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Code</th>
                <th>Contact</th>
                <th className="text-center">Période analyse</th>
                <th className="text-center">Couverture</th>
                <th className="text-center">Seuil réception</th>
                <th className="text-center">Produits</th>
                <th className="text-center">Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map(supplier => (
                <tr key={supplier.id} style={{ opacity: supplier.is_active ? 1 : 0.5 }}>
                  <td>
                    <strong>{supplier.name}</strong>
                  </td>
                  <td>
                    <code>{supplier.code || '-'}</code>
                  </td>
                  <td>
                    <div style={{ fontSize: '13px' }}>
                      {supplier.contact_name && <div>{supplier.contact_name}</div>}
                      {supplier.email && <div style={{ color: '#666' }}>{supplier.email}</div>}
                      {supplier.phone && <div style={{ color: '#666' }}>{supplier.phone}</div>}
                    </div>
                  </td>
                  <td className="text-center">{supplier.analysis_period_months} mois</td>
                  <td className="text-center">{supplier.coverage_months} mois</td>
                  <td className="text-center">{supplier.reception_threshold}%</td>
                  <td className="text-center">
                    <span style={{
                      background: '#e0f2fe',
                      color: '#0369a1',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontSize: '12px'
                    }}>
                      {supplier.product_count || 0}
                    </span>
                  </td>
                  <td className="text-center">
                    {supplier.is_active ? (
                      <span className="status-badge status-confirmed">Actif</span>
                    ) : (
                      <span className="status-badge status-cancelled">Inactif</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => openEditModal(supplier)}
                        title="Modifier"
                      >
                        ✏️
                      </button>
                      {supplier.is_active ? (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(supplier.id)}
                          title="Désactiver"
                        >
                          🗑️
                        </button>
                      ) : (
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => handleReactivate(supplier.id)}
                          title="Réactiver"
                        >
                          ✓
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal création/édition */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingSupplier ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Nom *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Nom du fournisseur"
                  />
                </div>
                <div className="form-group">
                  <label>Code</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={e => setForm({ ...form, code: e.target.value })}
                    placeholder="Code interne"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Téléphone</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Nom du contact</label>
                <input
                  type="text"
                  value={form.contact_name}
                  onChange={e => setForm({ ...form, contact_name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Adresse</label>
                <textarea
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  rows={2}
                />
              </div>

              <h4 style={{ marginTop: '20px', marginBottom: '15px', color: '#666' }}>
                Paramètres de calcul
              </h4>

              <div className="form-row">
                <div className="form-group">
                  <label>Période d'analyse (mois)</label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={form.analysis_period_months}
                    onChange={e => setForm({ ...form, analysis_period_months: parseInt(e.target.value) || 1 })}
                  />
                </div>
                <div className="form-group">
                  <label>Couverture souhaitée (mois)</label>
                  <input
                    type="number"
                    min="0.5"
                    max="6"
                    step="0.5"
                    value={form.coverage_months}
                    onChange={e => setForm({ ...form, coverage_months: parseFloat(e.target.value) || 1 })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Seuil de réception (%)</label>
                  <input
                    type="number"
                    min="10"
                    max="100"
                    value={form.reception_threshold}
                    onChange={e => setForm({ ...form, reception_threshold: parseInt(e.target.value) || 50 })}
                  />
                  <small style={{ color: '#666' }}>% d'articles reçus pour détecter une réception</small>
                </div>
                <div className="form-group">
                  <label>Délai de livraison (jours)</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={form.lead_time_days}
                    onChange={e => setForm({ ...form, lead_time_days: parseInt(e.target.value) || 2 })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                {editingSupplier ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal import CSV */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import CSV de fournisseurs</h3>
              <button className="modal-close" onClick={() => setShowImportModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '15px', color: '#666' }}>
                Format attendu : <code>Nom;Code;Email;Téléphone;Contact</code>
              </p>
              <div className="form-group">
                <label>Coller les données CSV</label>
                <textarea
                  value={importData}
                  onChange={e => setImportData(e.target.value)}
                  rows={10}
                  placeholder="Nom;Code;Email;Téléphone;Contact&#10;Fournisseur 1;F001;contact@fournisseur1.com;0123456789;Jean Dupont"
                  style={{ fontFamily: 'monospace', fontSize: '12px' }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowImportModal(false)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={handleImport}>
                Importer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuppliersTab;
