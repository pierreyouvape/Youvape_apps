import { useState } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = { greyB: '#E5E7EB', greyM: '#8A99A4', dark: '#2a2e38', white: '#FFFFFF', green: '#059669' };

const input = {
  padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`,
  fontSize: 13.5, color: C.dark, minWidth: 150,
};

/**
 * Ajout d'un salarié — partagé par les deux modules : on arrive aussi bien par
 * la liste que par l'écran des codes-barres le jour d'une arrivée.
 * Le code-barre n'est PAS généré ici : il se demande ensuite, explicitement.
 *
 * @param {Array}    users     comptes app (pour le rattachement facultatif)
 * @param {Function} onAdded   rappelé après création, pour recharger la liste
 * @param {Function} onError   remonte le message d'erreur à l'écran parent
 * @param {Function} onCancel  ferme le formulaire
 */
export default function AddEmployeeForm({ users = [], onAdded, onError, onCancel }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', user_id: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) return;
    setBusy(true);
    try {
      await axios.post(`${API_URL}/employees`, {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        user_id: form.user_id || null,
      });
      setForm({ first_name: '', last_name: '', user_id: '' });
      onError?.(null);
      await onAdded?.();
      onCancel?.();
    } catch (e) {
      onError?.(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  // Un compte déjà rattaché, ou désactivé, n'est pas proposé.
  const freeAccounts = users.filter((u) => !u.employee_id && !u.disabled_at);

  return (
    <form
      onSubmit={submit}
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
        {freeAccounts.map((u) => (
          <option key={u.id} value={u.id}>{u.name ? `${u.name} — ${u.email}` : u.email}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={busy}
        style={{
          padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.green}`,
          background: busy ? C.greyB : C.green, color: busy ? C.greyM : C.white,
          fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
        }}
      >
        Enregistrer
      </button>
      <span style={{ fontSize: 12.5, color: C.greyM }}>
        Le code-barre se génère ensuite, depuis la ligne du salarié.
      </span>
    </form>
  );
}
