import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { API_URL, authHeaders, C, Chip } from '../picking/pickingUi';

/**
 * Onglet « Réclamations » de l'Historique d'expédition.
 *
 * Chaque jour à 16 h (lundi → samedi), les colis Chrono 13 / Chrono Relais /
 * Chrono Express pas livrés le jour dû sont réclamés : un fichier d'import pour
 * le « Service Client en ligne » Chronopost, envoyé à contact@youvape.fr, et
 * une note privée dans le ticket SAV de la commande (backend :
 * chronopostClaimService).
 *
 * Ici : les fichiers produits, leur téléchargement, et le compte-rendu
 * d'import de Chronopost à coller pour noter les n° de ticket.
 */

const TEAL = '#0F766E';

const OBJETS = { RT: 'Retard', PC: 'Non pris en charge' };

const fmt = (iso, withTime = true) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
};
const fmtJour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

const erreurApi = (err, repli) => err.response?.data?.error || repli;

const bouton = (variant = 'primary') => ({
  padding: '7px 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
  whiteSpace: 'nowrap',
  ...(variant === 'primary'
    ? { background: TEAL, color: '#fff', border: 'none' }
    : { background: '#fff', color: C.dark, border: `1px solid ${C.greyB}` }),
});

function Fichier({ batch, token, onChanged }) {
  const [ouvert, setOuvert] = useState(false);
  const [coller, setColler] = useState(false);
  const [texte, setTexte] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState(null);

  const telecharger = async () => {
    try {
      const res = await axios.get(`${API_URL}/shipment-history/claims/${batch.id}/file`,
        { ...authHeaders(token), responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = batch.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('Téléchargement impossible');
    }
  };

  const enregistrer = async () => {
    setEnvoi(true);
    setMessage(null);
    try {
      const res = await axios.post(`${API_URL}/shipment-history/claims/${batch.id}/import-report`,
        { text: texte }, authHeaders(token));
      const { matched, unknown } = res.data;
      setMessage({
        ok: true,
        text: `${matched} colis rapproché(s)${unknown.length ? ` — inconnus dans ce fichier : ${unknown.join(', ')}` : ''}.`,
      });
      setTexte('');
      setColler(false);
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: erreurApi(err, 'Compte-rendu illisible') });
    } finally {
      setEnvoi(false);
    }
  };

  const tickets = batch.claims.filter(c => c.carrier_ticket).length;
  const refus = batch.claims.filter(c => c.carrier_error).length;

  return (
    <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px' }}>
        <button onClick={() => setOuvert(o => !o)} style={{
          border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0,
          display: 'inline-flex', alignItems: 'center', gap: 10, textAlign: 'left',
        }}>
          <span style={{ color: C.greyT, fontSize: 12 }}>{ouvert ? '▾' : '▸'}</span>
          <span style={{ fontSize: 14.5, fontWeight: 800, color: C.dark }}>{fmt(batch.created_at)}</span>
          <span style={{ fontSize: 13.5, color: C.dark }}><strong>{batch.claim_count}</strong> colis</span>
        </button>
        <span style={{ fontSize: 12.5, color: C.greyT }}>
          {batch.created_by_name ? `lancé par ${batch.created_by_name}` : 'contrôle de 16 h'}
        </span>
        {batch.mailed_at
          ? <Chip color={C.green} bg={C.greenL} title={`Envoyé le ${fmt(batch.mailed_at)}`}>Mail envoyé</Chip>
          : <Chip color={C.red} bg={C.redL} title={batch.mail_error || ''}>Mail non envoyé</Chip>}
        {batch.imported_at
          ? <Chip color={C.green} bg={C.greenL} title={`Compte-rendu collé le ${fmt(batch.imported_at)}${batch.imported_by_name ? ` par ${batch.imported_by_name}` : ''}`}>
              Importé — {tickets} ticket(s){refus ? `, ${refus} refus` : ''}
            </Chip>
          : <Chip color={C.amber} bg={C.amberL}>À importer chez Chronopost</Chip>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          <button onClick={telecharger} style={bouton('ghost')}>Télécharger</button>
          <button onClick={() => { setColler(c => !c); setMessage(null); }} style={bouton(coller ? 'ghost' : 'primary')}>
            {coller ? 'Fermer' : 'Coller le compte-rendu'}
          </button>
        </span>
      </div>

      {coller && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ fontSize: 12.5, color: C.greyT, marginBottom: 6 }}>
            Après l'import chez Chronopost, copiez tout le texte affiché sous « Lancement de l'import »
            (« Ligne 1 XW…FR : Ticket créé avec le numéro … ») et collez-le ici.
          </div>
          <textarea value={texte} onChange={e => setTexte(e.target.value)} rows={6} style={{
            width: '100%', boxSizing: 'border-box', borderRadius: 8, border: `1px solid ${C.greyB}`,
            padding: 10, fontFamily: 'ui-monospace, monospace', fontSize: 12.5,
          }} />
          <div style={{ marginTop: 8 }}>
            <button onClick={enregistrer} disabled={envoi || !texte.trim()} style={{
              ...bouton(), opacity: envoi || !texte.trim() ? 0.5 : 1,
            }}>{envoi ? 'Enregistrement…' : 'Enregistrer les n° de ticket'}</button>
          </div>
        </div>
      )}
      {message && (
        <div style={{ padding: '0 16px 12px', fontSize: 13, color: message.ok ? C.green : C.red }}>{message.text}</div>
      )}

      {ouvert && (
        <div style={{ overflowX: 'auto', borderTop: `1px solid ${C.greyB}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.grey, textAlign: 'left', color: C.greyT, fontSize: 11.5, textTransform: 'uppercase' }}>
                <th style={th}>Commande</th>
                <th style={th}>Colis</th>
                <th style={th}>Objet</th>
                <th style={th}>Déposé / dû</th>
                <th style={th}>Commentaire envoyé</th>
                <th style={th}>Ticket Chronopost</th>
                <th style={th}>SAV</th>
              </tr>
            </thead>
            <tbody>
              {batch.claims.map(c => (
                <tr key={c.id} style={{ borderTop: `1px solid ${C.greyB}`, verticalAlign: 'top' }}>
                  <td style={td}><Link to={`/orders/${c.order_number}`}>#{c.order_number}</Link></td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{c.tracking_number}</td>
                  <td style={td}><Chip color={C.white} bg={c.object_code === 'PC' ? C.red : C.amber}>{c.object_code} {OBJETS[c.object_code]}</Chip></td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: C.greyT }}>{fmtJour(c.deposit_day)} → {fmtJour(c.due_day)}</td>
                  <td style={{ ...td, maxWidth: 420, color: C.dark }}>{c.comment}</td>
                  <td style={td}>
                    {c.carrier_ticket && <strong>{c.carrier_ticket}</strong>}
                    {c.carrier_error && <span style={{ color: C.red }}>{c.carrier_error}</span>}
                    {!c.carrier_ticket && !c.carrier_error && <span style={{ color: C.greyM }}>—</span>}
                  </td>
                  <td style={td}>
                    {c.sav_ticket_id
                      ? <Link to={`/tickets/${c.sav_ticket_id}`}>#{c.sav_ticket_id}</Link>
                      : <span style={{ color: C.red }} title={c.sav_error || ''}>non posée</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { padding: '8px 12px', fontWeight: 700 };
const td = { padding: '8px 12px' };

export default function CarrierClaimsTab({ token }) {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [controle, setControle] = useState(false);
  const [resultat, setResultat] = useState(null);

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      const res = await axios.get(`${API_URL}/shipment-history/claims`, authHeaders(token));
      setData(res.data);
    } catch (err) {
      setErreur(erreurApi(err, 'Erreur de chargement'));
    }
  }, [token]);

  useEffect(() => { charger(); }, [charger]);

  const lancer = async () => {
    setControle(true);
    setResultat(null);
    try {
      const res = await axios.post(`${API_URL}/shipment-history/claims/run`, {}, authHeaders(token));
      const r = res.data;
      setResultat({
        ok: true,
        text: r.claims
          ? `${r.claims} colis réclamé(s)${r.mailed ? ', fichier envoyé à contact@youvape.fr' : ' — le mail n\'est pas parti'}, ${r.notes} note(s) SAV.`
          : 'Aucun colis à réclamer pour l\'instant.',
      });
      await charger();
    } catch (err) {
      setResultat({ ok: false, text: erreurApi(err, 'Contrôle impossible') });
    } finally {
      setControle(false);
    }
  };

  return (
    <div>
      <div style={{
        background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: '14px 16px', marginBottom: 16,
        display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 420px', fontSize: 13.5, color: C.dark, lineHeight: 1.55 }}>
          Chaque jour à <strong>16 h</strong> (lundi → samedi), les colis <strong>Chrono 13</strong> et
          <strong> Chrono Relais</strong> pas livrés le jour dû (lendemain ouvré du bordereau), et les
          <strong> Chrono Express</strong> pas livrés à J+3 ouvrés, sont réclamés : <strong>RT</strong> retard,
          ou <strong>PC</strong> s'ils n'ont jamais été pris en charge. Le fichier part à contact@youvape.fr, à
          importer dans le Service Client en ligne Chronopost (Import de tickets) ; une note privée est posée dans
          le ticket SAV de la commande. Un colis n'est réclamé qu'une fois.
          {data && (data.since
            ? <div style={{ color: C.greyT, fontSize: 12.5, marginTop: 4 }}>Échéances contrôlées depuis le {fmtJour(data.since)}.</div>
            : <div style={{ color: C.amber, fontSize: 12.5, marginTop: 4, fontWeight: 700 }}>Contrôle pas encore activé : aucun colis ne sera réclamé.</div>)}
        </div>
        <button onClick={lancer} disabled={controle || !data?.since} style={{ ...bouton(), opacity: controle || !data?.since ? 0.6 : 1 }}>
          {controle ? 'Contrôle en cours…' : 'Lancer le contrôle maintenant'}
        </button>
      </div>

      {resultat && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13.5,
          background: resultat.ok ? C.greenL : C.redL, color: resultat.ok ? '#14532D' : '#7F1D1D',
        }}>{resultat.text}</div>
      )}
      {erreur && <div style={{ color: C.red, fontSize: 13.5, marginBottom: 12 }}>{erreur}</div>}
      {!data && !erreur && <div style={{ color: C.greyT, fontSize: 13.5 }}>Chargement…</div>}
      {data && data.batches.length === 0 && (
        <div style={{ color: C.greyT, fontSize: 13.5, padding: '20px 0' }}>Aucune réclamation pour l'instant.</div>
      )}
      {data?.batches.map(b => <Fichier key={b.id} batch={b} token={token} onChanged={charger} />)}
    </div>
  );
}
