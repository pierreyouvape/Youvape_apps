import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_URL, authHeaders, C } from '../pickingUi';

/**
 * Réglages du plugin WordPress `youvape-logistique`, celui qui remplacera les
 * écritures de BMS dans WooCommerce (statut d'expédition, suivi).
 *
 * Les réglages vivent dans WordPress : l'écran les lit et les modifie par
 * notre backend, qui seul détient les clés WooCommerce. On n'envoie que les
 * réglages modifiés (le plugin fait une mise à jour partielle) ; une seule
 * valeur refusée et le plugin n'enregistre rien.
 *
 * Seuls les réglages de l'expédition sont ici. La case « Restocker » de
 * l'écran de remboursement reste à sa valeur du plugin.
 */

// Explications tirées de youvape-logistique/AVANT-DE-MODIFIER.md §7.
const STATUS_LISTS = [
  {
    group: 'Expédition d\'un colis',
    items: [
      {
        key: 'ship_target_statuses',
        title: 'Statuts demandables',
        help: 'Statuts que l\'app peut demander au moment d\'expédier un colis (« Colis expédié », « Retrait boutique »…).',
      },
      {
        key: 'ship_from_statuses',
        title: 'Commandes qui changent de statut',
        help: 'Une commande dans un de ces statuts passe au statut demandé quand son colis est expédié.',
      },
      {
        key: 'ship_keep_statuses',
        title: 'Commandes déjà expédiées',
        help: 'Le colis est ajouté à la commande (2ᵉ colis, article oublié) mais son statut ne bouge pas. Aucun statut en commun avec la liste précédente.',
      },
    ],
  },
  {
    group: 'Changement de statut sans mail',
    intro: 'Nettoyage des commandes restées figées : le statut change, le client ne reçoit jamais de mail.',
    items: [
      {
        key: 'status_target_statuses',
        title: 'Statuts demandables',
        help: 'Statuts que l\'app peut poser sur une commande. Liste encore à décider.',
        warning: 'Passer en « Colis expédié » une vieille commande figée laisse le site la passer ensuite en « Livrée », ce qui crédite les points fidélité.',
      },
      {
        key: 'status_from_statuses',
        title: 'Statuts de départ acceptés',
        help: 'Le changement n\'est accepté que pour une commande dans un de ces statuts.',
      },
    ],
  },
];

const META_LABELS = {
  meta_keys: {
    carrier: 'Code transporteur',
    carrier_label: 'Libellé transporteur',
    tracking_number: 'N° de suivi',
    tracking_url: 'URL de suivi',
    shipped_at: 'Date d\'expédition',
    shipments: 'Liste de tous les colis (JSON)',
  },
  bms_meta_keys: {
    carrier: 'Transporteur (reçoit le libellé)',
    tracking_number: 'N° de suivi',
    tracking_link: 'Lien de suivi (HTML, selon le gabarit)',
  },
};

const FORBIDDEN_REASON = {
  cancelled: 'WooCommerce remet le stock d\'une commande annulée : ce passage ne doit jamais se faire en silence.',
  refunded: 'WooCommerce peut remettre le stock d\'une commande remboursée : ce passage ne doit jamais se faire en silence.',
  pending: 'Commande non payée.',
  failed: 'Commande non payée.',
  'checkout-draft': 'Panier abandonné, pas une commande.',
};
const forbiddenReason = (slug) => `Interdit par le plugin. ${FORBIDDEN_REASON[slug] || 'Ce n\'est pas une vraie commande.'}`;

const META_NAME = /^[A-Za-z0-9_-]{1,191}$/;
const NUMBERS = {
  batch_max: { min: 1, max: 200 },
  time_budget: { min: 5, max: 60 },
};

// Colis d'exemple pour l'aperçu du lien de suivi.
const SAMPLE = {
  url: 'https://www.mondialrelay.fr/suivi-de-colis/?ens=LGYOUVAP&exp=12345678&pays=FR&language=fr',
  number: '12345678',
  carrier: 'mondial_relay',
  carrier_label: 'Mondial Relay - Point Relais',
};

