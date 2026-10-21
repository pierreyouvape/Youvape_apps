import { useState, useMemo } from 'react';
import { C } from './processConstants';

/**
 * Choix de visibilité d'un process. Composant contrôlé, sans appel réseau :
 * le parent décide s'il persiste à chaque changement (fiche existante) ou à
 * l'enregistrement (formulaire de création).
 *
 * Ne doit être monté que pour un admin — c'est le seul rôle habilité à donner
 * des accès. Le backend le vérifie de son côté (checkAdmin).
 *
 * Props :
 *   users       [{ id, name, email }]  tous les utilisateurs de l'app
 *   visibility  'restricted' | 'all'
 *   access      [{ user_id, can_write }]
 *   onChange    ({ visibility, access }) => void
 *
 * « Tout le monde » coche tout le monde, en lecture ou en écriture : la liste
 * montre alors chacun à son niveau réel. Retirer une seule personne fait
 * forcément repasser en « Utilisateurs choisis », avec tous les autres gardés.
 *   Tout le monde en lecture  → visibility 'all', aucune entrée (écriture : admins seuls)
 *   Tout le monde en écriture → visibility 'all', tout le monde en écriture
 */

const LEVELS = [
  { key: 'none',  label: '—',        hint: 'Aucun accès' },
  { key: 'read',  label: 'Lecture',  hint: 'Peut consulter' },
  { key: 'write', label: 'Écriture', hint: 'Peut consulter et modifier' },
];

/** Niveau réel : l'entrée nominative, sinon la lecture que donne « Tout le monde ». */
const levelOf = (entry, visibility) =>
  (entry ? (entry.can_write ? 'write' : 'read') : visibility === 'all' ? 'read' : 'none');

export default function ProcessAccessPanel({ users, visibility, access, onChange }) {
  const [search, setSearch] = useState('');

  const byUser = useMemo(() => {
    const m = new Map();
    (access || []).forEach((a) => m.set(a.user_id, a));
    return m;
  }, [access]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
  }, [users, search]);

  const isAll = visibility === 'all';

  /** Tout le monde, chacun à son niveau réel — base d'un passage en « choisis ». */
  const effectiveAccess = () => users.map((u) => {
    const entry = byUser.get(u.id);
    return { user_id: u.id, can_write: !!entry?.can_write };
  });

  const setLevel = (userId, level) => {
    if (isAll) {
      if (level === 'none') {
        // Retirer quelqu'un de « Tout le monde » = choisir tous les autres.
        onChange({
          visibility: 'restricted',
          access: effectiveAccess().filter((a) => a.user_id !== userId),
        });
        return;
      }
      // La lecture vient déjà de « Tout le monde » : seule l'écriture s'inscrit.
      const next = (access || []).filter((a) => a.user_id !== userId);
      if (level === 'write') next.push({ user_id: userId, can_write: true });
      onChange({ visibility, access: next });
      return;
    }
    const next = (access || []).filter((a) => a.user_id !== userId);
    if (level === 'read') next.push({ user_id: userId, can_write: false });
    if (level === 'write') next.push({ user_id: userId, can_write: true });
    onChange({ visibility, access: next });
  };

  const allWrite = isAll && users.length > 0 && users.every((u) => byUser.get(u.id)?.can_write);
  const mode = !isAll ? 'restricted' : allWrite ? 'all-write' : 'all-read';

  const setMode = (m) => {
    if (m === mode) return;
    if (m === 'all-read') onChange({ visibility: 'all', access: [] });
    if (m === 'all-write') onChange({ visibility: 'all', access: users.map((u) => ({ user_id: u.id, can_write: true })) });
    // On garde la sélection en cours : il ne reste qu'à décocher.
    if (m === 'restricted') onChange({ visibility: 'restricted', access: effectiveAccess() });
  };

  const levels = users.map((u) => levelOf(byUser.get(u.id), visibility));
  const readerCount = levels.filter((l) => l !== 'none').length;
  const writerCount = levels.filter((l) => l === 'write').length;

  return (
    <div style={{ border: `1px solid ${C.grisCL}`, borderRadius: 12, background: C.blanc, overflow: 'hidden' }}>

      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.grisCL}`, background: C.grisTL }}>
        <p style={{ fontSize: 12, fontWeight: 800, color: C.grisF, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Qui voit ce process
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { code: 'all-read', label: 'Tout le monde en lecture', hint: 'Tous ceux qui ont l\'app peuvent le lire' },
            { code: 'all-write', label: 'Tout le monde en écriture', hint: 'Tous ceux qui ont l\'app peuvent le lire et le modifier' },
            { code: 'restricted', label: 'Utilisateurs choisis', hint: 'Seules les personnes cochées ci-dessous' },
          ].map((opt) => {
            const active = mode === opt.code;
            return (
              <button
                key={opt.code} type="button" onClick={() => setMode(opt.code)}
                title={opt.hint}
                style={{
                  padding: '7px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${active ? C.process : C.grisCL}`,
                  background: active ? C.process : C.blanc,
                  color: active ? '#fff' : C.grisF,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <p style={{ fontSize: 12, color: C.grisM, margin: '10px 0 0', lineHeight: 1.5 }}>
          {mode === 'all-write'
            ? 'Tout détenteur de l\'app peut le lire et le modifier, y compris les futurs comptes.'
            : mode === 'all-read'
              ? 'Tout détenteur de l\'app peut le lire, y compris les futurs comptes. Passez quelqu\'un en « Écriture » pour qu\'il puisse le modifier.'
              : 'Seules les personnes cochées ci-dessous le voient.'}
          {' '}Retirer une personne (« — ») repasse en « Utilisateurs choisis ». Les administrateurs peuvent toujours l\'ouvrir et le modifier.
        </p>
      </div>

      <div style={{ padding: '12px 16px' }}>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une personne…"
          style={{
            padding: '8px 11px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
            fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none', marginBottom: 10,
          }}
        />

        <div style={{ maxHeight: 300, overflowY: 'auto', margin: '0 -4px' }}>
          {filtered.length === 0 && (
            <p style={{ fontSize: 13, color: C.grisM, padding: '8px 4px', margin: 0 }}>Aucun utilisateur.</p>
          )}

          {filtered.map((u) => {
            const level = levelOf(byUser.get(u.id), visibility);
            return (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px',
                borderBottom: `1px solid ${C.grisTL}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.grisTF, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.name || u.email}
                  </div>
                  {u.name && (
                    <div style={{ fontSize: 11.5, color: C.grisM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.email}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {LEVELS.map((lv) => {
                    const active = level === lv.key;
                    return (
                      <button
                        key={lv.key} type="button" title={lv.hint}
                        onClick={() => setLevel(u.id, lv.key)}
                        style={{
                          padding: '5px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                          border: `1px solid ${active ? C.process : C.grisCL}`,
                          background: active ? C.process : C.blanc,
                          color: active ? '#fff' : C.grisM,
                          borderRadius: lv.key === 'none' ? '6px 0 0 6px' : lv.key === 'write' ? '0 6px 6px 0' : 0,
                          marginLeft: lv.key === 'none' ? 0 : -1,
                        }}
                      >
                        {lv.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 12, color: C.grisM, margin: '12px 0 0' }}>
          {readerCount === 0
            ? 'Personne n\'a encore accès.'
            : `${readerCount} personne${readerCount > 1 ? 's' : ''} sur ${users.length} ${readerCount > 1 ? 'ont' : 'a'} accès, dont ${writerCount} en écriture.`}
        </p>
      </div>
    </div>
  );
}
