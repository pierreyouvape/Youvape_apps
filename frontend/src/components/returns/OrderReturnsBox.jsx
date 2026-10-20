import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { C, Chip } from '../picking/pickingUi';
import useTicketsAccess from '../tickets/useTicketsAccess';
import { formatDateUTC } from '../../utils/dateUtils';
import CreateReturnModal from './CreateReturnModal';
import DeclareLostModal from './DeclareLostModal';
import ReturnLabelActions from './ReturnLabelActions';
import { RETURNS_API, RETURNS_COLOR, RETURNS_COLOR_L, REASONS, LOST_REASON, StatusChip, btn, errorText } from './returnsUi';

/**
 * Retours d'une commande + boutons « Créer un retour » et « Déclarer colis
 * perdu ». Affiché sous la commande concernée d'un ticket, et dans le détail
 * de commande. Sans le droit tickets (403), le bloc ne s'affiche pas.
 *
 * `withUnclaimed` (détail de commande) : bouton « Retour car non réclamé »,
 * pour le colis revenu seul — retour + note dans le ticket (créé au besoin).
 */
export default function OrderReturnsBox({ wpOrderId, ticketId, concernedProducts, withUnclaimed = false, style }) {
  const { canWrite } = useTicketsAccess();
  const [returns, setReturns] = useState(null);
  const [replacementFor, setReplacementFor] = useState([]);
  const [open, setOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [unclaiming, setUnclaiming] = useState(false);
  const valid = /^\d+$/.test(String(wpOrderId || ''));

  const load = useCallback(() => {
    if (!valid) return;
    axios.get(`${RETURNS_API}/order/${wpOrderId}`)
      .then(({ data }) => { setReturns(data.returns); setReplacementFor(data.replacementFor || []); })
      .catch(() => setReturns(false));
  }, [wpOrderId, valid]);

  useEffect(() => { load(); }, [load]);

  if (!valid || returns === false || returns === null) return null;

  const lost = returns.filter(r => r.reason === LOST_REASON && r.status !== 'annule');

  const declareUnclaimed = async () => {
    if (!window.confirm(`Colis de la commande #${wpOrderId} revenu non réclamé ?\n\nCrée le retour « Commande non récupérée » (réception à valider) et le note dans le ticket de la commande, créé s'il n'existe pas.`)) return;
    // Ouvert tout de suite : un onglet ouvert après l'appel serait bloqué par le navigateur.
    const tab = window.open('', '_blank');
    setUnclaiming(true);
    try {
      const { data } = await axios.post(`${RETURNS_API}/unclaimed`, { wpOrderId });
      if (tab) tab.location.href = `/retours/${data.id}`;
      if (data.warnings?.length) window.alert(data.warnings.join('\n'));
      load();
    } catch (e) {
      tab?.close();
      window.alert(errorText(e));
    }
    setUnclaiming(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {(lost.length > 0 || replacementFor.length > 0) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {lost.length > 0 && <Chip color={C.white} bg={C.red}>COLIS PERDU</Chip>}
          {replacementFor.map(r => (
            <a key={r.id} href={`/retours/${r.id}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <Chip color={RETURNS_COLOR} bg={RETURNS_COLOR_L}>
                {r.reason === LOST_REASON ? 'Renvoi colis perdu' : 'Renvoi SAV'} #{r.wp_order_id}
              </Chip>
            </a>
          ))}
        </div>
      )}
      {returns.map(r => (
        <div key={r.id} style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${r.reason === LOST_REASON && r.status !== 'annule' ? C.red : C.greyB}`, background: C.white, fontSize: 12.5 }}>
          <a
            href={`/retours/${r.id}`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', textDecoration: 'none', color: C.dark }}
          >
            <strong style={{ color: RETURNS_COLOR }}>Retour n°{r.id}</strong>
            <span>{REASONS[r.reason]}</span>
            <StatusChip status={r.status} reason={r.reason} />
            <span style={{ marginLeft: 'auto', color: C.greyT }}>{formatDateUTC(r.created_at, { time: false })}</span>
          </a>
          {/* Dans un ticket : l'étiquette retour se crée et se joint à la réponse d'ici. */}
          {ticketId && canWrite && (
            <div style={{ marginTop: 6 }}>
              <ReturnLabelActions ret={r} ticketId={ticketId} onChange={load} small />
            </div>
          )}
        </div>
      ))}
      {canWrite && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'flex-start' }}>
          <button type="button" onClick={() => setOpen(true)} style={{ ...btn('ghost'), color: RETURNS_COLOR, borderColor: RETURNS_COLOR, padding: '6px 12px', fontSize: 12.5 }}>
            ↩ Créer un retour
          </button>
          <button type="button" onClick={() => setLostOpen(true)} style={{ ...btn('ghost'), color: C.red, borderColor: C.red, padding: '6px 12px', fontSize: 12.5 }}>
            Déclarer colis perdu
          </button>
          {withUnclaimed && (
            <button type="button" onClick={declareUnclaimed} disabled={unclaiming} style={{ ...btn('ghost', unclaiming), color: C.amber, borderColor: C.amber, padding: '6px 12px', fontSize: 12.5 }}>
              {unclaiming ? 'Création…' : 'Retour car non réclamé'}
            </button>
          )}
        </div>
      )}
      {open && (
        <CreateReturnModal
          wpOrderId={wpOrderId}
          ticketId={ticketId}
          concernedProducts={concernedProducts}
          onClose={() => setOpen(false)}
          onCreated={(data) => {
            setOpen(false);
            if (data?.warnings?.length) window.alert(data.warnings.join('\n'));
            load();
          }}
        />
      )}
      {lostOpen && (
        <DeclareLostModal
          wpOrderId={wpOrderId}
          ticketId={ticketId}
          onClose={() => setLostOpen(false)}
          onCreated={() => { setLostOpen(false); load(); }}
        />
      )}
    </div>
  );
}
