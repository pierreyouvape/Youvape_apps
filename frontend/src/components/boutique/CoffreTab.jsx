import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_URL, authHeaders, C } from '../picking/pickingUi';

/**
 * Boutique › Coffre — solde théorique du coffre de LA boutique de la page,
 * droit `coffre-boutiques`.
 *
 * théorique = dernier comptage + (espèces comptées à chaque clôture − fond)
 *             − remises en banque. Le calcul est fait par le serveur
 * (models/coffreModel) ; l'écran n'additionne que le calculateur.
 */

const SLATE = '#334155';

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const signe = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + eur.format(Math.abs(n));

/** « AAAA-MM-JJ HH:MM:SS » (heure de Paris, texte du serveur) → « JJ/MM/AAAA HH:MM ». */
const dateHeure = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}` : '');
const heure = (s) => (s ? s.slice(11, 16).replace(':', 'h') : '');

const libelleCoupure = (v) => (v >= 1 ? `${v} €` : `${String(Math.round(v * 100)).padStart(2, '0')} cts`);

const champ = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`,
  fontSize: 13.5, fontFamily: 'inherit', color: C.dark, background: C.white,
};

const carte = {
  background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, marginBottom: 16,
};

const bouton = (couleur, plein = true) => ({
  ...champ, cursor: 'pointer', fontWeight: 700,
  background: plein ? couleur : C.white, color: plein ? '#fff' : couleur, borderColor: couleur,
});

