import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_URL, authHeaders, C } from '../picking/pickingUi';

/**
 * Réglages du plugin WordPress `youvape-logistique`, celui qui remplacera les
 * écritures de BMS dans WooCommerce (statut d'expédition, suivi).
 *
 * Les réglages vivent dans WordPress : l'écran les lit et les modifie par
 * notre backend, qui seul détient les clés WooCommerce. On n'envoie que les
 * réglages modifiés (le plugin fait une mise à jour partielle) ; une seule
 * valeur refusée et le plugin n'enregistre rien.
 *
 * Seuls les réglages de l'expédition sont ici. L'onglet est réservé aux admins,
 * et le backend l'exige aussi.
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
    group: 'Changement de statut',
    intro: 'Statuts posés par l\'app sur une commande (livraison, nettoyage des commandes figées). Chaque changement dit si le client est prévenu : sans mail, le plugin bloque aussi Probance et Guaranteed Reviews, les prestataires actuels du site.',
    items: [
      {
        key: 'status_target_statuses',
        title: 'Statuts demandables',
        help: 'Statuts que l\'app peut poser sur une commande.',
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
  carrier: 'Code transporteur',
  carrier_label: 'Libellé transporteur',
  tracking_number: 'N° de suivi',
  tracking_url: 'URL de suivi',
  shipped_at: 'Date d\'expédition',
  shipments: 'Liste de tous les colis (JSON)',
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
  for (const [sub, name] of Object.entries(draft.meta_keys || {})) {
    if (!META_NAME.test(name)) errors[`meta_keys.${sub}`] = 'Lettres, chiffres, _ et - seulement (191 caractères au plus).';
  }
  const names = Object.values(draft.meta_keys || {});
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  for (const [sub, name] of Object.entries(draft.meta_keys || {})) {
    if (dup.includes(name) && !errors[`meta_keys.${sub}`]) errors[`meta_keys.${sub}`] = 'Ce nom sert déjà à un autre usage.';
  }
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
const Setting = ({ title, help, warning, changed, isDefault, onReset, children }) => (
  <div style={{ padding: '14px 0', borderTop: `1px solid ${C.greyB}` }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
      <strong style={{ fontSize: 14, color: C.dark }}>{title}</strong>
      {changed && (
        <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, background: C.accentL, padding: '1px 7px', borderRadius: 999 }}>
          modifié
        </span>
      )}
      {!isDefault && (
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

/** Choix multiple parmi les statuts du site ; les statuts interdits sont visibles mais grisés. */
const StatusPicker = ({ value, onChange, registered, forbidden, conflicts }) => {
  const options = Object.entries(registered).map(([slug, label]) => ({ slug: stripWc(slug), label }));
  // Un statut retenu mais inconnu du site reste affiché : il serait refusé à l'usage.
  const unknown = value.filter(s => !options.some(o => o.slug === s));
  const toggle = (slug) => onChange(value.includes(slug) ? value.filter(s => s !== slug) : [...value, slug]);

  const chip = (slug, label, { isForbidden = false, isUnknown = false } = {}) => {
    const on = value.includes(slug);
    const conflict = on && conflicts.includes(slug);
    const locked = isForbidden && !on;
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

const MetaFields = ({ value, onChange, errors }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
    {Object.entries(META_LABELS).map(([sub, label]) => {
      const err = errors[`meta_keys.${sub}`];
      return (
        <label key={sub} style={{ fontSize: 12.5, fontWeight: 600, color: C.dark }}>
          {label}
          <input
            value={value[sub] ?? ''}
            onChange={e => onChange({ ...value, [sub]: e.target.value })}
            style={{ ...input, width: '100%', marginTop: 4, fontFamily: 'monospace', borderColor: err ? C.red : C.greyB }}
          />
          {err && <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, fontWeight: 500, color: C.red }}>{err}</span>}
        </label>
      );
    })}
  </div>
);

const emptyForm = (conn) => ({
  url: conn.url, consumer_key: '', consumer_secret: '', htaccess_user: conn.htaccess_user, htaccess_password: '',
});

/** Le site visé. Les secrets ne reviennent jamais du backend : vide = valeur gardée. */
const ConnectionForm = ({ token, connection, onSaved }) => {
  const [form, setForm] = useState(() => emptyForm(connection));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);
  const urlChanged = !!connection.url && form.url.trim().replace(/\/+$/, '') !== connection.url;

  useEffect(() => { setForm(emptyForm(connection)); }, [connection]);

  const hint = (isSet) => (isSet && !urlChanged ? 'Enregistré : laisser vide pour le garder' : '');
  const field = (key, label, { secret = false, isSet = false, placeholder } = {}) => (
    <label style={{ fontSize: 12.5, fontWeight: 600, color: C.dark }}>
      {label}
      <input
        type={secret ? 'password' : 'text'}
        autoComplete={secret ? 'new-password' : 'off'}
        value={form[key]}
        placeholder={placeholder ?? hint(isSet)}
        onChange={e => { setForm(f => ({ ...f, [key]: e.target.value })); setFailure(null); }}
        style={{ ...input, width: '100%', marginTop: 4, fontFamily: 'monospace' }}
      />
    </label>
  );

  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await axios.put(`${API_URL}/plugin-logistique/connection`, form, authHeaders(token));
      onSaved();
    } catch (err) {
      const body = err.response?.data;
      setFailure({ text: body?.error || err.message, errors: body?.errors || [] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ margin: '14px 0 2px', fontSize: 15, color: C.primary }}>Connexion au site</h3>
      <div style={{ fontSize: 12.5, color: C.greyT, marginBottom: 10 }}>
        Le site visé par ce plugin : prod ou copie de test. Les clés WooCommerce sont celles de ce site.
        Les points fidélité et la synchronisation gardent leur propre connexion.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, marginBottom: 10 }}>
        {field('url', 'Adresse du site', { placeholder: 'https://…' })}
        {field('consumer_key', 'Clé WooCommerce', { secret: true, isSet: connection.consumer_key_set })}
        {field('consumer_secret', 'Secret WooCommerce', { secret: true, isSet: connection.consumer_secret_set })}
        {field('htaccess_user', 'Identifiant du site (si protégé par mot de passe)', { placeholder: '' })}
        {field('htaccess_password', 'Mot de passe du site', { secret: true, isSet: connection.htaccess_password_set })}
      </div>
      {urlChanged && <Box kind="warn">L&apos;adresse change : ressaisir la clé et le secret de ce site, ainsi que son mot de passe s&apos;il en a un.</Box>}
      {failure && (
        <Box kind="error">
          <strong>{failure.text}</strong>
          {failure.errors.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {failure.errors.map(e => <li key={e}>{e}</li>)}
            </ul>
          )}
        </Box>
      )}
      <button onClick={save} disabled={saving} style={btn(true, saving)}>
        {saving ? 'Enregistrement…' : 'Enregistrer la connexion'}
      </button>
    </div>
  );
};

