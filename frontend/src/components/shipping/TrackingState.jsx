import { TRACKING_STATES } from '../../utils/trackingStates';
import { formatDateUTC } from '../../utils/dateUtils';

/**
 * L'état d'un colis chez le transporteur (badge) et son parcours (journal).
 *
 * Utilisés par l'historique d'expédition, la liste et la fiche des commandes.
 * Les dates du suivi sont en UTC avec fuseau : formatDateUTC les ramène à
 * l'heure de Paris.
 */

/** Badge d'état ; `at` (facultatif) s'affiche dessous, en petit. */
export function TrackingStateBadge({ state, at, error, compact = false }) {
  if (!state) {
    if (error) {
      return <span title={error} style={{ fontSize: 12, color: '#999' }}>Pas de suivi</span>;
    }
    return <span style={{ fontSize: 12, color: '#bbb' }}>—</span>;
  }
  const s = TRACKING_STATES[state] || { label: state, color: '#6c757d' };
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <span style={{
        display: 'inline-block', alignSelf: 'flex-start', background: s.color, color: 'white',
        borderRadius: 6, padding: compact ? '2px 7px' : '3px 9px',
        fontSize: compact ? 11 : 11.5, fontWeight: 700, whiteSpace: 'nowrap',
      }}>{s.label}</span>
      {at && <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>{formatDateUTC(at)}</span>}
    </span>
  );
}

/**
 * Le journal transporteur, du plus récent au plus ancien. Un évènement « à
 * classer » (code jamais vu, sans état) est signalé : il ne compte pas tant
 * qu'un responsable ne l'a pas classé dans les paramètres du packing.
 */
export function TrackingTimeline({ events }) {
  if (!events || events.length === 0) {
    return <div style={{ fontSize: 13, color: '#999' }}>Aucun évènement reçu du transporteur.</div>;
  }
  const liste = [...events].reverse();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {liste.map((e) => {
        const s = TRACKING_STATES[e.state];
        return (
          <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{
              width: 9, height: 9, borderRadius: '50%', marginTop: 5, flexShrink: 0,
              background: s ? s.color : '#ced4da',
            }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#333' }}>
                {e.label || e.event_key}
                {!e.state && (
                  <span title="Code jamais classé : il ne change pas l'état du colis" style={{
                    marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: '#b54708',
                    background: '#fff4e5', borderRadius: 4, padding: '1px 5px',
                  }}>à classer</span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: '#888' }}>
                {formatDateUTC(e.occurred_at)}
                {e.location && ` — ${e.location}`}
              </div>
              {e.detail && <div style={{ fontSize: 11.5, color: '#666', fontStyle: 'italic' }}>{e.detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