const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
// Proche de esc_url de WordPress : « & » devient « &#038; », les guillemets sont neutralisés.
const escUrl = (s) => String(s).replace(/&/g, '&#038;').replace(/"/g, '%22').replace(/'/g, '&#039;').replace(/</g, '%3C').replace(/>/g, '%3E');

const renderTemplate = (template) => String(template ?? '')
  .split('{url}').join(escUrl(SAMPLE.url))
  .split('{number}').join(escHtml(SAMPLE.number))
  .split('{carrier_label}').join(escHtml(SAMPLE.carrier_label))
  .split('{carrier}').join(escHtml(SAMPLE.carrier));

const stripWc = (slug) => (slug.startsWith('wc-') ? slug.slice(3) : slug);

/** Deux valeurs de réglage identiques ? Les listes de statuts se comparent comme des ensembles. */
const same = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every(x => b.includes(x));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(k => a[k] === b[k]);
  }
  return a === b;
};

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Erreurs visibles avant d'envoyer (le plugin revérifie tout). */
const validate = (draft) => {
  const errors = {};
  const overlap = (draft.ship_from_statuses || []).filter(s => (draft.ship_keep_statuses || []).includes(s));
  if (overlap.length) errors.overlap = overlap;
  for (const group of ['meta_keys', 'bms_meta_keys']) {
    for (const [sub, name] of Object.entries(draft[group] || {})) {
      if (!META_NAME.test(name)) errors[`${group}.${sub}`] = 'Lettres, chiffres, _ et - seulement (191 caractères au plus).';
    }
  }
  const names = Object.values(draft.meta_keys || {});
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  for (const [sub, name] of Object.entries(draft.meta_keys || {})) {
    if (dup.includes(name) && !errors[`meta_keys.${sub}`]) errors[`meta_keys.${sub}`] = 'Ce nom sert déjà à un autre usage.';
  }
  if (String(draft.bms_tracking_link_template ?? '').length > 1000) errors.bms_tracking_link_template = '1000 caractères au plus.';
  for (const [key, { min, max }] of Object.entries(NUMBERS)) {
    const n = Number(draft[key]);
    if (!Number.isInteger(n) || n < min || n > max) errors[key] = `Nombre entier entre ${min} et ${max}.`;
  }
  return errors;
};

// ── Petits éléments d'écran ─────────────────────────────────────────────────

const input = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13.5, boxSizing: 'border-box',
};
const btn = (primary, disabled) => ({
  padding: '8px 14px', borderRadius: 8, fontSize: 13.5, fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
  border: primary ? 'none' : `1px solid ${C.greyB}`, background: primary ? C.violet : C.white,
  color: primary ? C.white : C.dark,
});

const Box = ({ kind, children }) => {
  const colors = {
    error: [C.redL, C.red], warn: [C.amberL, C.amber], ok: [C.greenL, C.green], info: [C.blueL, C.blue],
  }[kind];
  return (
    <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13.5, background: colors[0], color: colors[1], marginBottom: 14 }}>
      {children}
    </div>
  );
};

const Pill = ({ label, value, kind = 'neutral', title }) => {
  const colors = {
    ok: [C.greenL, C.green], warn: [C.amberL, C.amber], bad: [C.redL, C.red], neutral: [C.grey, C.dark],
  }[kind];
  return (
    <div title={title} style={{
      padding: '8px 12px', borderRadius: 10, background: colors[0], border: `1px solid ${C.greyB}`, minWidth: 120,
    }}>
      <div style={{ fontSize: 11.5, color: C.greyT, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: colors[1] }}>{value}</div>
    </div>
  );
};

const yesNo = (v) => (v === null || v === undefined ? 'Inconnu' : v ? 'Oui' : 'Non');

