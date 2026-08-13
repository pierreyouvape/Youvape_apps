import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { Promos as PromosIcon } from '../components/AppIcons';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  promo: '#DB2777', promoF: '#9D174D',
  vert: '#4AB866', rouge: '#DE2020', orange: '#E28F00', bleu: '#0071EB',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

export const STATUSES = [
  { code: 'draft',    label: 'Brouillon', color: '#8A99A4' },
  { code: 'planned',  label: 'À venir',   color: '#0071EB' },
  { code: 'running',  label: 'En cours',  color: '#4AB866' },
  { code: 'done',     label: 'Terminée',  color: '#8B5CF6' },
  { code: 'archived', label: 'Archivée',  color: '#626E85' },
];
export const statusInfo = (code) => STATUSES.find((s) => s.code === code) || STATUSES[0];

export const localYmd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Date pg (Date ou string ISO) → 'YYYY-MM-DD' sans passer par UTC. */
export const toYmd = (v) => {
  if (!v) return '';
  if (v instanceof Date) return localYmd(v);
  return String(v).slice(0, 10);
};

export const prettyDate = (v) => {
  const s = toYmd(v);
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const PromosApp = () => {
  const navigate = useNavigate();
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '', description: '' });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await axios.get(`${API_URL}/promos`);
      setOperations(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createOperation = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await axios.post(`${API_URL}/promos`, {
        name: form.name.trim(),
        description: form.description || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      });
      navigate(`/promos/${res.data.data.id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur à la création');
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (op) => {
    try {
      const res = await axios.post(`${API_URL}/promos/${op.id}/duplicate`, {});
      navigate(`/promos/${res.data.data.id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur à la duplication');
    }
  };

  const remove = async (op) => {
    if (!window.confirm(`Supprimer définitivement l'opération « ${op.name} » et ses ${op.items_count} produit(s) ?`)) return;
    try {
      await axios.delete(`${API_URL}/promos/${op.id}`);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur à la suppression');
    }
  };

  const inputStyle = {
    padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
    fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
  };
  const th = { padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: C.grisM, borderBottom: `1px solid ${C.grisCL}` };
  const td = { padding: '12px', fontSize: 13, color: C.grisTF, borderBottom: `1px solid ${C.grisCL}` };

  return (
    <AppShell currentPath="/promos">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL }}>
        <section style={{ padding: '28px 40px 20px', background: C.blanc, borderBottom: `1px solid ${C.grisCL}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: C.promo, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24 }}>
              <PromosIcon />
            </div>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: C.grisTF, margin: 0, fontFamily: "'Tilt Warp', cursive" }}>
                Actions Promos
              </h1>
              <p style={{ fontSize: 13, color: C.grisM, margin: '3px 0 0' }}>
                Préparer une opération, simuler les remises et les marges, puis mesurer l'effet sur les ventes.
                Aucun tarif n'est envoyé sur le site.
              </p>
            </div>
            <button
              onClick={() => setShowForm((v) => !v)}
              style={{ padding: '10px 18px', borderRadius: 9, border: 'none', background: C.promo, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              {showForm ? 'Annuler' : '+ Nouvelle opération'}
            </button>
          </div>
        </section>

        {showForm && (
          <section style={{ padding: '18px 40px', background: C.blanc, borderBottom: `1px solid ${C.grisCL}` }}>
            <form onSubmit={createOperation} style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 240 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Nom de l'opération *</label>
                <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="ex : Black Friday 2026" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Début</label>
                <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Fin</label>
                <input type="date" value={form.end_date} min={form.start_date || undefined}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 240 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Description (optionnel)</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={inputStyle} />
              </div>
              <button type="submit" disabled={saving || !form.name.trim()}
                style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: C.promo, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: saving || !form.name.trim() ? 0.5 : 1 }}>
                {saving ? 'Création…' : 'Créer'}
              </button>
            </form>
          </section>
        )}

        <section style={{ padding: '24px 40px 60px' }}>
          {error && (
            <div style={{ padding: 14, borderRadius: 10, background: '#FEE', color: C.rouge, marginBottom: 16, fontSize: 13 }}>{error}</div>
          )}

          {loading ? (
            <div style={{ color: C.grisM, fontSize: 14 }}>Chargement…</div>
          ) : operations.length === 0 ? (
            <div style={{ background: C.blanc, border: `1px dashed ${C.grisCL}`, borderRadius: 14, padding: 40, textAlign: 'center', color: C.grisM }}>
              Aucune opération pour le moment. Créez-en une pour commencer à préparer vos remises.
            </div>
          ) : (
            <div style={{ background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Opération</th>
                    <th style={th}>Statut</th>
                    <th style={th}>Période</th>
                    <th style={{ ...th, textAlign: 'right' }}>Produits</th>
                    <th style={{ ...th, textAlign: 'right' }}>Remise moy.</th>
                    <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => {
                    const st = statusInfo(op.status);
                    return (
                      <tr key={op.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/promos/${op.id}`)}>
                        <td style={td}>
                          <div style={{ fontWeight: 700 }}>{op.name}</div>
                          {op.description && <div style={{ fontSize: 12, color: C.grisM, marginTop: 2 }}>{op.description}</div>}
                        </td>
                        <td style={td}>
                          <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: '#fff', background: st.color }}>
                            {st.label}
                          </span>
                        </td>
                        <td style={{ ...td, color: C.grisM }}>
                          {op.start_date || op.end_date ? `${prettyDate(op.start_date)} → ${prettyDate(op.end_date)}` : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{op.items_count}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: op.avg_discount > 0 ? C.promo : C.grisM, fontWeight: 700 }}>
                          {op.avg_discount ? `−${op.avg_discount} %` : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => duplicate(op)} title="Dupliquer"
                            style={{ padding: '5px 10px', marginRight: 6, borderRadius: 7, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisTF, cursor: 'pointer', fontSize: 12 }}>
                            Dupliquer
                          </button>
                          <button onClick={() => remove(op)} title="Supprimer"
                            style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.rouge, cursor: 'pointer', fontSize: 12 }}>
                            Supprimer
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
};

export default PromosApp;