function Tuile({ label, value, sub, color }) {
  return (
    <div style={{ ...carte, marginBottom: 0, flex: '1 1 190px', padding: '14px 16px' }}>
      <div style={{ fontSize: 12.5, color: C.greyT, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || C.dark, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.greyT, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Bandeau({ couleur, fond, children }) {
  return (
    <div style={{
      background: fond, borderLeft: `4px solid ${couleur}`, color: C.dark,
      padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13.5,
    }}>{children}</div>
  );
}

/** Écart en couleur : vert à zéro, rouge sinon. */
function Ecart({ value, prefix = 'écart ' }) {
  if (value == null) return null;
  const nul = Math.abs(value) < 0.005;
  return (
    <span style={{
      padding: '1px 7px', borderRadius: 6, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
      background: nul ? C.greenL : C.redL, color: nul ? C.green : C.red,
    }}>{prefix}{nul ? '0,00 €' : signe(value)}</span>
  );
}

function Th({ children, align = 'left' }) {
  return <th style={{
    padding: '10px 12px', textAlign: align, fontWeight: 700, color: C.greyT,
    fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3,
    borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap',
  }}>{children}</th>;
}

function Td({ children, align = 'left', bold, color }) {
  return <td style={{
    padding: '9px 12px', textAlign: align, color: color || C.dark, fontWeight: bold ? 700 : 400,
    borderBottom: `1px solid ${C.greyB}`, fontSize: 13.5, fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
  }}>{children}</td>;
}

/* ─── CALCULATEUR ───────────────────────────────────────── */
function Calculateur({ coupures, theorique, onSave, saving }) {
  const [counts, setCounts] = useState({});
  const [note, setNote] = useState('');
  const refs = useRef([]);

  const totalCts = coupures.reduce((s, v) => s + Math.round(v * 100) * (parseInt(counts[String(v)], 10) || 0), 0);
  const total = totalCts / 100;
  const ecart = theorique == null ? null : Math.round((total - theorique) * 100) / 100;
  const vide = totalCts === 0 && !Object.values(counts).some((c) => c !== '' && c != null);

  const saisir = (v, val) => {
    if (val !== '' && !/^\d+$/.test(val)) return;
    setCounts((c) => ({ ...c, [String(v)]: val }));
  };

  // Entrée passe à la coupure suivante : on compte la pile, on tape, Entrée.
  const suivant = (e, i) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    refs.current[i + 1]?.focus();
  };

  const enregistrer = async () => {
    const msg = theorique == null
      ? `Enregistrer ce comptage de ${eur.format(total)} comme solde de départ du coffre ?`
      : `Enregistrer ce comptage de ${eur.format(total)} ?\nThéorique : ${eur.format(theorique)} — écart : ${signe(ecart) || '0,00 €'}`;
    if (!window.confirm(msg)) return;
    const ok = await onSave(counts, note.trim());
    if (ok) { setCounts({}); setNote(''); }
  };

  const ligne = (v, i) => {
    const n = parseInt(counts[String(v)], 10) || 0;
    return (
      <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        <span style={{ width: 64, fontWeight: 700, color: C.dark, fontSize: 13.5 }}>{libelleCoupure(v)}</span>
        <span style={{ color: C.greyM }}>×</span>
        <input
          ref={(el) => { refs.current[i] = el; }}
          inputMode="numeric"
          value={counts[String(v)] ?? ''}
          onChange={(e) => saisir(v, e.target.value.trim())}
          onKeyDown={(e) => suivant(e, i)}
          onFocus={(e) => e.target.select()}
          placeholder="0"
          style={{ ...champ, width: 70, textAlign: 'right', padding: '5px 8px' }}
        />
        <span style={{ flex: 1, textAlign: 'right', color: n ? C.dark : C.greyM, fontVariantNumeric: 'tabular-nums', fontSize: 13.5 }}>
          {eur.format((Math.round(v * 100) * n) / 100)}
        </span>
      </div>
    );
  };

  const billets = coupures.filter((v) => v >= 5);
  const pieces = coupures.filter((v) => v < 5);

  return (
    <div style={{ ...carte, padding: 16, flex: '2 1 460px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: C.dark }}>Comptage du coffre</h3>
        {!vide && (
          <button onClick={() => setCounts({})} style={{ ...champ, marginLeft: 'auto', cursor: 'pointer', border: 'none', color: C.greyT, padding: '2px 6px' }}>
            Tout effacer
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', marginBottom: 4 }}>Billets</div>
          {billets.map((v) => ligne(v, coupures.indexOf(v)))}
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', marginBottom: 4 }}>Pièces</div>
          {pieces.map((v) => ligne(v, coupures.indexOf(v)))}
        </div>
      </div>

      <div style={{
        display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end',
        borderTop: `1px solid ${C.greyB}`, marginTop: 12, paddingTop: 12,
      }}>
        <div>
          <div style={{ fontSize: 12, color: C.greyT, fontWeight: 600 }}>Compté</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.dark, fontVariantNumeric: 'tabular-nums' }}>{eur.format(total)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.greyT, fontWeight: 600 }}>Théorique</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.greyT, fontVariantNumeric: 'tabular-nums' }}>
            {theorique == null ? '—' : eur.format(theorique)}
          </div>
        </div>
        {ecart != null && !vide && (
          <div>
            <div style={{ fontSize: 12, color: C.greyT, fontWeight: 600 }}>Écart</div>
            <div style={{
              fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              color: Math.abs(ecart) < 0.005 ? C.green : C.red,
            }}>
              {Math.abs(ecart) < 0.005 ? '0,00 €' : signe(ecart)}
              <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 6 }}>
                {ecart > 0.005 ? 'en trop' : ecart < -0.005 ? 'manquant' : ''}
              </span>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Commentaire (facultatif)"
          style={{ ...champ, flex: '1 1 220px' }}
        />
        <button onClick={enregistrer} disabled={vide || saving} style={{ ...bouton(SLATE), opacity: vide || saving ? 0.5 : 1 }}>
          Enregistrer le comptage
        </button>
      </div>
    </div>
  );
}

/* ─── REMISE EN BANQUE ──────────────────────────────────── */
function Remise({ now, onSave, saving }) {
  const maintenant = now ? now.slice(0, 16).replace(' ', 'T') : '';
  const [montant, setMontant] = useState('');
  const [quand, setQuand] = useState(maintenant);
  const [note, setNote] = useState('');

  useEffect(() => { if (!quand && maintenant) setQuand(maintenant); }, [maintenant, quand]);

  const valeur = Number(String(montant).replace(',', '.'));
  const valide = Number.isFinite(valeur) && valeur > 0;

  const enregistrer = async () => {
    if (!window.confirm(`Enregistrer une remise en banque de ${eur.format(valeur)} le ${dateHeure(quand.replace('T', ' '))} ?`)) return;
    const ok = await onSave(valeur, quand, note.trim());
    if (ok) { setMontant(''); setNote(''); setQuand(''); }
  };

  return (
    <div style={{ ...carte, padding: 16, flex: '1 1 280px', alignSelf: 'flex-start' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, color: C.dark }}>Remise en banque</h3>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: C.greyT }}>Argent sorti du coffre pour être déposé à la banque.</p>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.greyT, marginBottom: 4 }}>Montant</label>
      <input
        inputMode="decimal"
        value={montant}
        onChange={(e) => setMontant(e.target.value)}
        placeholder="0,00"
        style={{ ...champ, width: '100%', boxSizing: 'border-box', marginBottom: 10, fontSize: 16, fontWeight: 700 }}
      />
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.greyT, marginBottom: 4 }}>Date et heure</label>
      <input
        type="datetime-local"
        value={quand}
        max={maintenant}
        onChange={(e) => setQuand(e.target.value)}
        style={{ ...champ, width: '100%', boxSizing: 'border-box', marginBottom: 10 }}
      />
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.greyT, marginBottom: 4 }}>Commentaire</label>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="N° de bordereau…"
        style={{ ...champ, width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
      />
      <button onClick={enregistrer} disabled={!valide || !quand || saving} style={{ ...bouton(SLATE), width: '100%', opacity: !valide || !quand || saving ? 0.5 : 1 }}>
        Enregistrer la remise
      </button>
    </div>
  );
}

