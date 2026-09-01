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
 */

const LEVELS = [
  { key: 'none',  label: '—',        hint: 'Aucun accès' },
  { key: 'read',  label: 'Lecture',  hint: 'Peut consulter' },
  { key: 'write', label: 'Écriture', hint: 'Peut consulter et modifier' },
];

const levelOf = (entry) => (!entry ? 'none' : entry.can_write ? 'write' : 'read');

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

  const setLevel = (userId, level) => {
    const next = (access || []).filter((a) => a.user_id !== userId);
    if (level === 'read') next.push({ user_id: userId, can_write: false });
    if (level === 'write') next.push({ user_id: userId, can_write: true });
    onChange({ visibility, access: next });
  };

  const setVisibility = (v) => onChange({ visibility: v, access: access || [] });

  const readerCount = (access || []).length;
  const writerCount = (access || []).filter((a) => a.can_write).length;

  return (
    <div style={{ border: `1px solid ${C.grisCL}`, borderRadius: 12, background: C.blanc, overflow: 'hidden' }}>

      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.grisCL}`, background: C.grisTL }}>
        <p style={{ fontSize: 12, fontWeight: 800, color: C.grisF, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Qui voit ce process
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { code: 'restricted', label: 'Utilisateurs choisis', hint: 'Seules les personnes ci-dessous' },
            { code: 'all', label: 'Tout le monde', hint: 'Tous ceux qui ont l\'app, en lecture' },
          ].map((opt) => {
            const active = (visibility || 'restricted') === opt.code;
            return (
              <button
                key={opt.code} type="button" onClick={() => setVisibility(opt.code)}
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
          {visibility === 'all'
            ? 'Tout détenteur de l\'app pourra le lire. La modification reste réservée aux personnes marquées « Écriture » ci-dessous.'
            : 'Seules les personnes listées ci-dessous le verront.'}
          {' '}Les administrateurs voient et modifient tout, sans figurer dans la liste.
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
            const level = levelOf(byUser.get(u.id));
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
            ? (visibility === 'all' ? 'Personne en écriture pour l\'instant.' : 'Personne n\'a encore accès.')
            : `${readerCount} personne${readerCount > 1 ? 's' : ''} dans la liste, dont ${writerCount} en écriture.`}
        </p>
      </div>
    </div>
  );
}
