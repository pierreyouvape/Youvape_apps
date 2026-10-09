import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { C } from '../picking/pickingUi';
import useTicketsAccess from '../tickets/useTicketsAccess';
import { formatDateUTC } from '../../utils/dateUtils';
import CreateReturnModal from './CreateReturnModal';
import ReturnLabelActions from './ReturnLabelActions';
import { RETURNS_API, RETURNS_COLOR, REASONS, StatusChip, btn } from './returnsUi';

/**
 * Retours d'une commande + bouton « Créer un retour ». Affiché sous la
 * commande concernée d'un ticket, et dans le détail de commande.
 * Sans le droit tickets (403), le bloc ne s'affiche pas.
 */
export default function OrderReturnsBox({ wpOrderId, ticketId, concernedProducts, style }) {
  const { canWrite } = useTicketsAccess();
  const [returns, setReturns] = useState(null);
  const [open, setOpen] = useState(false);
  const valid = /^\d+$/.test(String(wpOrderId || ''));

  const load = useCallback(() => {
    if (!valid) return;
    axios.get(`${RETURNS_API}/order/${wpOrderId}`)
      .then(({ data }) => setReturns(data.returns))
      .catch(() => setReturns(false));
  }, [wpOrderId, valid]);

  useEffect(() => { load(); }, [load]);

  if (!valid || returns === false || returns === null) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {returns.map(r => (
        <div key={r.id} style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, background: C.white, fontSize: 12.5 }}>
          <a
            href={`/retours/${r.id}`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', textDecoration: 'none', color: C.dark }}
          >
            <strong style={{ color: RETURNS_COLOR }}>Retour n°{r.id}</strong>
            <span>{REASONS[r.reason]}</span>
            <StatusChip status={r.status} />
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
        <button type="button" onClick={() => setOpen(true)} style={{ ...btn('ghost'), color: RETURNS_COLOR, borderColor: RETURNS_COLOR, alignSelf: 'flex-start', padding: '6px 12px', fontSize: 12.5 }}>
          ↩ Créer un retour
        </button>
      )}
      {open && (
        <CreateReturnModal
          wpOrderId={wpOrderId}
          ticketId={ticketId}
          concernedProducts={concernedProducts}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); load(); }}
        />
      )}
    </div>
  );
}
