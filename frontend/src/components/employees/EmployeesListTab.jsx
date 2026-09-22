import { useState, useEffect, useCallback, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../../context/AuthContext';
import { formatBarcode } from '../../utils/ean13';
import AddEmployeeForm from './AddEmployeeForm';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE (alignée ATB / Boutique / Rapport) ─────────── */
const C = {
  app: '#4338CA', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  greyBg: '#F9FAFB', dark: '#2a2e38', white: '#FFFFFF',
  green: '#059669', red: '#DE2020', amber: '#B45309',
};

const fullName = (e) => `${e.first_name} ${e.last_name}`.trim();
const plural = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

const btnGhost = {
  padding: '7px 13px', borderRadius: 8, border: `1px solid ${C.greyB}`,
  background: C.white, color: C.dark, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnSolid = (bg, disabled) => ({
  padding: '7px 13px', borderRadius: 8, border: `1px solid ${bg}`,
  background: disabled ? C.greyB : bg, color: disabled ? C.greyT : C.white,
  fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
});
const input = {
  padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.greyB}`,
  fontSize: 13.5, color: C.dark, width: '100%', maxWidth: 160,
};
const th = {
  textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 700,
  color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3,
  borderBottom: `1px solid ${C.greyB}`, whiteSpace: 'nowrap',
};
const td = { padding: '10px 12px', fontSize: 13.5, color: C.dark, borderBottom: `1px solid ${C.greyB}` };

function Chip({ children, color = C.greyT, bg = C.greyB }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color, background: bg,
      padding: '2px 7px', borderRadius: 8, marginLeft: 6, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/**
 * Confirmation d'un départ. Rien n'est supprimé : on annonce ce qui se ferme
 * (les droits, la connexion, le profil dans Réglages) et ce qui reste (tout ce
 * que la personne a fait, qui garde son nom).
 */
function DeactivateModal({ impact, busy, onCancel, onConfirm }) {
  const [keepAccount, setKeepAccount] = useState(false);
  const e = impact.employee;

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        style={{
          background: C.white, borderRadius: 16, padding: 24, maxWidth: 580, width: '100%',
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: C.dark }}>
          Départ de {fullName(e)} ?
        </h2>

        <p style={{ margin: '14px 0 0', fontSize: 13, fontWeight: 700, color: C.dark }}>Ce qui se ferme</p>
        <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 13.5, color: C.dark, lineHeight: 1.75 }}>
          <li>Sa fiche passe en archivé{e.barcode && <> — son code-barre reste le sien, il n'est jamais réattribué</>}.</li>
          {impact.has_account && !keepAccount ? (
            <>
              <li>
                Le compte <strong>{e.user_email}</strong> perd ses droits
                {impact.app_count > 0 && <> sur {plural(impact.app_count, 'app')}</>}.
              </li>
              <li>La connexion lui est refusée, et sa session en cours cesse de fonctionner.</li>
              <li>Son profil disparaît de la grille des permissions, dans Réglages.</li>
            </>
          ) : impact.has_account ? (
            <li>Le compte <strong>{e.user_email}</strong> et ses droits sont conservés tels quels.</li>
          ) : (
            <li>Aucun compte app n'est rattaché : rien d'autre ne bouge.</li>
          )}
        </ul>

        <p style={{ margin: '16px 0 0', fontSize: 13, fontWeight: 700, color: C.dark }}>Ce qui reste</p>
        <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 13.5, color: C.dark, lineHeight: 1.75 }}>
          {impact.history.length > 0 ? (
            <li>
              Tout ce qu'{fullName(e)} a fait garde son nom :{' '}
              {impact.history.map((h, i) => (
                <span key={h.table}>
                  {i > 0 && (i === impact.history.length - 1 ? ' et ' : ', ')}
                  <strong>{h.count}</strong> {h.label}
                </span>
              ))}
              .
            </li>
          ) : (
            <li>Rien n'est effacé — le compte n'a encore laissé aucune trace en base.</li>
          )}
          <li>Le retour est possible à tout moment : « Réactiver » rouvre la connexion (les droits, eux, se redonnent dans Réglages).</li>
        </ul>

        {impact.has_account && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 16,
            fontSize: 13, color: C.greyT,
          }}>
            <input
              type="checkbox"
              checked={keepAccount}
              onChange={(ev) => setKeepAccount(ev.target.checked)}
            />
            Archiver la fiche sans toucher au compte (fiche en double, compte partagé…)
          </label>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button style={btnGhost} onClick={onCancel} disabled={busy}>Annuler</button>
          <button
            style={btnSolid(C.red, busy)}
            disabled={busy}
            onClick={() => onConfirm(keepAccount)}
          >
            {busy ? 'En cours…' : 'Désactiver'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EmployeesListTab() {
  const { permissions, isSuperAdmin, isAdmin } = useContext(AuthContext);
  const canWrite = isSuperAdmin || permissions?.employes?.write === true;
  // Ouvrir ou fermer l'accès de quelqu'un : réservé aux administrateurs.
  const canDeactivate = canWrite && (isSuperAdmin || isAdmin === true);

  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [orphans, setOrphans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);   // { id, first_name, last_name }
  const [confirming, setConfirming] = useState(null); // impact
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emp, usr, orp] = await Promise.all([
        axios.get(`${API_URL}/employees`),
        axios.get(`${API_URL}/employees/users`),
        axios.get(`${API_URL}/employees/orphan-accounts`),
      ]);
      setEmployees(emp.data?.data || []);
      setUsers(usr.data?.data || []);
      setOrphans(orp.data?.data || []);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = async (employee, body) => {
    setBusyId(employee.id);
    try {
      await axios.put(`${API_URL}/employees/${employee.id}`, body);
      await load();
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusyId(null);
    }
  };

  const askDeactivate = async (employee) => {
    setBusyId(employee.id);
    try {
      const { data } = await axios.get(`${API_URL}/employees/${employee.id}/deactivation-impact`);
      setConfirming(data.data);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusyId(null);
    }
  };

  const doDeactivate = async (keepAccount) => {
    const employee = confirming.employee;
    setBusyId('deactivate');
    try {
      const { data } = await axios.post(`${API_URL}/employees/${employee.id}/deactivate`, {
        keep_account: keepAccount,
      });
      setNotice(
        data?.data?.account_action === 'disabled'
          ? `${fullName(employee)} est archivé. Son compte est désactivé, sans droits, et sa session ne fonctionne plus.`
          : `${fullName(employee)} est archivé. Son compte app n'a pas été touché.`,
      );
      setConfirming(null);
      await load();
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusyId(null);
    }
  };

  const doReactivate = async (employee) => {
    setBusyId(employee.id);
    try {
      await axios.post(`${API_URL}/employees/${employee.id}/reactivate`);
      setNotice(
        employee.user_email
          ? `${fullName(employee)} est réactivé. Son compte peut se reconnecter — ses droits d'app sont à redonner dans Réglages.`
          : `${fullName(employee)} est réactivé.`,
      );
      await load();
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async () => {
    const target = employees.find((e) => e.id === editing.id);
    if (!target) return setEditing(null);
    await patch(target, { first_name: editing.first_name, last_name: editing.last_name });
    setEditing(null);
  };

  if (loading) return <div style={{ color: C.greyT, padding: 20 }}>Chargement…</div>;

  const freeAccounts = users.filter((u) => !u.employee_id && !u.disabled_at);
  const archived = employees.filter((e) => !e.active).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {canWrite && (
          <button style={btnSolid(C.app, false)} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Annuler' : '+ Ajouter un salarié'}
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: C.greyM }}>
          {plural(employees.length, 'salarié')}
          {archived > 0 && ` · ${archived} archivé${archived > 1 ? 's' : ''}`}
        </span>
      </div>

      {adding && canWrite && (
        <AddEmployeeForm
          users={users}
          onAdded={load}
          onError={setError}
          onCancel={() => setAdding(false)}
        />
      )}

      {error && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA', color: C.red,
          padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13.5,
        }}>{error}</div>
      )}
      {notice && (
        <div style={{
          background: '#ECFDF5', border: '1px solid #A7F3D0', color: C.green,
          padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13.5,
          display: 'flex', justifyContent: 'space-between', gap: 12,
        }}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.green }}>✕</button>
        </div>
      )}

      <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: C.greyBg }}>
            <tr>
              <th style={th}>Salarié</th>
              <th style={th}>Compte app</th>
              <th style={th}>Droits</th>
              <th style={th}>Code-barre</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const isEditing = editing?.id === e.id;
              return (
                <tr key={e.id} style={{ opacity: e.active ? 1 : 0.55 }}>
                  <td style={td}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          style={input} value={editing.first_name} autoFocus
                          onChange={(ev) => setEditing((f) => ({ ...f, first_name: ev.target.value }))}
                        />
                        <input
                          style={input} value={editing.last_name}
                          onChange={(ev) => setEditing((f) => ({ ...f, last_name: ev.target.value }))}
                        />
                      </div>
                    ) : (
                      <>
                        <span style={{ fontWeight: 600 }}>{fullName(e)}</span>
                        {!e.active && <Chip>ARCHIVÉ</Chip>}
                      </>
                    )}
                  </td>

                  <td style={{ ...td, fontSize: 12.5 }}>
                    {canWrite ? (
                      <select
                        value={e.user_id || ''}
                        disabled={busyId === e.id}
                        onChange={(ev) => patch(e, { user_id: ev.target.value || null })}
                        style={{ ...input, maxWidth: 230 }}
                      >
                        <option value="">Aucun compte</option>
                        {e.user_id && <option value={e.user_id}>{e.user_email}</option>}
                        {freeAccounts.map((u) => (
                          <option key={u.id} value={u.id}>{u.email}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ color: C.greyT }}>{e.user_email || '—'}</span>
                    )}
                    {e.user_is_admin && <Chip color="#1D4ED8" bg="#DBEAFE">ADMIN</Chip>}
                    {e.user_disabled_at && <Chip color={C.red} bg="#FEE2E2">DÉSACTIVÉ</Chip>}
                  </td>

                  <td style={{ ...td, color: C.greyT, fontSize: 12.5, whiteSpace: 'nowrap' }}>
                    {e.user_id ? plural(e.app_count || 0, 'app') : '—'}
                  </td>

                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                    {e.barcode ? formatBarcode(e.barcode)
                      : <span style={{ color: C.amber, fontFamily: 'inherit' }}>aucun</span>}
                  </td>

                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <>
                        <button style={btnSolid(C.green, busyId === e.id)} onClick={saveEdit}>Enregistrer</button>
                        <button style={{ ...btnGhost, marginLeft: 8 }} onClick={() => setEditing(null)}>Annuler</button>
                      </>
                    ) : (
                      <>
                        {canWrite && (
                          <button
                            style={btnGhost}
                            onClick={() => setEditing({ id: e.id, first_name: e.first_name, last_name: e.last_name })}
                          >
                            Renommer
                          </button>
                        )}
                        {canDeactivate && (
                          e.active ? (
                            <button
                              style={{ ...btnGhost, marginLeft: 8, color: C.red, borderColor: '#FECACA' }}
                              disabled={busyId === e.id}
                              onClick={() => askDeactivate(e)}
                            >
                              Désactiver
                            </button>
                          ) : (
                            <button
                              style={{ ...btnGhost, marginLeft: 8, color: C.green }}
                              disabled={busyId === e.id}
                              onClick={() => doReactivate(e)}
                            >
                              Réactiver
                            </button>
                          )
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {!employees.length && (
              <tr><td style={{ ...td, color: C.greyT }} colSpan={5}>Aucun salarié.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Comptes app sans salarié : comptes partagés, ou restes d'un départ ── */}
      {orphans.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: C.dark, margin: '26px 0 10px' }}>
            Comptes app rattachés à personne
          </h3>
          <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {orphans.map((u) => (
                  <tr key={u.id}>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{u.name || '—'}</span>
                      <span style={{ color: C.greyT, fontSize: 12.5, marginLeft: 8 }}>{u.email}</span>
                      {u.is_admin && <Chip color="#1D4ED8" bg="#DBEAFE">ADMIN</Chip>}
                      {u.disabled_at && <Chip color={C.red} bg="#FEE2E2">DÉSACTIVÉ</Chip>}
                    </td>
                    <td style={{ ...td, color: C.greyT, fontSize: 12.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {plural(u.app_count || 0, 'app')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12.5, color: C.greyM, marginTop: 8, lineHeight: 1.6 }}>
            Un compte partagé (« Préparateur ») n'a pas de salarié, c'est normal. Pour rattacher un
            compte à quelqu'un, choisissez-le dans la colonne « Compte app » de sa ligne.
          </p>
        </>
      )}

      <p style={{ fontSize: 12.5, color: C.greyM, marginTop: 18, lineHeight: 1.6 }}>
        Rien ne se supprime ici{canDeactivate ? '' : ' (la désactivation est réservée aux administrateurs)'}.
        <strong> Désactiver</strong> archive la fiche, efface les droits du compte, refuse la
        connexion et invalide la session en cours ; le profil sort de la grille des permissions
        dans Réglages. Tout ce que la personne a fait — étiquettes, commandes, tickets — garde son
        nom. <strong>Réactiver</strong> rouvre la connexion ; les droits d'app se redonnent
        ensuite dans Réglages.
      </p>

      {confirming && (
        <DeactivateModal
          impact={confirming}
          busy={busyId === 'deactivate'}
          onCancel={() => setConfirming(null)}
          onConfirm={doDeactivate}
        />
      )}
    </div>
  );
}