// ── Section ─────────────────────────────────────────────────────────────────

export default function PluginLogistiqueSection({ token }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { data: d } = await axios.get(`${API_URL}/plugin-logistique`, authHeaders(token));
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
  });

  const save = async () => {
    const patch = {};
    for (const k of changedKeys) patch[k] = k in NUMBERS ? Number(draft[k]) : draft[k];
    setSaving(true);
    setResult(null);
    try {
      const { data: r } = await axios.post(`${API_URL}/plugin-logistique/settings`, patch, authHeaders(token));
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

  return (
    <section style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: C.primary }}>Plugin WooCommerce — Logistique</h2>
        {data?.connection?.host && (
          <span style={{ fontSize: 12.5, color: C.greyT }}>Site : <strong style={{ color: C.dark }}>{data.connection.host}</strong></span>
        )}
        <button onClick={load} style={{ ...btn(false), marginLeft: 'auto', padding: '5px 10px', fontSize: 12.5 }}>Actualiser</button>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: C.greyT }}>
        Ce qui remplacera les écritures de BMS dans WooCommerce : statut d&apos;expédition et suivi des colis.
        Les réglages sont enregistrés sur le site, pas dans l&apos;app.
      </p>

      {loadError && <Box kind="error">Impossible de lire le plugin : {loadError}</Box>}
      {!data && !loadError && <div style={{ color: C.greyT, fontSize: 13.5 }}>Chargement…</div>}

      {data && <ConnectionForm token={token} connection={data.connection} onSaved={load} />}

      {data?.site_error && <Box kind="error">Impossible de lire le plugin sur ce site : {data.site_error}</Box>}

      {data && !data.connection.configured && (
        <Box kind="info">Renseigner la connexion pour lire les réglages du plugin.</Box>
      )}

      {data?.connection.configured && !data.installed && !data.site_error && (
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
          {STATUS_LISTS.map(g => (
            <div key={g.group} style={{ marginBottom: 10 }}>
              <h3 style={{ margin: '14px 0 2px', fontSize: 15, color: C.primary }}>{g.group}</h3>
              {g.intro && <div style={{ fontSize: 12.5, color: C.greyT, marginBottom: 4 }}>{g.intro}</div>}
              {g.items.map(item => {
                const isShipPair = item.key === 'ship_from_statuses' || item.key === 'ship_keep_statuses';
                const conflicts = isShipPair ? errors.overlap || [] : [];
                return (
                  <Setting key={item.key} title={item.title} help={item.help} {...props(item.key)}>
                    <StatusPicker
                      value={draft[item.key]}
                      onChange={v => set(item.key, v)}
                      registered={data.registered_statuses}
                      forbidden={data.forbidden_statuses}
                      conflicts={conflicts}
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
            help="Écrites sur la commande à chaque colis : le dernier colis fait foi, la liste garde tous les colis. L'URL est le lien complet, construit par l'app. Noms pas encore validés par l'agence."
            warning="yousync et le rattrapage des commandes lisent le libellé transporteur et le n° de suivi sous leurs noms actuels, écrits en dur : les renommer viderait le transporteur et le suivi dans l'app."
            {...props('meta_keys')}
          >
            <MetaFields value={draft.meta_keys} onChange={v => set('meta_keys', v)} errors={errors} />
          </Setting>

          <h3 style={{ margin: '14px 0 2px', fontSize: 15, color: C.primary }}>Taille des envois</h3>
          <Setting
            title="Lignes par requête"
            help="Nombre maximal de lignes (colis, mouvements de stock) dans un appel au plugin, de 1 à 200."
            {...props('batch_max')}
          >
            <NumberField value={draft.batch_max} onChange={v => set('batch_max', v)} error={errors.batch_max} unit="lignes" />
          </Setting>
          <Setting
            title="Temps maximal par requête"
            help="Au-delà, les lignes restantes reviennent sans avoir été traitées et l'app les renvoie. De 5 à 60 secondes."
            {...props('time_budget')}
          >
            <NumberField value={draft.time_budget} onChange={v => set('time_budget', v)} error={errors.time_budget} unit="secondes" />
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
        </>
      )}
    </section>
  );
}

function NumberField({ value, onChange, error, unit }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        style={{ ...input, width: 110, borderColor: error ? C.red : C.greyB }}
      />
      <span style={{ fontSize: 13, color: C.greyT }}>{unit}</span>
      {error && <span style={{ fontSize: 11.5, color: C.red }}>{error}</span>}
    </div>
  );
}