/* ─── JOURNAL ───────────────────────────────────────────── */
const detailCoupures = (d) => Object.entries(d || {})
  .sort((a, b) => Number(b[0]) - Number(a[0]))
  .map(([v, n]) => `${n} × ${libelleCoupure(Number(v))}`)
  .join(', ');

function LigneJournal({ e, i, onDelete }) {
  const fondLigne = i % 2 ? C.zebra : C.white;
  if (e.type === 'cloture') {
    return (
      <tr style={{ background: fondLigne }}>
        <Td color={C.greyT}>{dateHeure(e.at)}</Td>
        <Td>Clôture de caisse</Td>
        <Td color={C.greyT}>
          {e.declared == null ? 'Clôture sans comptage du tiroir' : (
            <>
              Tiroir compté {eur.format(e.declared)} − fond {eur.format(e.fond || 0)} · espèces vendues {eur.format(e.sold || 0)}{' '}
              {e.registerGap != null && Math.abs(e.registerGap) >= 0.005 && <Ecart value={e.registerGap} prefix="écart caisse " />}
            </>
          )}
        </Td>
        <Td align="right" color={C.green} bold>{e.deposit == null ? '—' : signe(e.deposit)}</Td>
        <Td align="right">{e.balance == null ? '—' : eur.format(e.balance)}</Td>
        <Td />
      </tr>
    );
  }
  const remise = e.type === 'remise';
  return (
    <tr style={{ background: fondLigne }}>
      <Td color={C.greyT}>{dateHeure(e.at)}</Td>
      <Td bold>{remise ? 'Remise en banque' : 'Comptage du coffre'}</Td>
      <Td color={C.greyT}>
        <span title={remise ? undefined : detailCoupures(e.denominations)}>
          {[e.author && `par ${e.author}`, e.note].filter(Boolean).join(' · ')}
        </span>{' '}
        {!remise && (e.gap == null ? <span style={{ fontSize: 12, fontWeight: 700, color: SLATE }}>point de départ</span> : <Ecart value={e.gap} />)}
      </Td>
      <Td align="right" bold color={remise ? C.red : SLATE}>
        {remise ? signe(-e.amount) : `= ${eur.format(e.amount)}`}
      </Td>
      <Td align="right">{e.balance == null ? '—' : eur.format(e.balance)}</Td>
      <Td align="right">
        <button
          onClick={() => onDelete(e)}
          title="Supprimer (saisie erronée)"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.greyM, fontSize: 15, padding: 0 }}
        >×</button>
      </Td>
    </tr>
  );
}

