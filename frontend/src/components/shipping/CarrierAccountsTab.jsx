import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { visuelTransporteur } from '../../utils/carrierVisuals';

// Même construction que le reste de l'app (cf. ShippingSettings) : le repli
// pointe le backend local, et le `.replace` couvre les configurations où la
// variable se termine par /auth.
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace('/auth', '');

/**
 * Réglages « Contrats transporteurs » : les identifiants d'API se saisissent
 * ici, jamais en dur ni par SQL.
 *
 * Le formulaire est **généré à partir de ce que déclare l'adaptateur** — La
 * Poste demande un client_id et un client_secret, Mondial Relay une connexion
 * et un mot de passe d'API. Ajouter un transporteur ne demandera donc pas de
 * retoucher cet écran.
 *
 * Deux règles sur les secrets, qui expliquent tout le comportement :
 *   - ils ne descendent JAMAIS jusqu'ici ; le champ s'affiche vide, avec la
 *     mention « déjà enregistré » quand une valeur existe ;
 *   - un champ secret laissé vide ne l'efface pas. Sans ça, ouvrir l'écran et
 *     enregistrer suffirait à vider un mot de passe d'API et à arrêter
 *     l'expédition.
 */
function CarrierAccountsTab() {
  const [data, setData] = useState({ accounts: [], carriers: [] });
  const [edition, setEdition] = useState(null); // { carrier_code, account_code, label, valeurs }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const token = localStorage.getItem('token');
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/shipments/carrier-accounts`, auth);
      setData(res.data);
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Chargement impossible' });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const transporteurs = data.carriers.filter(c => c.requiresAccount);

  /** Lit une valeur par chemin pointé, pour préremplir depuis l'existant. */
  const lire = (obj, chemin) =>
    chemin.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

  const ouvrir = (compte, carrierCode) => {
    const code = carrierCode || compte.carrier_code;
    const def = data.carriers.find(c => c.code === code);

    // Créer un contrat, c'est presque toujours DOUBLER celui qui existe — passer
    // du contrat de test à celui de production, par exemple. On reprend donc les
    // réglages du contrat existant du même transporteur : l'adresse expéditeur,
    // l'URL, les codes. Restent à saisir les identifiants, qui eux diffèrent.
    const modele = compte || data.accounts.find(a => a.carrier_code === code) || null;
    const valeurs = {};

    for (const f of def?.accountFields?.credentials || []) {
      // Jamais de secret prérempli : sa valeur n'a pas quitté le serveur. Et sur
      // un NOUVEAU contrat, les identifiants ne se recopient pas — ce sont eux
      // qui changent.
      valeurs['cred.' + f.key] = (f.secret || !compte) ? '' : (lire(compte.credentials || {}, f.key) ?? '');
    }
    for (const f of def?.accountFields?.settings || []) {
      // `perContract` : une valeur propre à CHAQUE contrat, jamais recopiée.
      // L'URL de l'API en est l'exemple — la dupliquer depuis le contrat de test
      // enverrait les identifiants de production au serveur de test, qui répond
      // « login et/ou mot de passe non valide » (arrivé le 08/09/2026).
      if (!compte && f.perContract) { valeurs['set.' + f.key] = ''; continue; }
      const v = lire(modele?.settings || {}, f.key);
      valeurs['set.' + f.key] = v == null ? '' : String(v);
    }
    // Un contrat dupliqué n'hérite pas du drapeau « test » de son modèle.
    if (!compte) valeurs['set.sandbox'] = '';

    setEdition({
      carrier_code: code,
      account_code: compte?.account_code || '',
      label: compte?.label || '',
      nouveau: !compte,
      reprisDe: !compte && modele ? modele.account_code : null,
      secretsRenseignes: compte?.secretsRenseignes || [],
      avances: false,
      valeurs
    });
    setMessage(null);
  };

  const enregistrer = async (e) => {
    e?.preventDefault();
    if (!edition.account_code.trim()) {
      setMessage({ type: 'error', text: 'Le code du contrat est obligatoire' });
      return;
    }
    // Dire ce qui manque plutôt que de laisser l'API refuser sans détail — ou,
    // pire, d'enregistrer un contrat incomplet qui échouera au premier colis.
    const def0 = data.carriers.find(c => c.code === edition.carrier_code);
    const oublis = [
      ...(def0?.accountFields?.credentials || []).filter(f =>
        f.required && !edition.valeurs['cred.' + f.key] &&
        !(f.secret && edition.secretsRenseignes.includes(f.key))),
      ...(def0?.accountFields?.settings || []).filter(f =>
        f.required && !edition.valeurs['set.' + f.key])
    ];
    if (oublis.length > 0) {
      setMessage({ type: 'error', text: `Champs obligatoires non renseignés : ${oublis.map(f => f.label).join(', ')}` });
      return;
    }
    setSaving(true);
    try {
      const credentials = {}, settings = {};
      for (const [cle, valeur] of Object.entries(edition.valeurs)) {
        if (cle.startsWith('cred.')) credentials[cle.slice(5)] = valeur;
        else settings[cle.slice(4)] = valeur;
      }
      await axios.post(`${API_URL}/shipments/carrier-accounts`, {
        carrier_code: edition.carrier_code,
        account_code: edition.account_code.trim(),
        label: edition.label || null,
        credentials, settings
      }, auth);
      setMessage({ type: 'success', text: 'Contrat enregistré' });
      setEdition(null);
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Enregistrement impossible' });
    } finally {
      setSaving(false);
    }
  };

  const supprimer = async (compte) => {
    if (!confirm(`Supprimer le contrat « ${compte.label} » ?`)) return;
    try {
      await axios.delete(`${API_URL}/shipments/carrier-accounts/${compte.id}`, auth);
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Suppression impossible' });
    }
  };

  const champ = (f, prefixe) => {
    const cle = prefixe + f.key;
    const dejaEnregistre = f.secret && edition.secretsRenseignes.includes(f.key);
    const valeur = edition.valeurs[cle] ?? '';
    const majEdition = (v) => setEdition(ed => ({ ...ed, valeurs: { ...ed.valeurs, [cle]: v } }));

    if (f.type === 'boolean') {
      // Une case à cocher, pas un champ texte : un « true » tapé à la main dans
      // un champ libre finissait en chaîne, et une chaîne vide faisait échouer
      // la relecture des contrats.
      return (
        <label key={cle} style={{ flex: '1 1 260px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#333' }}>
          <input type="checkbox" checked={valeur === 'true' || valeur === true}
            onChange={e => majEdition(e.target.checked ? 'true' : '')} />
          {f.label}
        </label>
      );
    }

    return (
      <div key={cle} style={{ flex: '1 1 240px' }}>
        <label style={labelStyle}>
          {f.label}
          {f.required && <span style={{ color: '#dc3545', marginLeft: 3 }}>*</span>}
          {dejaEnregistre && (
            <span style={{ color: '#28a745', marginLeft: '6px' }}>déjà enregistré</span>
          )}
        </label>
        <input
          type={f.secret ? 'password' : 'text'}
          autoComplete={f.secret ? 'new-password' : 'off'}
          value={valeur}
          placeholder={f.secret
            ? (dejaEnregistre ? 'Laisser vide pour ne pas changer' : '')
            : (f.placeholder || '')}
          onChange={e => majEdition(e.target.value)}
          style={{ ...inputStyle, width: '100%' }} />
      </div>
    );
  };

  const groupes = (champs) => {
    const out = new Map();
    for (const f of champs) {
      if (f.advanced) continue;
      const g = f.group || '';
      if (!out.has(g)) out.set(g, []);
      out.get(g).push(f);
    }
    return [...out.entries()];
  };

  if (loading) return <div style={{ padding: '30px' }}>Chargement…</div>;

  const def = edition ? data.carriers.find(c => c.code === edition.carrier_code) : null;

  return (
    <div style={{ padding: '25px' }}>
      {message && (
        <div style={{
          padding: '10px 15px', marginBottom: '20px', borderRadius: '4px',
          backgroundColor: message.type === 'error' ? '#f8d7da' : '#d4edda',
          color: message.type === 'error' ? '#721c24' : '#155724'
        }}>{message.text}</div>
      )}

      <p style={{ color: '#666', marginTop: 0, fontSize: '14px', lineHeight: 1.6 }}>
        Les identifiants d'API des transporteurs. Un transporteur peut avoir <strong>plusieurs
        contrats</strong> — un de test et un de production, ou deux contrats commerciaux — et
        chaque mode de livraison désigne celui qu'il utilise, dans l'onglet « Étiquetage ».
        Les mots de passe ne sont jamais réaffichés.
      </p>

      {!edition && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {transporteurs.map(c => (
            // Couleur et survol explicites : `index.css` met tous les boutons en
            // blanc sur bleu, ce qui rendrait ce libellé invisible sur fond clair.
            <button key={c.code} onClick={() => ouvrir(null, c.code)}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'white'; }}
              style={{
                padding: '9px 16px', border: `2px solid ${visuelTransporteur(c.code).couleur}`,
                backgroundColor: 'white', color: '#333',
                borderRadius: '6px', cursor: 'pointer', fontWeight: 600
              }}>+ Contrat {c.label}</button>
          ))}
        </div>
      )}

      {edition && def && (
        <form onSubmit={enregistrer} style={{
          border: `2px solid ${visuelTransporteur(edition.carrier_code).couleur}`,
          borderRadius: '8px', padding: '20px', marginBottom: '25px'
        }}>
          <h4 style={{ margin: '0 0 6px' }}>
            {edition.nouveau ? 'Nouveau contrat' : 'Modifier le contrat'} — {def.label}
          </h4>
          {edition.reprisDe && (
            <p style={{ margin: '0 0 16px', color: '#666', fontSize: '13px' }}>
              Réglages repris du contrat « {edition.reprisDe} ». Seuls les identifiants
              sont à saisir — ce sont eux qui changent.
            </p>
          )}

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
            <div style={{ flex: '1 1 190px' }}>
              <label style={labelStyle}>Code du contrat</label>
              <input value={edition.account_code} disabled={!edition.nouveau}
                onChange={e => setEdition(ed => ({ ...ed, account_code: e.target.value }))}
                placeholder="production, sandbox…"
                style={{ ...inputStyle, width: '100%', backgroundColor: edition.nouveau ? 'white' : '#f1f3f5' }} />
            </div>
            <div style={{ flex: '2 1 260px' }}>
              <label style={labelStyle}>Libellé affiché</label>
              <input value={edition.label}
                onChange={e => setEdition(ed => ({ ...ed, label: e.target.value }))}
                placeholder="Mondial Relay — production"
                style={{ ...inputStyle, width: '100%' }} />
            </div>
          </div>

          <h5 style={sousTitre}>Identifiants d'API</h5>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
            {(def.accountFields?.credentials || []).map(f => champ(f, 'cred.'))}
          </div>

          {groupes(def.accountFields?.settings || []).map(([groupe, champs]) => (
            <div key={groupe}>
              <h5 style={sousTitre}>{groupe || 'Réglages'}</h5>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
                {champs.map(f => champ(f, 'set.'))}
              </div>
            </div>
          ))}

          {(() => {
            const avances = (def.accountFields?.settings || []).filter(f => f.advanced);
            if (avances.length === 0) return null;
            return (
              <div style={{ marginBottom: '18px' }}>
                <button type="button"
                  onClick={() => setEdition(ed => ({ ...ed, avances: !ed.avances }))}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'white'; }}
                  style={{
                    padding: '7px 12px', border: '1px solid #ccc', backgroundColor: 'white',
                    color: '#555', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
                  }}>
                  {edition.avances ? '▾' : '▸'} Réglages avancés ({avances.length})
                </button>
                {!edition.avances && (
                  <span style={{ color: '#888', marginLeft: 10, fontSize: 12.5 }}>
                    laissés vides, les valeurs par défaut s'appliquent
                  </span>
                )}
                {edition.avances && (
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
                    {avances.map(f => champ(f, 'set.'))}
                  </div>
                )}
              </div>
            );
          })()}

          {(() => {
            // Le drapeau « test » est déclaratif ; l'URL, elle, est la réalité.
            // Quand les deux se contredisent, c'est l'URL qui décide du serveur
            // appelé — mieux vaut le dire avant d'enregistrer.
            const url = String(edition.valeurs['set.api_url'] || '');
            const urlDeTest = /sandbox|test/i.test(url);
            const caseCochee = edition.valeurs['set.sandbox'] === 'true';
            if (!url || urlDeTest === caseCochee) return null;
            return (
              <div style={{
                padding: '10px 14px', marginBottom: '16px', borderRadius: '6px',
                backgroundColor: urlDeTest ? '#f8d7da' : '#fff3cd',
                color: urlDeTest ? '#721c24' : '#856404', fontSize: '13.5px'
              }}>
                {urlDeTest
                  ? <>⚠️ L'URL pointe le <strong>serveur de test</strong> alors que le contrat n'est pas coché « test ».
                      Des identifiants de production y seront refusés.</>
                  : <>⚠️ Le contrat est coché « test » mais l'URL pointe le <strong>serveur de production</strong> :
                      les étiquettes émises seront réelles et facturées.</>}
              </div>
            );
          })()}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="submit" disabled={saving} style={{
              padding: '9px 20px', backgroundColor: saving ? '#adb5bd' : '#135E84',
              color: 'white', border: 'none', borderRadius: '4px',
              cursor: saving ? 'default' : 'pointer', fontWeight: 600
            }}>{saving ? '…' : 'Enregistrer'}</button>
            <button type="button" onClick={() => setEdition(null)} style={{
              padding: '9px 20px', backgroundColor: '#6c757d', color: 'white',
              border: 'none', borderRadius: '4px', cursor: 'pointer'
            }}>Annuler</button>
          </div>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#f8f9fa' }}>
            <th style={thStyle}>Transporteur</th>
            <th style={thStyle}>Contrat</th>
            <th style={thStyle}>Libellé</th>
            <th style={thStyle}>Identifiants</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {data.accounts.map(a => {
            const v = visuelTransporteur(a.carrier_code);
            const estTest = a.settings?.sandbox === true || a.settings?.sandbox === 'true';
            return (
              <tr key={a.id} style={{ opacity: a.active ? 1 : 0.5 }}>
                <td style={tdStyle}>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: '4px',
                    backgroundColor: v.couleur, color: v.encre, fontSize: '11px', fontWeight: 700
                  }}>{v.court}</span>
                </td>
                <td style={tdStyle}>
                  {a.account_code}
                  {estTest && <span style={{ color: '#dc3545', marginLeft: '8px', fontSize: '12px', fontWeight: 700 }}>TEST</span>}
                </td>
                <td style={tdStyle}>{a.label}</td>
                <td style={{ ...tdStyle, fontSize: '13px', color: '#666' }}>
                  {a.secretsRenseignes.length > 0
                    ? `${a.secretsRenseignes.length} secret(s) enregistré(s)`
                    : <span style={{ color: '#dc3545' }}>aucun secret enregistré</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => ouvrir(a)} style={btnSmall}>Modifier</button>
                  <button onClick={() => supprimer(a)} style={{ ...btnSmall, backgroundColor: '#dc3545', marginLeft: '6px' }}>
                    Supprimer
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' };
const sousTitre = { margin: '0 0 10px', fontSize: '13px', color: '#135E84', textTransform: 'uppercase', letterSpacing: '0.5px' };
const inputStyle = { padding: '8px', border: '1px solid #ccc', borderRadius: '4px' };
const thStyle = { padding: '9px', textAlign: 'left', border: '1px solid #dee2e6', fontSize: '13px' };
const tdStyle = { padding: '9px', border: '1px solid #dee2e6', fontSize: '14px' };
const btnSmall = { padding: '4px 10px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' };

export default CarrierAccountsTab;