/** Un réglage : titre, explication, repère « modifié », retour au défaut. */
const Setting = ({ title, help, warning, changed, isDefault, onReset, canEdit, children }) => (
  <div style={{ padding: '14px 0', borderTop: `1px solid ${C.greyB}` }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
      <strong style={{ fontSize: 14, color: C.dark }}>{title}</strong>
      {changed && (
        <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, background: C.accentL, padding: '1px 7px', borderRadius: 999 }}>
          modifié
        </span>
      )}
      {canEdit && !isDefault && (
        <button onClick={onReset} style={{
          marginLeft: 'auto', border: 'none', background: 'none', padding: 0, cursor: 'pointer',
          color: C.violet, fontSize: 12.5, fontWeight: 600,
        }}>Revenir au défaut</button>
      )}
    </div>
    <div style={{ fontSize: 12.5, color: C.greyT, marginBottom: warning ? 4 : 10 }}>{help}</div>
    {warning && <div style={{ fontSize: 12.5, color: C.amber, marginBottom: 10 }}>⚠️ {warning}</div>}
    {children}
  </div>
);

const Toggle = ({ checked, onChange, disabled, label }) => (
  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: disabled ? 'default' : 'pointer', fontSize: 13.5 }}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} style={{ width: 16, height: 16 }} />
    {label}
  </label>
);

/** Choix multiple parmi les statuts du site ; les statuts interdits sont visibles mais grisés. */
const StatusPicker = ({ value, onChange, registered, forbidden, conflicts, disabled }) => {
  const options = Object.entries(registered).map(([slug, label]) => ({ slug: stripWc(slug), label }));
  // Un statut retenu mais inconnu du site reste affiché : il serait refusé à l'usage.
  const unknown = value.filter(s => !options.some(o => o.slug === s));
  const toggle = (slug) => onChange(value.includes(slug) ? value.filter(s => s !== slug) : [...value, slug]);

  const chip = (slug, label, { isForbidden = false, isUnknown = false } = {}) => {
    const on = value.includes(slug);
    const conflict = on && conflicts.includes(slug);
    const locked = disabled || (isForbidden && !on);
    return (
      <label
        key={slug}
        title={isForbidden ? forbiddenReason(slug) : isUnknown ? 'Ce statut n\'est pas enregistré sur le site : il sera refusé tant qu\'il ne l\'est pas.' : undefined}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 8, fontSize: 13,
          border: `1px solid ${conflict ? C.red : on ? C.violet : C.greyB}`,
          background: conflict ? C.redL : on ? C.violetL : isForbidden ? C.grey : C.white,
          color: isForbidden ? C.greyM : C.dark,
          cursor: locked ? 'default' : 'pointer',
        }}
      >
        <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(slug)} />
        <span>{label}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: C.greyM }}>{slug}</span>
        {isForbidden && <span style={{ fontSize: 11, fontWeight: 700 }}>interdit</span>}
        {isUnknown && <span style={{ fontSize: 11, fontWeight: 700, color: C.amber }}>non enregistré sur le site</span>}
      </label>
    );
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(o => chip(o.slug, o.label, { isForbidden: forbidden.includes(o.slug) }))}
      {unknown.map(s => chip(s, s, { isUnknown: true, isForbidden: forbidden.includes(s) }))}
    </div>
  );
};

const MetaFields = ({ group, value, onChange, errors, disabled }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
    {Object.entries(META_LABELS[group]).map(([sub, label]) => {
      const err = errors[`${group}.${sub}`];
      return (
        <label key={sub} style={{ fontSize: 12.5, fontWeight: 600, color: C.dark }}>
          {label}
          <input
            value={value[sub] ?? ''}
            disabled={disabled}
            onChange={e => onChange({ ...value, [sub]: e.target.value })}
            style={{ ...input, width: '100%', marginTop: 4, fontFamily: 'monospace', borderColor: err ? C.red : C.greyB }}
          />
          {err && <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, fontWeight: 500, color: C.red }}>{err}</span>}
        </label>
      );
    })}
  </div>
);

// ── Section ─────────────────────────────────────────────────────────────────

