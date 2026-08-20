import { LinkBox } from '../utils/navHelpers';
import { TICKETS_COLOR, formatTicketId } from './tickets/ticketConstants';

/**
 * Badges « demande SAV » posés hors de l'app SAV (fiche client, fiche commande).
 *
 * Un badge par ticket, et non un simple compteur : l'agent qui repère une
 * demande sur une commande veut l'ouvrir, pas retourner la chercher dans la
 * liste SAV. Les couleurs de statut viennent du ticket lui-même (table
 * `sav_ticket_statuses`, configurable) — rien n'est codé en dur ici.
 */

const chipBase = {
  alignItems: 'center',
  gap: 5,
  padding: '3px 9px',
  borderRadius: 999,
  background: `${TICKETS_COLOR}14`,
  border: `1px solid ${TICKETS_COLOR}40`,
  color: TICKETS_COLOR,
  fontSize: 11.5,
  fontWeight: 800,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

/** Chip cliquable vers le ticket : « SAV #123 » + pastille de statut. */
export function SavTicketChip({ ticket, showStatus = true, style }) {
  if (!ticket) return null;
  const title = [ticket.subject, ticket.status_label || ticket.sav_status]
    .filter(Boolean)
    .join(' — ');

  return (
    <LinkBox
      to={`/tickets/${ticket.id}`}
      display="inline-flex"
      title={title || 'Demande SAV'}
      style={{ ...chipBase, ...style }}
    >
      {/* Pastille à la couleur du statut : rouge « ouvert » / vert « résolu » se
          lisent d'un coup d'œil, y compris quand la pastille de statut est
          masquée (colonne étroite de l'historique client). */}
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: ticket.status_color || TICKETS_COLOR,
      }} />
      SAV {formatTicketId(ticket.id)}
      {showStatus && (ticket.status_label || ticket.sav_status) && (
        <span style={{
          padding: '1px 7px',
          borderRadius: 999,
          background: ticket.status_bg || '#F0F0F0',
          color: ticket.status_color || '#626E85',
          fontSize: 10.5,
          fontWeight: 800,
        }}>
          {ticket.status_label || ticket.sav_status}
        </span>
      )}
    </LinkBox>
  );
}

/** Liste de chips (une commande peut porter plusieurs demandes). */
export function SavTicketChips({ tickets, showStatus = true, style }) {
  const list = tickets || [];
  if (list.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 5, ...style }}>
      {list.map(t => <SavTicketChip key={t.id} ticket={t} showStatus={showStatus} />)}
    </span>
  );
}

/**
 * Marqueur d'un article désigné par le client dans sa demande.
 * `ticketIds` vient du backend (appariement par SKU, repli sur le libellé).
 */
export function SavConcernedTag({ ticketIds, style }) {
  const ids = ticketIds || [];
  if (ids.length === 0) return null;
  const label = ids.length > 1 ? `concerné par ${ids.length} demandes SAV` : 'concerné par la demande SAV';

  return (
    <LinkBox
      to={`/tickets/${ids[0]}`}
      display="inline-flex"
      title={ids.map(id => `Ticket ${formatTicketId(id)}`).join(', ')}
      style={{ ...chipBase, fontSize: 10.5, padding: '1px 8px', gap: 4, ...style }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: TICKETS_COLOR, flexShrink: 0 }} />
      {label}
    </LinkBox>
  );
}

export { TICKETS_COLOR };