/* ─── COFFRE TAB ────────────────────────────────────────── */
export default function CoffreTab({ shop, token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState(null);

  const charger = useCallback(() => {
    setLoading(true);
    return axios.get(`${API_URL}/coffre/${shop.slug}`, authHeaders(token))
      .then((res) => { setData(res.data); setErreur(null); })
      .catch((err) => setErreur(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, [shop.slug, token]);

  useEffect(() => { charger(); }, [charger]);

  const envoyer = async (requete) => {
    setSaving(true);
    try {
      await requete();
      await charger();
      return true;
    } catch (err) {
      setErreur(err.response?.data?.error || "Erreur d'enregistrement");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const enregistrerComptage = (denominations, note) => envoyer(() =>
    axios.post(`${API_URL}/coffre/${shop.slug}/comptages`, { denominations, note }, authHeaders(token)));

  const enregistrerRemise = (amount, at, note) => envoyer(() =>
    axios.post(`${API_URL}/coffre/${shop.slug}/remises`, { amount, at, note }, authHeaders(token)));

  const supprimer = (e) => {
    const quoi = e.type === 'remise' ? `la remise en banque de ${eur.format(e.amount)}` : `le comptage de ${eur.format(e.amount)}`;
    if (!window.confirm(`Supprimer ${quoi} du ${dateHeure(e.at)} ?\nLe solde du coffre sera recalculé.`)) return;
    envoyer(() => axios.delete(`${API_URL}/coffre/${shop.slug}/movements/${e.id}`, authHeaders(token)));
  };

  if (!data) {
    return erreur
      ? <Bandeau couleur={C.red} fond={C.redL}>{erreur}</Bandeau>
      : <div style={{ padding: 28, color: C.greyM }}>Chargement…</div>;
  }

  const { balance, anchor, since, openRegister, unknownRegisters, journal } = data;

  return (
    <div style={{ opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s' }}>
      {erreur && <Bandeau couleur={C.red} fond={C.redL}>{erreur}</Bandeau>}
      {data.syncError && <Bandeau couleur={C.amber} fond={C.amberL}>{data.syncError}</Bandeau>}
      {unknownRegisters.length > 0 && (
        <Bandeau couleur={C.amber} fond={C.amberL}>
          {unknownRegisters.length} caisse{unknownRegisters.length > 1 ? 's ouvertes' : ' ouverte'} par un compte Nextore
          non rattaché à une boutique (compte n° {[...new Set(unknownRegisters.map((r) => r.user_id))].join(', ')},
          dernière le {dateHeure(unknownRegisters[0].opened_at)}) :{' '}
          {unknownRegisters.length > 1 ? 'leurs clôtures ne sont pas comptées' : "sa clôture n'est pas comptée"} dans
          le coffre. À signaler pour rattacher ce compte à sa boutique.
        </Bandeau>
      )}
      {!anchor && (
        <Bandeau couleur={SLATE} fond="#F1F5F9">
          Aucun comptage enregistré : comptez le coffre pour fixer son solde de départ.
          Les clôtures de caisse s'ajouteront ensuite automatiquement.
        </Bandeau>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Tuile
          label="Solde théorique du coffre"
          value={balance == null ? '—' : eur.format(balance)}
          color={SLATE}
          sub={`au ${dateHeure(data.now)}`}
        />
        {anchor && (
          <>
            <Tuile
              label="Dernier comptage"
              value={eur.format(anchor.amount)}
              sub={<>{dateHeure(anchor.at)}{anchor.author ? ` par ${anchor.author}` : ''} {anchor.gap != null && <Ecart value={anchor.gap} />}</>}
            />
            <Tuile
              label="Clôtures depuis"
              value={signe(since.deposits) || eur.format(0)}
              sub={`${since.closures} clôture${since.closures > 1 ? 's' : ''} de caisse`}
              color={since.deposits ? C.green : C.dark}
            />
            <Tuile
              label="Remises en banque depuis"
              value={since.remises ? signe(-since.remises) : eur.format(0)}
              sub={`${since.remiseCount} remise${since.remiseCount > 1 ? 's' : ''}`}
              color={since.remises ? C.red : C.dark}
            />
          </>
        )}
      </div>

      {openRegister && (
        <p style={{ margin: '0 0 16px', fontSize: 13, color: C.greyT }}>
          Caisse du jour ouverte depuis {heure(openRegister.openedAt)} : ses espèces entreront au coffre à la clôture.
        </p>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Calculateur coupures={data.denominations} theorique={balance} onSave={enregistrerComptage} saving={saving} />
        <Remise now={data.now} onSave={enregistrerRemise} saving={saving} />
      </div>

      <div style={carte}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.greyB}` }}>
          <h3 style={{ margin: 0, fontSize: 15, color: C.dark }}>Journal du coffre</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Opération</Th>
                <Th>Détail</Th>
                <Th align="right">Mouvement</Th>
                <Th align="right">Solde coffre</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {journal.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: C.greyM }}>Aucune opération.</td></tr>
              ) : journal.map((e, i) => (
                <LigneJournal key={`${e.type}-${e.id}`} e={e} i={i} onDelete={supprimer} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