export default function PluginLogistiqueSection({ token, canEdit }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { data: d } = await axios.get(`${API_URL}/picking/plugin-logistique`, authHeaders(token));
      setData(d);
      setDraft(d.installed ? clone(d.settings) : null);
    } catch (err) {
      setLoadError(err.response?.data?.error || err.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const changedKeys = useMemo(() => {
    if (!data?.installed || !draft) return [];
    return Object.keys(draft).filter(k => k in data.settings && !same(draft[k], data.settings[k]));
  }, [data, draft]);
  const errors = useMemo(() => (draft ? validate(draft) : {}), [draft]);
  const hasErrors = Object.keys(errors).length > 0;

  // Quitter la page avec des modifications non enregistrées : le navigateur demande confirmation.
  useEffect(() => {
    if (!changedKeys.length) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changedKeys.length]);

  const set = (key, value) => { setDraft(d => ({ ...d, [key]: value })); setResult(null); };
  const reset = (key) => set(key, clone(data.defaults[key]));
  const props = (key) => ({
    changed: changedKeys.includes(key),
    isDefault: draft && same(draft[key], data.defaults[key]),
    onReset: () => reset(key),
    canEdit,
  });

  const save = async () => {
    const patch = {};
    for (const k of changedKeys) patch[k] = k in NUMBERS ? Number(draft[k]) : draft[k];
    setSaving(true);
    setResult(null);
    try {
      const { data: r } = await axios.post(`${API_URL}/picking/plugin-logistique/settings`, patch, authHeaders(token));
      setData(d => ({ ...d, settings: r.settings }));
      setDraft(clone(r.settings));
      setResult({ kind: 'ok', warnings: r.warnings || [] });
    } catch (err) {
      const body = err.response?.data;
      if (body?.code === 'PLUGIN_ABSENT') {
        load();
        return;
      }
      setResult({ kind: 'error', text: body?.error || err.message, errors: body?.errors || [] });
    } finally {
      setSaving(false);
    }
  };

  const status = data?.status;
  const preview = draft ? renderTemplate(draft.bms_tracking_link_template) : '';

  return (
    <section style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: C.primary }}>Plugin WooCommerce — Logistique</h2>
        {data?.site?.host && (
          <span style={{ fontSize: 12.5, color: C.greyT }}>Site : <strong style={{ color: C.dark }}>{data.site.host}</strong></span>
        )}
        <button onClick={load} style={{ ...btn(false), marginLeft: 'auto', padding: '5px 10px', fontSize: 12.5 }}>Actualiser</button>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: C.greyT }}>
        Ce qui remplacera les écritures de BMS dans WooCommerce : statut d&apos;expédition et suivi des colis.
        Les réglages sont enregistrés sur le site, pas dans l&apos;app.
      </p>

      {loadError && <Box kind="error">Impossible de lire le plugin : {loadError}</Box>}
      {!data && !loadError && <div style={{ color: C.greyT, fontSize: 13.5 }}>Chargement…</div>}

      {data && !data.installed && (
        <Box kind="info">
          <strong>Plugin non installé ou pas encore activé sur le site.</strong>{' '}
          C&apos;est normal jusqu&apos;à la sortie de BMS : le plugin sera activé ce jour-là, et ses réglages
          se feront ici.
        </Box>
      )}

      {data?.installed && status && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
          <Pill label="Plugin" value={`${status.version}${status.db_version ? ` · base ${status.db_version}` : ''}`} />
          <Pill label="WooCommerce" value={status.woocommerce_version || 'Inconnue'} />
          <Pill
            label="Packs (woosb)"
            value={status.woosb_active ? status.woosb_version || 'Actif' : 'Inactif'}
            kind={status.woosb_active ? 'neutral' : 'warn'}
            title={status.woosb_active ? undefined : 'Sans woosb, les packs seraient lus comme des produits simples (le plugin les refuse quand même).'}
          />
          <Pill
            label="Tables du plugin"
            value={status.tables_ready ? 'Prêtes' : 'Absentes'}
            kind={status.tables_ready ? 'ok' : 'bad'}
            title={status.tables_ready ? undefined : 'Désactiver puis réactiver le plugin dans l\'admin WordPress.'}
          />
          <Pill
            label="Gestion du stock"
            value={yesNo(status.stock_management_enabled)}
            kind={status.stock_management_enabled ? 'ok' : 'bad'}
          />
          <Pill
            label="HPOS"
            value={`${yesNo(status.hpos_enabled)}${status.hpos_sync_enabled ? ' (synchro active)' : ''}`}
          />
          <Pill
            label="Mails différés"
            value={yesNo(status.deferred_emails)}
            title="Envoi des mails WooCommerce en file d'attente. Le plugin bloque les deux modes quand un envoi est sans mail."
          />
        </div>
      )}

      {data?.installed && draft && (
        <>
          {!canEdit && <Box kind="info">Lecture seule : l&apos;enregistrement de ces réglages est réservé aux admins.</Box>}

          {STATUS_LISTS.map(g => (
            <div key={g.group} style={{ marginBottom: 10 }}>
              <h3 style={{ margin: '14px 0 2px', fontSize: 15, color: C.primary }}>{g.group}</h3>
              {g.intro && <div style={{ fontSize: 12.5, color: C.greyT, marginBottom: 4 }}>{g.intro}</div>}
              {g.items.map(item => {
                const isShipPair = item.key === 'ship_from_statuses' || item.key === 'ship_keep_statuses';
                const conflicts = isShipPair ? errors.overlap || [] : [];
                return (
                  <Setting key={item.key} title={item.title} help={item.help} warning={item.warning} {...props(item.key)}>
                    <StatusPicker
                      value={draft[item.key]}
                      onChange={v => set(item.key, v)}
                      registered={data.registered_statuses}
                      forbidden={data.forbidden_statuses}
                      conflicts={conflicts}
                      disabled={!canEdit}
                    />
                    {conflicts.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 12.5, color: C.red }}>
                        En commun avec « {item.key === 'ship_from_statuses' ? 'Commandes déjà expédiées' : 'Commandes qui changent de statut'} » :{' '}
                        <strong>{conflicts.join(', ')}</strong>. Une commande ne peut pas à la fois changer de statut et le garder.
                      </div>
                    )}
                  </Setting>
                );
              })}
            </div>
          ))}

          <h3 style={{ margin: '14px 0 2px', fontSize: 15, color: C.primary }}>Suivi écrit sur la commande</h3>
          <Setting
            title="Métas de suivi"
            help="Écrites sur la commande à chaque colis : le dernier colis fait foi, la liste garde tous les colis. Noms pas encore validés par l'agence."
            {...props('meta_keys')}
          >
            <MetaFields group="meta_keys" value={draft.meta_keys} onChange={v => set('meta_keys', v)} errors={errors} disabled={!canEdit} />
          </Setting>
          <Setting
            title="Métas historiques (bms_*)"
            help="Lues aujourd'hui par le site : suivi affiché au client, passage automatique en « Livrée ». À écrire tant que le site les lit."
            {...props('write_bms_meta')}
          >
            <Toggle
              checked={draft.write_bms_meta}
              onChange={v => set('write_bms_meta', v)}
              disabled={!canEdit}
              label="Écrire aussi les métas historiques"
            />
          </Setting>
          <Setting
            title="Noms des métas historiques"
            help="Le transporteur reçoit le libellé exact du transporteur, comme BMS l'écrivait."
            {...props('bms_meta_keys')}
          >
            <MetaFields group="bms_meta_keys" value={draft.bms_meta_keys} onChange={v => set('bms_meta_keys', v)} errors={errors} disabled={!canEdit || !draft.write_bms_meta} />
          </Setting>
          <Setting
            title="Gabarit du lien de suivi"
            help="Contenu de la méta « lien de suivi ». Les valeurs sont échappées par le plugin, et la méta reste vide quand le colis n'a pas d'URL de suivi."
            {...props('bms_tracking_link_template')}
          >
            <textarea
              value={draft.bms_tracking_link_template}
              disabled={!canEdit}
              onChange={e => set('bms_tracking_link_template', e.target.value)}
              rows={2}
              style={{
                ...input, width: '100%', fontFamily: 'monospace', resize: 'vertical',
                borderColor: errors.bms_tracking_link_template ? C.red : C.greyB,
              }}
            />
            {errors.bms_tracking_link_template && <div style={{ fontSize: 11.5, color: C.red }}>{errors.bms_tracking_link_template}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '6px 0 10px', fontSize: 12.5, color: C.greyT }}>
              Variables :
              {['{url}', '{number}', '{carrier}', '{carrier_label}'].map(v => (
                <button
                  key={v}
                  disabled={!canEdit}
                  onClick={() => set('bms_tracking_link_template', `${draft.bms_tracking_link_template}${v}`)}
                  title="Ajouter à la fin du gabarit"
                  style={{
                    fontFamily: 'monospace', fontSize: 12, padding: '2px 8px', borderRadius: 6,
                    border: `1px solid ${C.greyB}`, background: C.grey, cursor: canEdit ? 'pointer' : 'default',
                  }}
                >{v}</button>
              ))}
            </div>
            <div style={{ border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12, background: C.grey }}>
              <div style={{ fontSize: 12, color: C.greyT, marginBottom: 6 }}>
                Aperçu pour un colis {SAMPLE.carrier_label} n° {SAMPLE.number}
              </div>
              <code style={{ display: 'block', fontSize: 12, wordBreak: 'break-all', color: C.dark, marginBottom: 8 }}>
                {preview || '(vide)'}
              </code>
              {/* sandbox sans aucune permission : un brouillon ne peut exécuter aucun script. */}
              <iframe
                title="Rendu du lien de suivi"
                sandbox=""
                srcDoc={`<body style="margin:0;font:14px system-ui,sans-serif">${preview}</body>`}
                style={{ width: '100%', height: 34, border: 'none', background: C.white, borderRadius: 6 }}
              />
            </div>
          </Setting>

          <h3 style={{ margin: '14px 0 2px', fontSize: 15, color: C.primary }}>Taille des envois</h3>
          <Setting
            title="Lignes par requête"
            help="Nombre maximal de lignes (colis, mouvements de stock) dans un appel au plugin, de 1 à 200."
            {...props('batch_max')}
          >
            <NumberField value={draft.batch_max} onChange={v => set('batch_max', v)} error={errors.batch_max} disabled={!canEdit} unit="lignes" />
          </Setting>
          <Setting
            title="Temps maximal par requête"
            help="Au-delà, les lignes restantes reviennent sans avoir été traitées et l'app les renvoie. De 5 à 60 secondes."
            {...props('time_budget')}
          >
            <NumberField value={draft.time_budget} onChange={v => set('time_budget', v)} error={errors.time_budget} disabled={!canEdit} unit="secondes" />
          </Setting>

          {result?.kind === 'error' && (
            <Box kind="error">
              <strong>{result.text}</strong>
              {result.errors.length > 0 && (
                <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {result.errors.map(e => <li key={e}>{e}</li>)}
                </ul>
              )}
            </Box>
          )}
          {result?.kind === 'ok' && (
            result.warnings.length > 0 ? (
              <Box kind="warn">
                <strong>Réglages enregistrés, avec des avertissements :</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {result.warnings.map(w => <li key={w}>{w}</li>)}
                </ul>
              </Box>
            ) : <Box kind="ok">Réglages enregistrés sur le site.</Box>
          )}

          {canEdit && (
            <div style={{
              position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end',
              padding: '12px 0 0', background: C.white, borderTop: `1px solid ${C.greyB}`,
            }}>
              {hasErrors && changedKeys.length > 0 && (
                <span style={{ fontSize: 12.5, color: C.red, marginRight: 'auto' }}>Corriger les erreurs en rouge avant d&apos;enregistrer.</span>
              )}
              <button
                onClick={() => { setDraft(clone(data.settings)); setResult(null); }}
                disabled={!changedKeys.length || saving}
                style={btn(false, !changedKeys.length || saving)}
              >Annuler les modifications</button>
              <button
                onClick={save}
                disabled={!changedKeys.length || hasErrors || saving}
                style={btn(true, !changedKeys.length || hasErrors || saving)}
              >{saving ? 'Enregistrement…' : `Enregistrer${changedKeys.length ? ` (${changedKeys.length})` : ''}`}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NumberField({ value, onChange, error, disabled, unit }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        style={{ ...input, width: 110, borderColor: error ? C.red : C.greyB }}
      />
      <span style={{ fontSize: 13, color: C.greyT }}>{unit}</span>
      {error && <span style={{ fontSize: 11.5, color: C.red }}>{error}</span>}
    </div>
  );
}
