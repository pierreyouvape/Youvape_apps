import { useState, useEffect } from 'react';
import { TICKETS_COLOR } from './ticketConstants';
import { formatDate } from '../../utils/dateUtils';

const C = {
  blanc: '#fff',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38',
};

// ─── Petites icônes ───────────────────────────────────────────────────────────
function IconTruck({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="6" width="14" height="11" rx="1" /><path d="M15 9h4l3 4v4h-7z" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" />
    </svg>
  );
}

function IconExternal({ size = 10, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

function IconChev({ size = 11, color = C.grisM }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M2 4 L6 8 L10 4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLink({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71" />
    </svg>
  );
}

function IconUnlink({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M5.16 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.72-1.71" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

// ─── Badge statut livraison (live tracking) ──────────────────────────────────
export function TrackingBadge({ trackingNum, shippingCarrier }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!trackingNum) { setStatus(false); return; }
    let cancelled = false;
    fetch(`/api/sav/tracking/${encodeURIComponent(trackingNum)}?carrier=${encodeURIComponent(shippingCarrier || '')}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d.success) setStatus(d); })
      .catch(() => { if (!cancelled) setStatus(false); });
    return () => { cancelled = true; };
  }, [trackingNum, shippingCarrier]);

  if (!trackingNum) return null;

  if (status === null) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: '#F0F0F0', color: C.grisM, border: `1px solid ${C.grisCL}`,
        borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 600,
      }}>
        <IconTruck color={C.grisM} />Vérification…
      </span>
    );
  }

  const label      = status?.label || 'Suivi';
  const color      = status?.color || '#135E84';
  const url        = status?.trackingUrl;
  const isLight    = color === '#fff491';
  const textColor  = isLight ? '#000' : '#fff';

  return (
    <a
      href={url || '#'}
      target={url ? '_blank' : undefined}
      rel="noopener noreferrer"
      onClick={e => { e.stopPropagation(); if (!url) e.preventDefault(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: color, color: textColor,
        borderRadius: 6, padding: '3px 10px', fontSize: 11.5, fontWeight: 700,
        cursor: url ? 'pointer' : 'default', textDecoration: 'none', whiteSpace: 'nowrap',
      }}
    >
      <IconTruck color={textColor} size={11} />
      {label}
      {url && <IconExternal color={textColor} size={10} />}
    </a>
  );
}

// ─── Carte commande dépliable ────────────────────────────────────────────────
// Props:
//   order        : { wp_order_id, post_date, post_status, order_total, tracking_number, shipping_carrier, items }
//   highlighted  : true = commande "concernée" (encadré coloré, dépliée par défaut)
//   canAssign    : true = afficher un bouton "Lier" au hover (ticket sans commande)
//   onAssign     : (wp_order_id) => void   appelé au clic sur Lier
//   onUnassign   : () => void              appelé au clic sur Délier (visible si highlighted)
export default function OrderCard({ order, highlighted, canAssign, onAssign, onUnassign }) {
  const [open, setOpen] = useState(!!highlighted);
  const [hoverHeader, setHoverHeader] = useState(false);

  const orderNum      = order.wp_order_id || order.order_id;
  const orderDate     = order.post_date || order.order_date;
  const orderTotal    = order.order_total;
  const orderStatus   = order.post_status || order.order_status;
  const trackingNum   = order.tracking_number;
  const shippingCarrier = order.shipping_carrier || order.order_carrier || '';
  const items = order.items || [];

  const statusLabel = (s) => {
    const map = {
      'wc-completed':          'Livrée',
      'wc-delivered':          'Livrée',
      'wc-being-delivered':    'En livraison',
      'wc-awaiting-delivery':  'En attente de livraison',
      'wc-processing':         'En cours',
      'wc-shipped':            'Expédiée',
      'wc-cancelled':          'Annulée',
      'wc-failed':             'Échouée',
      'wc-refunded':           'Remboursée',
      'wc-on-hold':            'En attente',
      'wc-pending':            'En attente',
      'wc-checkout-draft':     'Brouillon',
      'wc-return-approved':    'Retour accepté',
      'wc-return-cancelled':   'Retour annulé',
      'trash':                 'Corbeille',
    };
    return map[s] || (s?.replace('wc-', '') || '—');
  };

  const statusColors = (s) => {
    if (!s) return { bg: C.grisTL, color: C.grisF };
    // Livré (vert) — complete ou delivered
    if (s.includes('complete') || s === 'wc-delivered') return { bg: '#E5F4EB', color: '#2A8049' };
    // En cours de livraison (orange)
    if (s.includes('being-delivered')) return { bg: '#FFF1D6', color: '#8B5A00' };
    // En attente de livraison (jaune clair)
    if (s.includes('awaiting-delivery')) return { bg: '#FFF8E1', color: '#92650A' };
    // Expédiée (bleu)
    if (s.includes('shipped')) return { bg: '#E5EEF6', color: '#2C5F80' };
    // En cours (orange clair)
    if (s.includes('process')) return { bg: '#FFF1D6', color: '#8B5A00' };
    // Annulée / échouée (rouge)
    if (s.includes('cancel') || s.includes('fail')) return { bg: '#FDEAEA', color: '#B71D1D' };
    // Remboursée (violet)
    if (s.includes('refund')) return { bg: '#F1ECFB', color: '#5D49D6' };
    // Retour (violet clair)
    if (s.includes('return')) return { bg: '#F1ECFB', color: '#5D49D6' };
    return { bg: C.grisTL, color: C.grisF };
  };
  const sc = statusColors(orderStatus);
  const orderUrl = `/orders/${orderNum}`;

  return (
    <div style={{
      background: C.blanc,
      border: `1px solid ${highlighted ? TICKETS_COLOR + '60' : C.grisCL}`,
      borderRadius: 10, marginBottom: 8,
      boxShadow: highlighted ? `0 2px 8px ${TICKETS_COLOR}20` : '0 1px 2px rgba(0,0,0,0.03)',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        onMouseEnter={e => { setHoverHeader(true); if (!open) e.currentTarget.style.background = '#FAFCFD'; }}
        onMouseLeave={e => { setHoverHeader(false); if (!open) e.currentTarget.style.background = open ? '#F6FAFC' : 'transparent'; }}
        style={{
          padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer', background: open ? '#F6FAFC' : 'transparent', transition: 'background 0.12s',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <a
              href={orderUrl}
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 14, fontWeight: 800, color: TICKETS_COLOR, textDecoration: 'none' }}
            >#{orderNum}</a>
            <span style={{ fontSize: 11.5, color: C.grisM, fontWeight: 600 }}>{formatDate(orderDate)}</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.grisTF, fontVariantNumeric: 'tabular-nums' }}>
              {orderTotal ? `${parseFloat(orderTotal).toFixed(2)} €` : '—'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-block', background: sc.bg, color: sc.color,
              padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
            }}>{statusLabel(orderStatus)}</span>
            <TrackingBadge trackingNum={trackingNum} shippingCarrier={shippingCarrier} />
          </div>
        </div>

        {/* Bouton "Lier" — visible au hover si ticket sans commande */}
        {canAssign && onAssign && (
          <button
            onClick={(e) => { e.stopPropagation(); onAssign(orderNum); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: hoverHeader ? TICKETS_COLOR : 'transparent',
              color: hoverHeader ? '#fff' : TICKETS_COLOR,
              border: `1px solid ${hoverHeader ? TICKETS_COLOR : TICKETS_COLOR + '60'}`,
              borderRadius: 6, padding: '4px 8px', fontSize: 11.5, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'Lato, sans-serif',
              opacity: hoverHeader ? 1 : 0.75,
              transition: 'all 0.12s',
              whiteSpace: 'nowrap',
            }}
            title="Lier cette commande au ticket"
          >
            <IconLink size={11} />Lier
          </button>
        )}

        <span style={{ display: 'inline-flex', transition: 'transform 0.18s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <IconChev />
        </span>
      </div>

      {open && (
        <div style={{ padding: '4px 14px 14px', borderTop: `1px solid ${C.grisCL}`, background: '#FAFCFD' }}>
          {items.length > 0 ? items.map((it, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
              borderBottom: i === items.length - 1 ? 'none' : `1px solid ${C.grisCL}50`,
            }}>
              {it.image_url ? (
                <img src={it.image_url} alt={it.order_item_name || it.name}
                  style={{ width: 36, height: 36, borderRadius: 7, objectFit: 'cover', border: `1px solid ${C.grisCL}`, flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 36, height: 36, borderRadius: 7, background: '#F2F4F7', border: `1px solid ${C.grisCL}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0,
                }}>🧪</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: C.grisTF, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.order_item_name || it.name}
                </div>
                {it.sku && <div style={{ fontSize: 11, color: C.grisM, fontFamily: 'monospace', marginTop: 1 }}>SKU: {it.sku}</div>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 12, color: C.grisF, fontWeight: 700 }}>×{it.qty}</div>
                {it.line_total && (
                  <div style={{ fontSize: 12, color: C.grisTF, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {parseFloat(it.line_total).toFixed(2)} €
                  </div>
                )}
              </div>
            </div>
          )) : (
            <div style={{ padding: '10px 0', fontSize: 12.5, color: C.grisM, textAlign: 'center' }}>Aucun article</div>
          )}

          {highlighted && (
            <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
              <a
                href={orderUrl}
                style={{
                  flex: 1,
                  display: 'block', textAlign: 'center', textDecoration: 'none',
                  background: C.blanc, color: TICKETS_COLOR,
                  border: `1px solid ${TICKETS_COLOR}40`, borderRadius: 7,
                  padding: '7px 12px', fontSize: 12.5, fontWeight: 700,
                }}
              >Ouvrir la commande</a>
              {onUnassign && (
                <button
                  onClick={onUnassign}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: C.blanc, color: '#B71D1D',
                    border: `1px solid #B71D1D40`, borderRadius: 7,
                    padding: '7px 12px', fontSize: 12.5, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#FDEAEA'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = C.blanc; }}
                  title="Détacher cette commande du ticket"
                >
                  <IconUnlink size={11} />Délier
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
