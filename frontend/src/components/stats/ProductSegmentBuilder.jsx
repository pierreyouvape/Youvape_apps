import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import axios from 'axios';
import { AuthContext } from '../../context/AuthContext';
import { FILTER_FIELDS, OPERATORS, fieldByKey, fieldType, opNeedsNoValue, defaultFilterFor } from './segmentFields';

const API_BASE_URL = '/api';

// Groupes de champs pour le <select> (optgroup)
const FIELD_GROUPS = FILTER_FIELDS.reduce((acc, f) => {
  (acc[f.group] = acc[f.group] || []).push(f);
  return acc;
}, {});

const inputStyle = { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', background: '#fff' };
const btn = (bg, fg = '#fff') => ({ padding: '8px 14px', backgroundColor: bg, color: fg, border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 600 });

/**
 * Constructeur de segments façon Metorik.
 * Props :
 *   filters, matchType        — état "brouillon" (contrôlé par le parent)
 *   onFiltersChange, onMatchTypeChange
 *   onApply()                 — applique le brouillon (déclenche le fetch)
 *   onClear()                 — remet à zéro (parent)
 *   onLoadSegment(seg)        — charge un segment (parent applique filters+matchType)
 *   resultCount               — nb de produits du résultat courant (affichage bouton export/appliquer)
 */
export default function ProductSegmentBuilder({
  filters, matchType, onFiltersChange, onMatchTypeChange, onApply, onClear, onLoadSegment,
}) {
  const { token } = useContext(AuthContext);
  const [segments, setSegments] = useState([]);
  const [activeSegmentId, setActiveSegmentId] = useState('');

  const authHeaders = useMemo(() => (token ? { headers: { Authorization: `Bearer ${token}` } } : {}), [token]);

  const loadSegments = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/products/segments`);
      if (res.data.success) setSegments(res.data.data);
    } catch (err) { console.error('Erreur chargement segments:', err); }
  }, []);

  useEffect(() => { loadSegments(); }, [loadSegments]);

  const activeSegment = useMemo(
    () => segments.find((s) => String(s.id) === String(activeSegmentId)) || null,
    [segments, activeSegmentId]
  );

  // Le brouillon diffère-t-il du segment chargé ? (pour proposer "Mettre à jour")
  const isDirty = useMemo(() => {
    if (!activeSegment) return false;
    return JSON.stringify(activeSegment.filters) !== JSON.stringify(filters)
      || (activeSegment.matchType || 'all') !== matchType;
  }, [activeSegment, filters, matchType]);

  // ─── Édition des filtres ──────────────────────────────────────────────
  const patchFilter = (i, patch) => onFiltersChange(filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const changeField = (i, newField) => onFiltersChange(filters.map((f, idx) => (idx === i ? defaultFilterFor(newField) : f)));
  const changeOp = (i, op) => onFiltersChange(filters.map((f, idx) => (idx === i ? { ...f, op, ...(op === 'between' ? {} : { value2: '' }) } : f)));
  const addFilter = () => onFiltersChange([...(filters || []), defaultFilterFor('stock')]);
  const removeFilter = (i) => onFiltersChange(filters.filter((_, idx) => idx !== i));

  // ─── Segments enregistrés ─────────────────────────────────────────────
  const handleSelectSegment = (id) => {
    setActiveSegmentId(id);
    if (!id) return;
    const seg = segments.find((s) => String(s.id) === String(id));
    if (seg) onLoadSegment({ filters: seg.filters || [], matchType: seg.matchType || 'all' });
  };

  const saveNew = async () => {
    if (!token) return alert('Session expirée — reconnecte-toi pour enregistrer un segment.');
    if (!filters || filters.length === 0) return alert('Ajoute au moins un filtre avant d\'enregistrer.');
    const name = window.prompt('Nom du segment ?');
    if (!name || !name.trim()) return;
    try {
      const res = await axios.post(`${API_BASE_URL}/products/segments`, { name: name.trim(), matchType, filters }, authHeaders);
      if (res.data.success) { await loadSegments(); setActiveSegmentId(String(res.data.data.id)); }
    } catch (err) {
      console.error('Erreur enregistrement segment:', err);
      alert(err.response?.data?.error || 'Erreur lors de l\'enregistrement.');
    }
  };

  const updateActive = async () => {
    if (!token) return alert('Session expirée — reconnecte-toi.');
    if (!activeSegment) return;
    try {
      const res = await axios.put(`${API_BASE_URL}/products/segments/${activeSegment.id}`, { matchType, filters }, authHeaders);
      if (res.data.success) await loadSegments();
    } catch (err) {
      console.error('Erreur mise à jour segment:', err);
      alert(err.response?.data?.error || 'Erreur lors de la mise à jour.');
    }
  };

  const renameActive = async () => {
    if (!token || !activeSegment) return;
    const name = window.prompt('Nouveau nom du segment :', activeSegment.name);
    if (!name || !name.trim()) return;
    try {
      const res = await axios.put(`${API_BASE_URL}/products/segments/${activeSegment.id}`, { name: name.trim() }, authHeaders);
      if (res.data.success) await loadSegments();
    } catch (err) { console.error(err); alert('Erreur lors du renommage.'); }
  };

  const deleteActive = async () => {
    if (!token || !activeSegment) return;
    if (!window.confirm(`Supprimer le segment « ${activeSegment.name} » ?`)) return;
    try {
      await axios.delete(`${API_BASE_URL}/products/segments/${activeSegment.id}`, authHeaders);
      setActiveSegmentId('');
      await loadSegments();
      onClear();
    } catch (err) {
      console.error('Erreur suppression segment:', err);
      alert(err.response?.data?.error || 'Erreur lors de la suppression.');
    }
  };

  const clearAll = () => { setActiveSegmentId(''); onClear(); };

  // ─── Rendu d'une ligne de filtre ──────────────────────────────────────
  const renderValueInput = (f, i) => {
    const type = fieldType(f.field);
    if (opNeedsNoValue(f.op)) return null;

    if (type === 'number') {
      if (f.op === 'between') {
        return (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="number" value={f.value} placeholder="min" onChange={(e) => patchFilter(i, { value: e.target.value })} style={{ ...inputStyle, width: '90px' }} />
            <span style={{ color: '#adb5bd' }}>et</span>
            <input type="number" value={f.value2} placeholder="max" onChange={(e) => patchFilter(i, { value2: e.target.value })} style={{ ...inputStyle, width: '90px' }} />
          </div>
        );
      }
      return <input type="number" value={f.value} onChange={(e) => patchFilter(i, { value: e.target.value })} style={{ ...inputStyle, width: '120px' }} />;
    }

    if (type === 'date') {
      if (f.op === 'over_days_ago' || f.op === 'within_days') {
        return (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="number" value={f.value} onChange={(e) => patchFilter(i, { value: e.target.value })} style={{ ...inputStyle, width: '90px' }} />
            <span style={{ fontSize: '13px', color: '#6c757d' }}>jours</span>
          </div>
        );
      }
      return <input type="date" value={f.value} onChange={(e) => patchFilter(i, { value: e.target.value })} style={{ ...inputStyle }} />;
    }

    if (type === 'enum') {
      const opts = fieldByKey(f.field)?.options || [];
      return (
        <select value={f.value} onChange={(e) => patchFilter(i, { value: e.target.value })} style={{ ...inputStyle, minWidth: '140px' }}>
          <option value="">— choisir —</option>
          {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      );
    }

    // text
    return <input type="text" value={f.value} placeholder="valeur" onChange={(e) => patchFilter(i, { value: e.target.value })} style={{ ...inputStyle, width: '180px' }} />;
  };

  return (
    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px 18px', marginBottom: '22px', boxShadow: '0 2px 6px rgba(0,0,0,0.05)' }}>
      {/* Barre supérieure : match all/any + segments enregistrés */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#374151' }}>
          <span style={{ fontWeight: 600 }}>Correspondre à</span>
          <select value={matchType} onChange={(e) => onMatchTypeChange(e.target.value)} style={inputStyle}>
            <option value="all">toutes</option>
            <option value="any">au moins une</option>
          </select>
          <span style={{ fontWeight: 600 }}>de ces conditions</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <select value={activeSegmentId} onChange={(e) => handleSelectSegment(e.target.value)} style={{ ...inputStyle, minWidth: '190px' }}>
            <option value="">📂 Charger un segment…</option>
            {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {activeSegment ? (
            <>
              <button onClick={updateActive} disabled={!isDirty} title="Écraser le segment avec les filtres actuels"
                style={{ ...btn(isDirty ? '#135E84' : '#c7d2da'), cursor: isDirty ? 'pointer' : 'not-allowed' }}>💾 Mettre à jour</button>
              <button onClick={renameActive} style={btn('#6c757d')} title="Renommer">✎</button>
              <button onClick={deleteActive} style={btn('#b02a37')} title="Supprimer ce segment">🗑</button>
            </>
          ) : (
            <button onClick={saveNew} style={btn('#1D6F42')}>💾 Enregistrer le segment</button>
          )}
        </div>
      </div>

      {/* Lignes de filtres */}
      {(!filters || filters.length === 0) && (
        <div style={{ fontSize: '13px', color: '#8a99a4', padding: '6px 0 12px' }}>
          Aucun filtre — le tableau affiche tous les produits. Ajoute une condition ci-dessous.
        </div>
      )}
      {filters.map((f, i) => {
        const type = fieldType(f.field);
        return (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
            <select value={f.field} onChange={(e) => changeField(i, e.target.value)} style={{ ...inputStyle, minWidth: '190px' }}>
              {Object.entries(FIELD_GROUPS).map(([group, flds]) => (
                <optgroup key={group} label={group}>
                  {flds.map((fld) => <option key={fld.key} value={fld.key}>{fld.label}</option>)}
                </optgroup>
              ))}
            </select>
            <select value={f.op} onChange={(e) => changeOp(i, e.target.value)} style={{ ...inputStyle, minWidth: '150px' }}>
              {OPERATORS[type].map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            {renderValueInput(f, i)}
            <button onClick={() => removeFilter(i)} title="Retirer" style={{ ...btn('#f1f3f5', '#868e96'), padding: '6px 11px' }}>✕</button>
          </div>
        );
      })}

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginTop: '6px' }}>
        <button onClick={addFilter} style={{ ...btn('#fff', '#135E84'), border: '1px solid #135E84' }}>＋ Ajouter un filtre</button>
        <div style={{ flex: 1 }} />
        {(filters.length > 0 || activeSegment) && <button onClick={clearAll} style={{ ...btn('#fff', '#b02a37'), border: '1px solid #e0a0a0' }}>Effacer</button>}
        <button onClick={onApply} style={btn('#135E84')}>▶ Appliquer</button>
      </div>
    </div>
  );
}
