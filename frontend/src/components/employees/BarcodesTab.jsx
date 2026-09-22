import { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import axios from 'axios';
import { AuthContext } from '../../context/AuthContext';
import { ean13Svg, formatBarcode } from '../../utils/ean13';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE (alignée ATB / Boutique / Rapport) ─────────── */
const C = {
  app: '#4338CA', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  greyBg: '#F9FAFB', dark: '#2a2e38', white: '#FFFFFF',
  green: '#059669', red: '#DE2020', amber: '#B45309',
};

const fullName = (e) => `${e.first_name} ${e.last_name}`.trim();

/** Nom de fichier sans accent ni espace : « Gaïa Iaggi » → « Gaia_Iaggi.svg ». */
const fileNameOf = (e) => `${fullName(e)}`
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9-]+/g, '_')
  .replace(/^_|_$/g, '') + '.svg';

const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

/** Étiquette telle qu'elle sera imprimée : les barres seules, sans texte. */
function BarcodePreview({ code, width = 260 }) {
  const svg = useMemo(() => {
    try { return ean13Svg(code); } catch { return null; }
  }, [code]);
  if (!svg) return <span style={{ color: C.red, fontSize: 12 }}>Code illisible</span>;
  return (
    <div
      style={{ width, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: svg.replace('<?xml version="1.0" encoding="UTF-8"?>\n', '') }}
    />
  );
}

