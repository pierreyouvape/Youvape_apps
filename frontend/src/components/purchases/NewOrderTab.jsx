import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/**
 * Construire une commande à la main, produit par produit.
 *
 * Il existait deux chemins vers une commande — les besoins calculés et l'import
 * d'un PDF fournisseur — et aucun ne convenait pour commander deux références
 * précises un mardi matin. Celui-ci part de la recherche.
 *
 * CE QUI SE JOUE ICI : LE CONDITIONNEMENT.
 *
 * Un produit peut avoir plusieurs références chez le même fournisseur — à
 * l'unité, par 50, par 100 — et c'est celle qu'on choisit qui fixe ce que la
 * ligne veut dire. « 4 » ne veut rien dire ; « 4 boîtes de 5, soit 20 pièces »
 * si. L'écran l'écrit donc en toutes lettres à chaque ligne, parce que c'est ce
 * nombre-là qui part chez le fournisseur et qui reviendra en stock.
 *
 * Le PRIX vient du dernier tarif retenu sur une facture contrôlée quand il
 * existe : c'est la boucle que ferme cet écran. L'acheteur peut le corriger,
 * mais il part de ce qui a été réellement payé, pas d'un souvenir.
 */

const C = {
  saphir: '#135E84', orange: '#E28F00', orangeL: '#FDF3E2',
  vert: '#16A34A', vertL: '#F0FDF4', rouge: '#DC2626', rougeL: '#FEF2F2',
  gris: '#F9FAFB', grisB: '#E5E7EB', grisT: '#6B7280', grisM: '#8A99A4',
  sombre: '#111827', blanc: '#FFFFFF',
};

const eur = (n) => (n == null || Number.isNaN(Number(n)))
  ? '—'
  : `${Number(n).toFixed(2).replace('.', ',')} €`;

const th = {
  padding: '10px 12px', textAlign: 'left', fontSize: 11.5, fontWeight: 700,
  color: C.grisT, textTransform: 'uppercase', letterSpacing: 0.3,
  borderBottom: `2px solid ${C.grisB}`, background: C.gris, whiteSpace: 'nowrap',
};
const td = { padding: '10px 12px', fontSize: 13.5, color: C.sombre, borderBottom: `1px solid ${C.grisB}` };

const input = {
  padding: '7px 9px', border: `1px solid ${C.grisB}`, borderRadius: 7,
  fontSize: 13.5, color: C.sombre, outline: 'none', background: C.blanc,
};

function Btn({ children, onClick, variant = 'primary', disabled, small, title }) {
  const fonds = {
    primary: { background: C.saphir, color: '#fff', border: 'none' },
    accent: { background: C.orange, color: '#fff', border: 'none' },
    ghost: { background: 'transparent', color: C.grisT, border: `1px solid ${C.grisB}` },
    danger: { background: 'transparent', color: C.rouge, border: `1px solid ${C.rouge}` },
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        ...fonds[variant], padding: small ? '6px 11px' : '9px 16px', borderRadius: 8,
        fontSize: small ? 12.5 : 13.5, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}>
      {children}
    </button>
  );
}

/** Le conditionnement d'une ligne, écrit pour qu'il n'y ait rien à deviner. */
function Conditionnement({ qty, packQty }) {
  const pieces = (qty || 0) * (packQty || 1);
  if (!(packQty > 1)) {
    return <span style={{ color: C.grisT, fontSize: 12 }}>{pieces} pièce{pieces > 1 ? 's' : ''}</span>;
  }
  return (
    <span style={{ color: C.orange, fontSize: 12, fontWeight: 600 }}>
      {qty} × {packQty}
      <span style={{ color: C.grisT, fontWeight: 500 }}> = {pieces} pièce{pieces > 1 ? 's' : ''}</span>
    </span>
  );
}

