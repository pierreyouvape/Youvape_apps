import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TICKETS_COLOR } from './ticketConstants';
import { formatDate } from '../../utils/dateUtils';

// Pop-up de complétion d'une macro : affichée à l'application quand la macro
// contient des balises « à saisir » ({{?produit}}, {{?texte:…}}, {{?choix:…}},
// {{?date:…}}). Retourne à l'appelant une map { [field.id]: valeur finale }
// directement consommable par applyInputTags().
//
// Utilisée par TicketDetail (réponse) et NewTicketPage (nouveau ticket).

const C = {
  rouge: '#DE2020',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  return '#' + adj(r).toString(16).padStart(2, '0') + adj(g).toString(16).padStart(2, '0') + adj(b).toString(16).padStart(2, '0');
}

// Valeur sentinelle du <select> produit pour basculer en saisie libre.
const OTHER = '__autre__';

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  border: `1px solid ${C.grisCL}`, borderRadius: 8,
  padding: '9px 11px', fontSize: 13, color: C.grisTF,
  fontFamily: 'Lato, sans-serif', background: C.blanc,
  outline: 'none',
};

export default function MacroInputsModal({ macroName, fields, products = [], onCancel, onSubmit }) {
  // Valeur courante de chaque champ, indexée par field.id.
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map(f => [f.id, '']))
  );
  // Champs `produit` basculés en saisie libre (option « Autre… »).
  const [freeText, setFreeText] = useState({});
  const firstRef = useRef();

  // Liste de produits dédupliquée (une commande peut contenir 2 lignes du même
  // article, et les bundles font apparaître leurs composants).
  const productOptions = useMemo(
    () => [...new Set((products || []).filter(p => p && String(p).trim()))],
    [products]
  );

  useEffect(() => {
    const t = setTimeout(() => firstRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);

  const setValue = (id, v) => setValues(prev => ({ ...prev, [id]: v }));

  // Tous les champs doivent être remplis : une macro appliquée à moitié part
  // chez le client avec un trou dans la phrase.
  const missing = fields.filter(f => !String(values[f.id] || '').trim());
  const canSubmit = missing.length === 0;

  const submit = () => {
    if (!canSubmit) return;
    // Les dates sont saisies au format ISO par <input type="date"> : on les
    // rend en toutes lettres, c'est du texte destiné au client.
    const answers = Object.fromEntries(fields.map(f => {
      const raw = String(values[f.id]).trim();
      const v = f.type === 'date' ? formatDate(raw, { time: false, monthLong: true }) : raw;
      return [f.id, v];
    }));
    onSubmit(answers);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    if (e.key === 'Enter' && canSubmit) { e.preventDefault(); submit(); }
  };

  const renderField = (f, i) => {
    const ref = i === 0 ? firstRef : undefined;

    if (f.type === 'produit' && productOptions.length > 0) {
      const isFree = !!freeText[f.id];
      return (
        <>
          <select
            ref={isFree ? undefined : ref}
            value={isFree ? OTHER : (values[f.id] || '')}
            onChange={e => {
              const v = e.target.value;
              if (v === OTHER) { setFreeText(p => ({ ...p, [f.id]: true })); setValue(f.id, ''); }
              else { setFreeText(p => ({ ...p, [f.id]: false })); setValue(f.id, v); }
            }}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="">— Choisir un produit —</option>
            {productOptions.map(p => <option key={p} value={p}>{p}</option>)}
            <option value={OTHER}>Autre… (saisie libre)</option>
          </select>
          {isFree && (
            <input
              autoFocus
              type="text"
              value={values[f.id] || ''}
              onChange={e => setValue(f.id, e.target.value)}
              placeholder="Nom du produit"
              style={{ ...inputStyle, marginTop: 6 }}
            />
          )}
        </>
      );
    }

    if (f.type === 'choix' && f.options.length > 0) {
      return (
        <select
          ref={ref}
          value={values[f.id] || ''}
          onChange={e => setValue(f.id, e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="">— Choisir —</option>
          {f.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }

    if (f.type === 'date') {
      return (
        <input
          ref={ref}
          type="date"
          value={values[f.id] || ''}
          onChange={e => setValue(f.id, e.target.value)}
          style={inputStyle}
        />
      );
    }

    // `texte`, et `produit` sans commande liée (ou commande sans articles).
    return (
      <input
        ref={ref}
        type="text"
        value={values[f.id] || ''}
        onChange={e => setValue(f.id, e.target.value)}
        placeholder={f.type === 'produit' ? 'Nom du produit' : 'Votre saisie…'}
        style={inputStyle}
      />
    );
  };

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,24,33,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          background: C.blanc, borderRadius: 14, width: 'min(460px, 94vw)',
          maxHeight: '86vh', overflowY: 'auto',
          boxShadow: '0 18px 50px rgba(0,0,0,0.3)', fontFamily: 'Lato, sans-serif', padding: 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>⚡</span>
          <strong style={{ fontSize: 15, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>
            Compléter la macro
          </strong>
        </div>
        <p style={{ fontSize: 12.5, color: C.grisM, lineHeight: 1.45, margin: '0 0 16px' }}>
          {macroName
            ? <>« {macroName} » — {fields.length > 1 ? 'ces informations sont' : 'cette information est'} à renseigner avant insertion.</>
            : <>{fields.length > 1 ? 'Ces informations sont' : 'Cette information est'} à renseigner avant insertion.</>}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {fields.map((f, i) => (
            <div key={f.id}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 700,
                color: C.grisF, marginBottom: 5,
              }}>{f.label}</label>
              {renderField(f, i)}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 20 }}>
          {!canSubmit && (
            <span style={{ fontSize: 11.5, color: C.rouge, marginRight: 'auto' }}>
              {missing.length > 1 ? `${missing.length} champs à remplir` : '1 champ à remplir'}
            </span>
          )}
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 8,
              padding: '8px 16px', fontSize: 13, fontWeight: 700, color: C.grisF,
              cursor: 'pointer', fontFamily: 'Lato, sans-serif',
            }}
          >Annuler</button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              background: canSubmit
                ? `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.2)})`
                : C.grisCL,
              border: 'none', borderRadius: 8, padding: '8px 16px',
              fontSize: 13, fontWeight: 800, color: canSubmit ? '#fff' : C.grisM,
              cursor: canSubmit ? 'pointer' : 'not-allowed', fontFamily: 'Lato, sans-serif',
            }}
          >Appliquer la macro</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