export default function BarcodesTab() {
  const { permissions, isSuperAdmin } = useContext(AuthContext);
  const canWrite = isSuperAdmin || permissions?.employes?.write === true;

  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', user_id: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emp, usr] = await Promise.all([
        axios.get(`${API_URL}/employees`),
        axios.get(`${API_URL}/employees/users`),
      ]);
      setEmployees(emp.data?.data || []);
      setUsers(usr.data?.data || []);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = employees.filter((e) => showArchived || e.active);
  const missing = visible.filter((e) => !e.barcode).length;
  const archivedCount = employees.length - employees.filter((e) => e.active).length;

  const generate = async (employee) => {
    setBusyId(employee.id);
    try {
      const { data } = await axios.post(`${API_URL}/employees/${employee.id}/barcode`);
      setEmployees((prev) => prev.map((e) => (e.id === employee.id ? data.data : e)));
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (employee) => {
    setBusyId(employee.id);
    try {
      const { data } = await axios.put(`${API_URL}/employees/${employee.id}`, { active: !employee.active });
      setEmployees((prev) => prev.map((e) => (e.id === employee.id ? data.data : e)));
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusyId(null);
    }
  };

  const addEmployee = async (event) => {
    event.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) return;
    setBusyId('new');
    try {
      await axios.post(`${API_URL}/employees`, {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        user_id: form.user_id || null,
      });
      setForm({ first_name: '', last_name: '', user_id: '' });
      setAdding(false);
      await load();
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusyId(null);
    }
  };

  /** Télécharge l'étiquette — le SVG exact des originaux, barres seules. */
  const download = (employee) => {
    const blob = new Blob([ean13Svg(employee.barcode)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameOf(employee);
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Planche d'impression. Le nom est écrit HORS de l'étiquette, au-dessus du
   * trait de coupe : l'étiquette elle-même reste barres nues, comme celles de
   * 2026 — mais sans repère on ne saurait pas quelle bande donner à qui.
   */
  const printSheet = (list) => {
    const labels = list.filter((e) => e.barcode);
    if (!labels.length) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Codes-barres employés</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; }
  .lab { break-inside: avoid; page-break-inside: avoid; margin: 0 0 6mm; padding-bottom: 4mm;
         border-bottom: 1px dashed #bbb; }
  .who { font-size: 10pt; color: #444; margin: 0 0 1mm; }
  .num { font-size: 8pt; color: #999; font-family: ui-monospace, monospace; margin: 1mm 0 0; }
  svg { display: block; }
</style></head><body>
${labels.map((e) => `<div class="lab"><p class="who">${fullName(e)}</p>`
  + `${ean13Svg(e.barcode).replace('<?xml version="1.0" encoding="UTF-8"?>\n', '')}`
  + `<p class="num">${formatBarcode(e.barcode)}</p></div>`).join('')}
</body></html>`;
    // iframe caché plutôt qu'un onglet : un bloqueur de pop-up ferait échouer
    // l'impression sans rien dire à l'écran.
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.onload = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      // On laisse le temps au dialogue d'impression de prendre la main.
      setTimeout(() => frame.remove(), 60000);
    };
    document.body.appendChild(frame);
    frame.srcdoc = html;
  };

  const btn = (bg, disabled) => ({
    padding: '7px 13px', borderRadius: 8, border: `1px solid ${bg}`,
    background: disabled ? C.greyB : bg, color: disabled ? C.greyT : C.white,
    fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
  });
  const btnGhost = {
    padding: '7px 13px', borderRadius: 8, border: `1px solid ${C.greyB}`,
    background: C.white, color: C.dark, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  };
  const input = {
    padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`,
    fontSize: 13.5, color: C.dark, minWidth: 150,
  };
  const th = {
    textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 700,
    color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3,
    borderBottom: `1px solid ${C.greyB}`, whiteSpace: 'nowrap',
  };
  const td = { padding: '10px 12px', fontSize: 13.5, color: C.dark, borderBottom: `1px solid ${C.greyB}` };

  if (loading) return <div style={{ color: C.greyT, padding: 20 }}>Chargement…</div>;

  return (
    <div>
      {/* ── Barre d'actions ── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {canWrite && (
          <button style={btn(C.app, false)} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Annuler' : '+ Ajouter un salarié'}
          </button>
        )}
        <button style={btnGhost} onClick={() => printSheet(visible)}>Imprimer la planche</button>
        {archivedCount > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.greyT }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Voir les {archivedCount} archivé{archivedCount > 1 ? 's' : ''}
          </label>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: missing ? C.amber : C.greyM, fontWeight: 600 }}>
          {missing
            ? `${missing} salarié${missing > 1 ? 's' : ''} sans code-barre`
            : 'Tout le monde a son code-barre'}
        </span>
      </div>

      {error && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA', color: C.red,
          padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13.5,
        }}>{error}</div>
      )}

      {/* ── Nouveau salarié ── */}
      {adding && canWrite && (
        <form
          onSubmit={addEmployee}
          style={{
            display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
            background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12,
            padding: 14, marginBottom: 16,
          }}
        >
          <input
            style={input} placeholder="Prénom" value={form.first_name} autoFocus
            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
          />
          <input
            style={input} placeholder="Nom" value={form.last_name}
            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
          />
          <select
            style={input} value={form.user_id}
            onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
          >
            <option value="">Compte app — aucun</option>
            {users.filter((u) => !u.employee_id).map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
          <button type="submit" style={btn(C.green, busyId === 'new')} disabled={busyId === 'new'}>
            Enregistrer
          </button>
          <span style={{ fontSize: 12.5, color: C.greyM }}>
            Le code-barre se génère ensuite, depuis la ligne du salarié.
          </span>
        </form>
      )}

      {/* ── Liste ── */}
      <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: C.greyBg }}>
            <tr>
              <th style={th}>Salarié</th>
              <th style={th}>Compte app</th>
              <th style={th}>Code-barre</th>
              <th style={th}>Étiquette</th>
              <th style={th}>Généré le</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id} style={{ opacity: e.active ? 1 : 0.55 }}>
                <td style={td}>
                  <span style={{ fontWeight: 600 }}>{fullName(e)}</span>
                  {!e.active && (
                    <span style={{
                      marginLeft: 8, fontSize: 11, fontWeight: 700, color: C.greyT,
                      background: C.greyB, padding: '2px 7px', borderRadius: 8,
                    }}>ARCHIVÉ</span>
                  )}
                </td>
                <td style={{ ...td, color: C.greyT, fontSize: 12.5 }}>{e.user_email || '—'}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                  {e.barcode ? formatBarcode(e.barcode)
                    : <span style={{ color: C.amber, fontFamily: 'inherit' }}>aucun</span>}
                </td>
                <td style={td}>
                  {e.barcode ? <BarcodePreview code={e.barcode} /> : <span style={{ color: C.greyM }}>—</span>}
                </td>
                <td style={{ ...td, color: C.greyT, fontSize: 12.5, whiteSpace: 'nowrap' }}>
                  {dateFr(e.barcode_generated_at)}
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {!e.barcode && canWrite && (
                    <button
                      style={btn(C.app, busyId === e.id)}
                      disabled={busyId === e.id}
                      onClick={() => generate(e)}
                    >
                      {busyId === e.id ? 'Génération…' : 'Générer'}
                    </button>
                  )}
                  {e.barcode && (
                    <button style={{ ...btnGhost, marginLeft: 8 }} onClick={() => download(e)}>
                      Télécharger
                    </button>
                  )}
                  {canWrite && (
                    <button
                      style={{ ...btnGhost, marginLeft: 8, color: e.active ? C.greyT : C.green }}
                      disabled={busyId === e.id}
                      onClick={() => toggleActive(e)}
                    >
                      {e.active ? 'Archiver' : 'Réactiver'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr><td style={{ ...td, color: C.greyT }} colSpan={6}>Aucun salarié.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12.5, color: C.greyM, marginTop: 14, lineHeight: 1.6 }}>
        Le code suit la série ouverte le 24/04/2026 : <code>2522</code> + initiales (A=01) +
        n° d'ordre + clé EAN-13. Un code déjà attribué ne change jamais, même après un
        changement de nom — l'étiquette collée, elle, ne se met pas à jour. Les étiquettes
        imprimées ne portent aucun texte, comme les originales.
      </p>
    </div>
  );
}
