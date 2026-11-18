import { useState } from 'react';

/**
 * Pièces communes aux listes de résultats de `GET /api/purchases/products/search`
 * (commande, réception, import PDF) : la vignette du produit et son statut sur le
 * site quand il n'est pas en vente.
 */

/** Vignette carrée ; une image absente ou cassée laisse une case grise. */
export function ProductThumb({ src, size = 40 }) {
  const [broken, setBroken] = useState(false);
  const box = {
    width: size, height: size, flexShrink: 0, borderRadius: 6,
    background: '#f3f4f6', border: '1px solid #eee', objectFit: 'contain',
  };
  if (!src || broken) return <div style={box} />;
  return <img src={src} alt="" loading="lazy" style={box} onError={() => setBroken(true)} />;
}

/**
 * Statut du produit sur le site, si ce n'est pas « publié ».
 * WooCommerce range en `private` une déclinaison désactivée : on le dit comme ça.
 */
function siteStatusLabel(product) {
  if (!product) return null;
  if (product.post_status === 'private') {
    return product.product_type === 'variation' ? 'Déclinaison désactivée' : 'Privé';
  }
  if (product.parent_status === 'private') return 'Parent privé';
  return null;
}

export function SiteStatusBadge({ product }) {
  const label = siteStatusLabel(product);
  if (!label) return null;
  return (
    <span
      title="Produit non visible sur le site : il se commande quand même."
      style={{
        marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#6B21A8',
        background: '#F3E8FF', borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
