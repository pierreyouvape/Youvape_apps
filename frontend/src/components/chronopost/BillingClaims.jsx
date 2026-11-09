import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL, authHeaders, C, Chip } from '../picking/pickingUi';
import { claimLineId } from '../../utils/billingClaimLine';

/**
 * Réclamations de facturation Chronopost : choix des lignes à réclamer (onglet Email d'une
 * facture), puis suivi des demandes comparées aux avoirs et rectificatives reçus.
 * Le résultat vient du serveur (services/claims/billingClaimMatch.js).
 */

const eur = v => (v == null ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`);
const jour = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
const kg = v => (v == null ? '—' : `${Number(v).toFixed(3)} kg`);

const STATUTS = {
  accepted: { label: 'Acceptée', color: C.green, bg: C.greenL },
  partial: { label: 'En partie', color: C.amber, bg: C.amberL },
  not_accepted: { label: 'Non acceptée', color: C.red, bg: C.redL },
  pending: { label: 'En attente', color: C.greyT, bg: C.grey },
};
const Statut = ({ status }) => {
  const s = STATUTS[status] || STATUTS.pending;
  return <Chip color={s.color} bg={s.bg}>{s.label}</Chip>;
};

const th = { padding: '8px 10px', fontWeight: 700, textAlign: 'left' };
const td = { padding: '7px 10px' };
const thead = { background: C.grey, color: C.greyT, fontSize: 11.5, textTransform: 'uppercase' };
const ghost = {
  background: C.white, color: C.dark, border: `1px solid ${C.greyB}`, borderRadius: 8,
  padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

/** Les lignes détectées sur la facture : on coche ce qu'on réclame vraiment. */
export function ClaimSelector({
  lines, unchecked, onToggle, onSetAll, sentOn, onSentOn, saved, saving, message, canSave, onSave, onDelete,
}) {
  const checked = lines.filter(l => !unchecked.has(l.key));
  const total = checked.reduce((s, l) => s + (Number(l.claimed_ht) || 0), 0);
  const savedById = new Map((saved?.lines || []).map(l => [claimLineId(l), l]));

  return (
    <div style={{ border: `1px solid ${C.greyB}`, borderRadius: 10, marginBottom: 18, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 14px' }}>
        <strong style={{ fontSize: 14, color: C.dark }}>À réclamer : {checked.length} / {lines.length} lignes, {eur(total)} HT</strong>
        <button onClick={() => onSetAll(true)} style={ghost}>Tout cocher</button>
        <button onClick={() => onSetAll(false)} style={ghost}>Tout décocher</button>
        {saved && <Statut status={saved.summary.status} />}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12.5, color: C.greyT }}>
            Envoyée le{' '}
            <input type="date" value={sentOn} onChange={e => onSentOn(e.target.value)}
              style={{ padding: '5px 8px', border: `1px solid ${C.greyB}`, borderRadius: 6, fontFamily: 'inherit' }} />
          </label>
          {saved && <button onClick={onDelete} disabled={saving} style={{ ...ghost, color: C.red }}>Supprimer la demande</button>}
          <button onClick={onSave} disabled={saving || !canSave || !checked.length || !sentOn} style={{
            background: C.green, color: C.white, border: 'none', borderRadius: 8, padding: '8px 14px',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            opacity: saving || !canSave || !checked.length || !sentOn ? 0.5 : 1,
          }}>{saving ? 'Enregistrement…' : saved ? 'Mettre à jour ma demande' : 'Enregistrer ma demande'}</button>
        </span>
      </div>
      {!canSave && <div style={{ padding: '0 14px 10px', fontSize: 12.5, color: C.amber }}>Enregistre d'abord la facture pour garder ta demande.</div>}
      {message && <div style={{ padding: '0 14px 10px', fontSize: 13, color: message.ok ? C.green : C.red }}>{message.text}</div>}
      <div style={{ overflow: 'auto', maxHeight: 380, borderTop: `1px solid ${C.greyB}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={thead}>
              <th style={th} />
              <th style={th}>Commande</th>
              <th style={th}>Suivi</th>
              <th style={th}>Motif</th>
              <th style={{ ...th, textAlign: 'right' }}>Montant HT</th>
              {saved && <th style={th}>Résultat</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const res = savedById.get(claimLineId(l));
              return (
                <tr key={l.key} onClick={() => onToggle(l.key)} style={{ borderTop: `1px solid ${C.greyB}`, cursor: 'pointer', opacity: unchecked.has(l.key) ? 0.5 : 1 }}>
                  <td style={td}><input type="checkbox" checked={!unchecked.has(l.key)} readOnly aria-label={`Réclamer ${l.tracking}`} /></td>
                  <td style={td}>{l.order_id || '—'}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{l.tracking}</td>
                  <td style={td}>{l.kind === 'weight' ? `Poids : ${kg(l.weight_declared)} déclaré, ${kg(l.weight_billed)} facturé` : l.description}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{l.claimed_ht == null ? 'À calculer' : eur(l.claimed_ht)}</td>
                  {saved && <td style={td}>{res ? <Statut status={res.status} /> : <span style={{ color: C.greyM }}>Non demandée</span>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Demande({ claim, onOpenInvoice }) {
  const [ouvert, setOuvert] = useState(false);
  const { summary: s } = claim;
  const refus = claim.lines.filter(l => l.status === 'not_accepted' || l.status === 'partial');

  return (
    <div style={{ border: `1px solid ${C.greyB}`, borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '11px 14px' }}>
        <button onClick={() => setOuvert(o => !o)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 14, fontWeight: 800, color: C.dark }}>
          {ouvert ? '▾' : '▸'} Facture {claim.invoice_number}
        </button>
        <span style={{ fontSize: 12.5, color: C.greyT }}>envoyée le {jour(claim.sent_on)}{claim.created_by_name ? ` par ${claim.created_by_name}` : ''}</span>
        <Statut status={s.status} />
        <span style={{ fontSize: 13 }}>Demandé <strong>{eur(s.claimed_ht)}</strong> · Obtenu <strong style={{ color: s.obtained_ht >= s.claimed_ht ? C.green : C.dark }}>{eur(s.obtained_ht)}</strong> HT, hors carburant</span>
        <span style={{ fontSize: 12.5, color: C.greyT }}>
          {s.accepted}/{s.total} acceptées{s.partial ? `, ${s.partial} en partie` : ''}{s.not_accepted ? `, ${s.not_accepted} non acceptées` : ''}{s.pending ? `, ${s.pending} en attente` : ''}
        </span>
        {claim.invoice_id && <button onClick={() => onOpenInvoice(claim.invoice_id)} style={{ ...ghost, marginLeft: 'auto' }}>Ouvrir la facture</button>}
      </div>
      {!ouvert && refus.length > 0 && (
        <div style={{ padding: '0 14px 10px', fontSize: 12.5, color: C.red }}>
          À relancer : {refus.map(l => l.tracking).join(', ')}
        </div>
      )}
      {ouvert && (
        <div style={{ overflowX: 'auto', borderTop: `1px solid ${C.greyB}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={thead}>
                <th style={th}>Commande</th><th style={th}>Suivi</th><th style={th}>Motif</th>
                <th style={{ ...th, textAlign: 'right' }}>Demandé</th><th style={{ ...th, textAlign: 'right' }}>Obtenu</th>
                <th style={th}>Résultat</th><th style={th}>Documents</th>
              </tr>
            </thead>
            <tbody>
              {claim.lines.map(l => (
                <tr key={l.id} style={{ borderTop: `1px solid ${C.greyB}` }}>
                  <td style={td}>{l.order_id ? <a href={`/orders/${l.order_id}`} target="_blank" rel="noreferrer">{l.order_id}</a> : '—'}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{l.tracking}</td>
                  <td style={td}>{l.kind === 'weight' ? `Poids : ${kg(l.weight_declared)} déclaré, ${kg(l.weight_billed)} facturé` : l.description}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{l.claimed_ht == null ? '—' : eur(l.claimed_ht)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{l.status === 'pending' ? '—' : eur(l.obtained_ht)}</td>
                  <td style={td}><Statut status={l.status} /></td>
                  <td style={{ ...td, fontSize: 12, color: C.greyT }}>{[l.credit_number && `Avoir ${l.credit_number}`, l.rectif_number && `Rectif. ${l.rectif_number} (${eur(l.rebilled_ht)})`].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {claim.extras.length > 0 && (
            <div style={{ padding: '10px 14px', fontSize: 12.5, color: C.greyT, borderTop: `1px solid ${C.greyB}` }}>
              <strong>Reçu hors de cette demande :</strong>{' '}
              {claim.extras.map(e => `${e.tracking} ${eur(e.base_ht)} (avoir ${e.credit_number}${e.is_indemnity ? ', indemnisation' : ''})`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Suivi : ce qui a été demandé, ce qui a été obtenu. */
export default function BillingClaimsList({ token, onOpenInvoice }) {
  const [claims, setClaims] = useState(null);
  const [erreur, setErreur] = useState(null);

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      const { data } = await axios.get(`${API_URL}/chronopost/billing-claims`, authHeaders(token));
      setClaims(data.claims);
    } catch (err) {
      setErreur(err.response?.data?.error || 'Erreur de chargement');
    }
  }, [token]);

  useEffect(() => { charger(); }, [charger]);

  return (
    <div style={{ padding: 20 }}>
      <p style={{ margin: '0 0 14px', color: C.greyT, fontSize: 13 }}>
        Tes demandes, comparées aux avoirs et factures rectificatives importés. Une demande s'enregistre
        depuis l'onglet « Email réclamation » d'une facture.
      </p>
      {erreur && <div style={{ color: C.red, fontSize: 13.5, marginBottom: 12 }}>{erreur}</div>}
      {!claims && !erreur && <div style={{ color: C.greyT, fontSize: 13 }}>Chargement…</div>}
      {claims?.length === 0 && <div style={{ textAlign: 'center', padding: 30, color: C.greyT, fontSize: 13 }}>Aucune demande enregistrée pour l'instant.</div>}
      {claims?.map(c => <Demande key={c.id} claim={c} onOpenInvoice={onOpenInvoice} />)}
    </div>
  );
}