export default function NewOrderTab({ token }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [terme, setTerme] = useState('');
  const [resultats, setResultats] = useState([]);
  const [cherche, setCherche] = useState(false);
  const [lignes, setLignes] = useState([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [succes, setSucces] = useState(null);

  useEffect(() => {
    axios.get(`${API_URL}/purchases/suppliers`, auth)
      .then((r) => setSuppliers(Array.isArray(r.data) ? r.data : (r.data.data || [])))
      .catch((e) => setErreur(e.response?.data?.error || e.message));
  }, [token]);

  // Recherche différée : on tape plus vite qu'on ne lit.
  const minuteur = useRef(null);
  useEffect(() => {
    clearTimeout(minuteur.current);
    if (!supplierId || terme.trim().length < 2) { setResultats([]); return undefined; }
    minuteur.current = setTimeout(async () => {
      setCherche(true);
      try {
        const { data } = await axios.get(`${API_URL}/purchases/products/search`, {
          ...auth, params: { q: terme.trim(), supplier_id: supplierId, limit: 20 },
        });
        setResultats(data.data || []);
      } catch (e) { setErreur(e.response?.data?.error || e.message); }
      finally { setCherche(false); }
    }, 350);
    return () => clearTimeout(minuteur.current);
  }, [terme, supplierId, token]);

  /**
   * Ajoute un produit. La référence retenue décide de tout : conditionnement et
   * prix. À défaut de référence connue, on part du conditionnement catalogue.
   */
  const ajouter = (produit, ref) => {
    if (lignes.some((l) => l.product_id === produit.id && l.supplier_sku === (ref?.supplier_sku || null))) {
      setErreur('Cette référence est déjà dans la commande');
      return;
    }
    const packQty = ref ? ref.pack_qty : (produit.supplier_pack_qty || 1);
    setLignes((prev) => [...prev, {
      product_id: produit.id,
      product_name: produit.post_title,
      sku: produit.sku,
      stock: produit.stock,
      supplier_sku: ref ? ref.supplier_sku : null,
      qty_ordered: 1,
      units_per_qty: packQty,
      // Le prix retenu sur une facture contrôlée fait foi ; sinon le prix du
      // lien fournisseur, sinon le coût de revient connu.
      unit_price: ref && ref.pack_price != null
        ? ref.pack_price
        : (produit.supplier_price != null ? produit.supplier_price : produit.cost_price),
      retenu: Boolean(ref && ref.retained_at),
    }]);
    setErreur(null);
  };

  const modifier = (i, champ, valeur) => {
    setLignes((prev) => prev.map((l, k) => (k === i ? { ...l, [champ]: valeur } : l)));
  };
  const retirer = (i) => setLignes((prev) => prev.filter((_, k) => k !== i));

  const totalHt = lignes.reduce(
    (s, l) => s + (parseFloat(l.unit_price) || 0) * (parseInt(l.qty_ordered, 10) || 0), 0,
  );
  const totalPieces = lignes.reduce(
    (s, l) => s + (parseInt(l.qty_ordered, 10) || 0) * (parseInt(l.units_per_qty, 10) || 1), 0,
  );

  const creer = async (envoyerBms) => {
    setEnvoi(true); setErreur(null); setSucces(null);
    try {
      const { data } = await axios.post(`${API_URL}/purchases/orders`, {
        supplier_id: parseInt(supplierId, 10),
        status: envoyerBms ? 'sent' : 'draft',
        items: lignes.map((l) => ({
          product_id: l.product_id,
          product_name: l.product_name,
          supplier_sku: l.supplier_sku,
          qty_ordered: parseInt(l.qty_ordered, 10) || 0,
          units_per_qty: parseInt(l.units_per_qty, 10) || 1,
          unit_price: l.unit_price === '' ? null : parseFloat(l.unit_price),
        })),
      }, auth);
      setSucces({
        order: data.data,
        bmsError: data.bms_error,
        skipped: data.skipped_items || [],
      });
      setLignes([]);
    } catch (e) {
      setErreur(e.response?.data?.error || e.message);
    } finally { setEnvoi(false); }
  };

  const fournisseur = suppliers.find((s) => String(s.id) === String(supplierId));

  return (
    <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: C.sombre }}>Nouvelle commande</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: C.grisT }}>
          Cherchez un produit, choisissez sa référence chez le fournisseur, ajustez la quantité.
          Le prix part du dernier tarif retenu sur une facture contrôlée.
        </p>
      </div>

      {erreur && (
        <div style={{ background: C.rougeL, border: `1px solid ${C.rouge}`, color: '#7F1D1D',
          borderRadius: 10, padding: '12px 15px', fontSize: 13.5 }}>{erreur}</div>
      )}

      {succes && (
        <div style={{ background: C.vertL, border: `1px solid ${C.vert}`, color: '#14532D',
          borderRadius: 10, padding: '12px 15px', fontSize: 13.5 }}>
          Commande <strong>{succes.order?.order_number}</strong> créée.
          {succes.bmsError
            ? <div style={{ marginTop: 6, color: '#7C2D12' }}>
                Elle n'est PAS partie dans BMS : {succes.bmsError}
                {succes.skipped.length > 0 && <> — lignes écartées : {succes.skipped.join(', ')}</>}
              </div>
            : <> Elle est visible dans l'onglet Commandes.</>}
        </div>
      )}

      {/* Fournisseur et recherche */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.grisT }}>FOURNISSEUR</label>
          <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setLignes([]); }}
            style={{ ...input, minWidth: 230 }}>
            <option value="">Choisir…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 260 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.grisT }}>PRODUIT</label>
          <input value={terme} onChange={(e) => setTerme(e.target.value)}
            placeholder={supplierId ? 'Nom, SKU…' : 'Choisissez d\'abord un fournisseur'}
            disabled={!supplierId} style={{ ...input, width: '100%' }} />
        </div>
      </div>

      {/* Résultats de recherche */}
      {supplierId && terme.trim().length >= 2 && (
        <div style={{ background: C.blanc, border: `1px solid ${C.grisB}`, borderRadius: 10, overflow: 'hidden' }}>
          {cherche && <div style={{ padding: 14, fontSize: 13, color: C.grisT }}>Recherche…</div>}
          {!cherche && resultats.length === 0 && (
            <div style={{ padding: 14, fontSize: 13, color: C.grisT }}>
              Aucun produit de {fournisseur?.name || 'ce fournisseur'} ne correspond.
            </div>
          )}
          {resultats.map((p) => (
            <div key={p.id} style={{ padding: '11px 14px', borderBottom: `1px solid ${C.grisB}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.post_title}</div>
                  <div style={{ fontSize: 12, color: C.grisT }}>
                    {p.sku} · stock {p.stock}
                    {p.brand && <> · {p.brand}</>}
                  </div>
                </div>
                {(p.supplier_refs || []).length === 0 && (
                  <Btn small variant="ghost" onClick={() => ajouter(p, null)}>
                    Ajouter{p.supplier_pack_qty > 1 ? ` (par ${p.supplier_pack_qty})` : ''}
                  </Btn>
                )}
              </div>
              {(p.supplier_refs || []).length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {p.supplier_refs.map((ref) => (
                    <button key={ref.supplier_sku} type="button" onClick={() => ajouter(p, ref)}
                      style={{
                        border: `1px solid ${ref.retained_at ? C.vert : C.grisB}`, borderRadius: 8,
                        background: ref.retained_at ? C.vertL : C.blanc, cursor: 'pointer',
                        padding: '7px 11px', textAlign: 'left', fontSize: 12.5,
                      }}>
                      <strong>{ref.supplier_sku}</strong>
                      <span style={{ color: C.grisT }}>
                        {' '}· par {ref.pack_qty} · {eur(ref.pack_price)}
                      </span>
                      {ref.retained_at && (
                        <span style={{ color: C.vert, fontWeight: 600 }}> · tarif retenu</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* La commande en construction */}
      {lignes.length > 0 && (
        <div style={{ background: C.blanc, border: `1px solid ${C.grisB}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Produit</th>
                  <th style={th}>Référence</th>
                  <th style={{ ...th, textAlign: 'right' }}>Quantité</th>
                  <th style={{ ...th, textAlign: 'right' }}>Par</th>
                  <th style={th}>Soit</th>
                  <th style={{ ...th, textAlign: 'right' }}>Prix</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={`${l.product_id}-${l.supplier_sku || 'sans'}`}>
                    <td style={td}>
                      {l.product_name}
                      <div style={{ fontSize: 11.5, color: C.grisM }}>{l.sku} · stock {l.stock}</div>
                    </td>
                    <td style={{ ...td, color: C.grisT }}>
                      {l.supplier_sku || '—'}
                      {l.retenu && <div style={{ fontSize: 11, color: C.vert, fontWeight: 600 }}>tarif retenu</div>}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <input type="number" min="1" value={l.qty_ordered}
                        onChange={(e) => modifier(i, 'qty_ordered', e.target.value)}
                        style={{ ...input, width: 76, textAlign: 'right' }} />
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <input type="number" min="1" value={l.units_per_qty}
                        onChange={(e) => modifier(i, 'units_per_qty', e.target.value)}
                        style={{ ...input, width: 68, textAlign: 'right' }} />
                    </td>
                    <td style={td}>
                      <Conditionnement qty={parseInt(l.qty_ordered, 10) || 0}
                        packQty={parseInt(l.units_per_qty, 10) || 1} />
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <input type="number" step="0.01" min="0" value={l.unit_price ?? ''}
                        onChange={(e) => modifier(i, 'unit_price', e.target.value)}
                        style={{ ...input, width: 92, textAlign: 'right' }} />
                      <div style={{ fontSize: 11, color: C.grisM }}>
                        {parseInt(l.units_per_qty, 10) > 1 ? 'du lot' : 'la pièce'}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                      {eur((parseFloat(l.unit_price) || 0) * (parseInt(l.qty_ordered, 10) || 0))}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <Btn small variant="danger" onClick={() => retirer(i)}>Retirer</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 14, flexWrap: 'wrap', padding: '14px 16px', background: C.gris }}>
            <div style={{ fontSize: 13.5, color: C.grisT }}>
              {lignes.length} ligne{lignes.length > 1 ? 's' : ''} ·{' '}
              <strong style={{ color: C.sombre }}>{totalPieces} pièces</strong> ·{' '}
              <strong style={{ color: C.sombre }}>{eur(totalHt)} HT</strong>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn variant="ghost" onClick={() => setLignes([])} disabled={envoi}>Vider</Btn>
              <Btn variant="ghost" onClick={() => creer(false)} disabled={envoi}>
                Enregistrer en brouillon
              </Btn>
              <Btn variant="accent" onClick={() => creer(true)} disabled={envoi}>
                {envoi ? 'Envoi…' : 'Créer et envoyer à BMS'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
