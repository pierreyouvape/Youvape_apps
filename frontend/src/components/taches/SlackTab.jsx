import { useEffect, useState } from 'react';
import { tachesApi, apiError } from './tachesShared';
import { Avatar } from './tachesUi';
import { btn, inputStyle } from './tachesShared';

/**
 * Réglages Slack (admins) : webhook du canal #notifications-taches et ID de
 * membre Slack de chacun (pour que la mention notifie vraiment la personne).
 * L'URL du webhook n'est jamais relue : champ vide = on garde l'actuelle.
 */
export default function SlackTab({ members }) {
  const [conf, setConf] = useState(null);
  const [url, setUrl] = useState('');
  const [ids, setIds] = useState({});
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    tachesApi.slack().then((c) => { setConf(c); setIds(c.members || {}); }).catch((e) => setMsg({ err: apiError(e) }));
  }, []);

  const save = async () => {
    try {
      const c = await tachesApi.saveSlack({ webhook_url: url, members: ids });
      setConf(c);
      setIds(c.members);
      setUrl('');
      setMsg({ ok: 'Enregistré.' });
    } catch (e) {
      setMsg({ err: apiError(e) });
    }
  };

  const test = async () => {
    try {
      await tachesApi.testSlack();
      setMsg({ ok: 'Message de test envoyé : vérifiez le canal Slack.' });
    } catch (e) {
      setMsg({ err: apiError(e) });
    }
  };

  if (!conf) return <div style={{ color: '#9CA3AF' }}>{msg?.err || 'Chargement…'}</div>;

  return (
    <div style={{ maxWidth: 760, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Canal Slack</h3>
      <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 10px', lineHeight: 1.5 }}>
        Sur api.slack.com/apps : <em>Create New App</em> → <em>From scratch</em> (nom « Tâches YouVape ») →
        <em> Incoming Webhooks</em> → activer → <em>Add New Webhook to Workspace</em> → choisir
        #notifications-taches → copier l'adresse ici.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle}
          placeholder={conf.webhook_set ? '•••••• enregistré (laisser vide pour le garder)' : 'https://hooks.slack.com/services/…'} />
        <button type="button" style={btn()} onClick={test} disabled={!conf.webhook_set}>Tester</button>
      </div>

      <h3 style={{ margin: '22px 0 6px', fontSize: 16 }}>Identifiants Slack de l'équipe</h3>
      <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 10px', lineHeight: 1.5 }}>
        Dans Slack : clic sur la personne → <em>Voir le profil</em> → ⋮ → <em>Copier l'ID de membre</em> (commence par U).
        Sans identifiant, le nom est écrit en gras mais la personne n'est pas notifiée.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {members.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar id={m.id} name={m.name} size={28} />
            <span style={{ width: 120, fontWeight: 700, color: '#374151' }}>{m.name}</span>
            {m.has_app === false && <span style={{ fontSize: 12, color: '#9CA3AF', width: 150 }}>pas encore accès à l'app</span>}
            <input value={ids[m.id] || ''} onChange={(e) => setIds({ ...ids, [m.id]: e.target.value })}
              placeholder="U0123ABCD" style={{ ...inputStyle, width: 200 }} />
          </div>
        ))}
      </div>

      {msg && (
        <div style={{ marginTop: 14, padding: '8px 12px', borderRadius: 8, fontSize: 13, background: msg.err ? '#FEE2E2' : '#DCFCE7', color: msg.err ? '#B91C1C' : '#166534' }}>
          {msg.err || msg.ok}
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <button type="button" style={btn(true)} onClick={save}>Enregistrer</button>
      </div>
    </div>
  );
}
