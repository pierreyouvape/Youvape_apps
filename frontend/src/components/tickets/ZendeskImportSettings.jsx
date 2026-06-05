import { useState, useEffect, useCallback } from 'react';
import { TICKETS_COLOR } from './ticketConstants';
import { useTicketStatuses, invalidateStatusCache } from './useTicketStatuses';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

const API = '/api/sav/zendesk';

// Valeur sentinelle dans le <select> de mapping
const CREATE_AS_IS = '__create_as_is__';
const CREATE_CUSTOM = '__create_custom__';

// ─── Badge statut ─────────────────────────────────────────────────────────────
function StatusBadge({ label, bg, text }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', background: bg, color: text, borderRadius: 99, padding: '3px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

// ─── Section : champ de saisie ────────────────────────────────────────────────
function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.grisM, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 12px', border: `1px solid ${C.grisCL}`, borderRadius: 7,
  fontSize: 13.5, fontFamily: 'Lato, sans-serif', color: C.grisTF, outline: 'none', boxSizing: 'border-box',
};

const btnPrimary = (disabled) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 7,
  border: 'none', background: disabled ? C.grisM : TICKETS_COLOR, color: '#fff', fontSize: 13,
  fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
});

const btnGhost = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 7,
  border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisF, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

// ═══════════════════════════════════════════════════════════════════════════════
export default function ZendeskImportSettings() {
  const { statuses } = useTicketStatuses();

  // ── Connexion ──
  const [subdomain, setSubdomain] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, msg }

  // ── Matching des statuts ──
  const [zStatuses, setZStatuses] = useState(null); // [{ value, label, count }]
  const [mapping, setMapping] = useState({});        // zendesk_value -> choix (app value | sentinelle)
  const [customLabels, setCustomLabels] = useState({}); // zendesk_value -> label custom (si CREATE_CUSTOM)
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [savingMap, setSavingMap] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // ── Import ──
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null); // { total, done, created, updated, errors }
  const [importDone, setImportDone] = useState(null);
  const [importError, setImportError] = useState('');

  // ── Charger la config ──
  useEffect(() => {
    fetch(`${API}/config`).then(r => r.json()).then(data => {
      if (data.success) {
        setSubdomain(data.subdomain || '');
        setEmail(data.email || '');
        setHasToken(!!data.hasToken);
      }
    }).catch(() => {});
  }, []);

  // ── Sauvegarder la config ──
  const saveConfig = useCallback(async () => {
    setSavingCfg(true); setTestResult(null);
    try {
      const res = await fetch(`${API}/config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, email, token }), // token vide = inchangé côté serveur
      });
      const data = await res.json();
      if (data.success) {
        if (token) { setHasToken(true); setToken(''); }
      }
    } finally { setSavingCfg(false); }
  }, [subdomain, email, token]);

  // ── Tester la connexion ──
  const testConnection = useCallback(async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(`${API}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, email, token }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ ok: true, msg: `Connecté en tant que ${data.user?.name || data.user?.email || 'utilisateur'}` });
      } else {
        setTestResult({ ok: false, msg: data.error || 'Échec de connexion' });
      }
    } catch (err) {
      setTestResult({ ok: false, msg: err.message });
    } finally { setTesting(false); }
  }, [subdomain, email, token]);

  // ── Analyser les statuts Zendesk ──
  const analyzeStatuses = useCallback(async () => {
    setLoadingStatuses(true); setStatusMsg(''); setZStatuses(null);
    try {
      const res = await fetch(`${API}/preview-statuses`);
      const data = await res.json();
      if (!data.success) { setStatusMsg(data.error || 'Erreur'); return; }
      setZStatuses(data.statuses);
      // Pré-remplir le mapping avec l'existant en base
      const init = {};
      for (const s of data.statuses) {
        init[s.value] = data.map[s.value] || ''; // '' = à choisir
      }
      setMapping(init);
    } catch (err) {
      setStatusMsg(err.message);
    } finally { setLoadingStatuses(false); }
  }, []);

  // ── Enregistrer le mapping (crée les statuts si nécessaire) ──
  const saveMapping = useCallback(async () => {
    setSavingMap(true); setStatusMsg('');
    try {
      const entries = [];
      for (const zs of zStatuses) {
        let choice = mapping[zs.value];
        if (!choice) continue; // non mappé → on saute

        // Création de statut si demandé
        if (choice === CREATE_AS_IS || choice === CREATE_CUSTOM) {
          const label = choice === CREATE_AS_IS ? zs.label : (customLabels[zs.value] || zs.label);
          const value = label.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_éàèùâêîôûäëïöü-]/g, '');
          // Créer le statut côté app (ignore si déjà existant via erreur unique)
          const cr = await fetch('/api/sav/statuses', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value, label, bg_color: '#F0F0F0', text_color: '#626E85' }),
          });
          const crData = await cr.json();
          // value final : celui retourné, ou celui calculé si déjà existant
          choice = crData.success ? crData.status.value : value;
          invalidateStatusCache();
        }
        entries.push({ zendesk_value: zs.value, app_status: choice });
      }
      const res = await fetch(`${API}/status-map`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg('✓ Mapping enregistré');
        // Recharger pour refléter les nouveaux statuts dans les selects
        await analyzeStatuses();
      } else {
        setStatusMsg(data.error || 'Erreur enregistrement');
      }
    } catch (err) {
      setStatusMsg(err.message);
    } finally { setSavingMap(false); }
  }, [zStatuses, mapping, customLabels, analyzeStatuses]);

  // Tous les statuts Zendesk ont-ils un choix ?
  const allMapped = zStatuses && zStatuses.every(s => !!mapping[s.value]);

  // ── Lancer l'import (SSE) ──
  const startImport = useCallback(() => {
    setImporting(true); setProgress(null); setImportDone(null); setImportError('');
    const es = new EventSource(`${API}/import`);
    es.addEventListener('progress', (e) => setProgress(JSON.parse(e.data)));
    es.addEventListener('done', (e) => {
      setImportDone(JSON.parse(e.data));
      setImporting(false);
      es.close();
    });
    es.addEventListener('error', (e) => {
      // Erreur applicative envoyée par le serveur
      try { const d = JSON.parse(e.data); setImportError(d.error || 'Erreur import'); }
      catch { setImportError('Connexion interrompue'); }
      setImporting(false);
      es.close();
    });
  }, []);

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : null;

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div>
      <div style={{ background: `linear-gradient(135deg, ${TICKETS_COLOR}10 0%, ${TICKETS_COLOR}04 100%)`, border: `1px solid ${TICKETS_COLOR}30`, borderRadius: 10, padding: '14px 18px', marginBottom: 24, fontSize: 13, color: C.grisF, lineHeight: 1.6 }}>
        <strong style={{ color: C.grisTF }}>Importation Zendesk</strong> — Connectez votre compte Zendesk pour importer vos tickets (statuts, messages, clients) dans le SAV. Les identifiants sont conservés jusqu'à modification. Un réimport met à jour les tickets déjà importés sans créer de doublon.
      </div>

      {/* ─── 1. Connexion ─── */}
      <section style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10, padding: 18, marginBottom: 20 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.grisTF, marginBottom: 14 }}>1 · Connexion</div>

        <Field label="Sous-domaine Zendesk" hint="La partie avant .zendesk.com — ex. « youvape » pour youvape.zendesk.com">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input value={subdomain} onChange={e => setSubdomain(e.target.value)} placeholder="youvape" style={{ ...inputStyle, width: 200 }} />
            <span style={{ fontSize: 13, color: C.grisM }}>.zendesk.com</span>
          </div>
        </Field>

        <Field label="Email du compte agent">
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="agent@youvape.fr" style={inputStyle} />
        </Field>

        <Field label="API Token" hint={hasToken ? 'Un token est déjà enregistré (masqué). Laissez vide pour le conserver, ou saisissez-en un nouveau.' : 'Généré dans Zendesk → Admin → API → Token access.'}>
          <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={hasToken ? '•••••••••••• (inchangé)' : 'Votre API token'} style={inputStyle} />
        </Field>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <button onClick={saveConfig} disabled={savingCfg} style={btnPrimary(savingCfg)}>
            {savingCfg ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button onClick={testConnection} disabled={testing} style={btnGhost}>
            {testing ? 'Test…' : 'Tester la connexion'}
          </button>
          {testResult && (
            <span style={{ fontSize: 12.5, fontWeight: 600, color: testResult.ok ? '#2A8049' : '#DC2626' }}>
              {testResult.ok ? '✓ ' : '✕ '}{testResult.msg}
            </span>
          )}
        </div>
      </section>

      {/* ─── 2. Matching des statuts ─── */}
      <section style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10, padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.grisTF }}>2 · Correspondance des statuts</div>
          <button onClick={analyzeStatuses} disabled={loadingStatuses} style={btnGhost}>
            {loadingStatuses ? 'Analyse…' : zStatuses ? 'Réanalyser' : 'Analyser les statuts Zendesk'}
          </button>
        </div>

        {statusMsg && <div style={{ fontSize: 12.5, color: statusMsg.startsWith('✓') ? '#2A8049' : '#DC2626', marginBottom: 12 }}>{statusMsg}</div>}

        {!zStatuses ? (
          <div style={{ fontSize: 13, color: C.grisM, fontStyle: 'italic' }}>
            Lancez l'analyse pour découvrir les statuts présents dans Zendesk et choisir leur correspondance dans l'app. Le mapping est mémorisé : à faire une fois par statut.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {zStatuses.map(zs => {
              const choice = mapping[zs.value] || '';
              return (
                <div key={zs.value} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: `1px solid ${C.grisCL}`, borderRadius: 8, background: C.grisTL }}>
                  <div style={{ minWidth: 160, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: C.grisTF }}>{zs.label}</span>
                    <span style={{ fontSize: 11, color: C.grisM, fontFamily: 'monospace' }}>{zs.value} · {zs.count} ticket{zs.count > 1 ? 's' : ''}</span>
                  </div>
                  <span style={{ color: C.grisM }}>→</span>
                  <select
                    value={choice}
                    onChange={e => setMapping(m => ({ ...m, [zs.value]: e.target.value }))}
                    style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}
                  >
                    <option value="">— Choisir —</option>
                    <optgroup label="Statuts existants">
                      {statuses.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Créer">
                      <option value={CREATE_AS_IS}>Créer « {zs.label} » (tel quel)</option>
                      <option value={CREATE_CUSTOM}>Créer un nouveau statut…</option>
                    </optgroup>
                  </select>
                  {choice === CREATE_CUSTOM && (
                    <input
                      value={customLabels[zs.value] || ''}
                      onChange={e => setCustomLabels(cl => ({ ...cl, [zs.value]: e.target.value }))}
                      placeholder="Nom du statut"
                      style={{ ...inputStyle, width: 180 }}
                    />
                  )}
                </div>
              );
            })}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <button onClick={saveMapping} disabled={savingMap || !allMapped} style={btnPrimary(savingMap || !allMapped)}>
                {savingMap ? 'Enregistrement…' : 'Enregistrer la correspondance'}
              </button>
              {!allMapped && <span style={{ fontSize: 12, color: C.grisM }}>Tous les statuts doivent être mappés avant l'import.</span>}
            </div>
          </div>
        )}
      </section>

      {/* ─── 3. Import ─── */}
      <section style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10, padding: 18 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.grisTF, marginBottom: 14 }}>3 · Import des tickets</div>

        <div style={{ fontSize: 12.5, color: C.grisF, marginBottom: 14, lineHeight: 1.6 }}>
          Importe tous les tickets Zendesk (sujet, messages, client, statut). Gardez cet onglet ouvert pendant l'import.
          Un ticket déjà importé est mis à jour. Les statuts non encore mappés sont ignorés.
        </div>

        <button onClick={startImport} disabled={importing} style={btnPrimary(importing)}>
          {importing ? 'Import en cours…' : 'Lancer l\'import'}
        </button>

        {progress && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.grisF, marginBottom: 6 }}>
              <span>{progress.done}{progress.total ? ` / ${progress.total}` : ''} tickets traités</span>
              {pct !== null && <span style={{ fontWeight: 700 }}>{pct}%</span>}
            </div>
            <div style={{ height: 10, borderRadius: 99, background: C.grisCL, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: pct !== null ? `${pct}%` : '100%', background: TICKETS_COLOR, transition: 'width 0.25s', borderRadius: 99 }} />
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: C.grisM }}>
              <span style={{ color: '#2A8049' }}>Créés : {progress.created}</span>
              <span style={{ color: '#2C5F80' }}>Mis à jour : {progress.updated}</span>
              {progress.errors > 0 && <span style={{ color: '#DC2626' }}>Erreurs : {progress.errors}</span>}
            </div>
          </div>
        )}

        {importError && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 13, color: '#DC2626' }}>
            {importError}
          </div>
        )}

        {importDone && (
          <div style={{ marginTop: 14, padding: '12px 16px', background: '#E5F4EB', border: '1px solid #A7D8B8', borderRadius: 8, fontSize: 13, color: '#2A8049', lineHeight: 1.6 }}>
            <strong>Import terminé.</strong> {importDone.created} créé{importDone.created > 1 ? 's' : ''}, {importDone.updated} mis à jour{importDone.errors > 0 ? `, ${importDone.errors} erreur(s)` : ''}.
            {importDone.missingStatuses?.length > 0 && (
              <div style={{ color: '#92400E', marginTop: 6 }}>
                ⚠ {importDone.missingStatuses.length} statut(s) non mappé(s) ont été ignorés : {importDone.missingStatuses.join(', ')}. Mappez-les puis relancez l'import.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
