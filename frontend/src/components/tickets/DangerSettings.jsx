import { useState, useEffect, useCallback } from 'react';

const API = '/api/sav';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};
const DANGER = '#DC2626';

/**
 * Onglet DANGER — secret partagé de l'espace client SAV.
 *
 * Permet de générer / saisir le secret qui authentifie le plugin WordPress
 * auprès de l'API. Le même secret doit être collé dans les réglages du plugin
 * côté site. Stocké en base (app_config), pas dans le .env.
 */
export default function DangerSettings() {
  const [loading, setLoading]       = useState(true);
  const [configured, setConfigured] = useState(false);
  const [preview, setPreview]       = useState(null);
  const [apiUrl, setApiUrl]         = useState('');
  const [revealed, setRevealed]     = useState(null); // secret en clair si affiché
  const [manual, setManual]         = useState('');
  const [busy, setBusy]             = useState(false);
  const [msg, setMsg]               = useState(null);  // { type: 'ok'|'err', text }

  const fetchState = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/client-sav-secret`);
      const data = await res.json();
      if (data.success) {
        setConfigured(data.configured);
        setPreview(data.preview);
        setApiUrl(data.api_url || '');
      }
    } catch {
      setMsg({ type: 'err', text: 'Erreur de chargement.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  const handleGenerate = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${API}/client-sav-secret/generate`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setRevealed(data.secret);
        setMsg({ type: 'ok', text: 'Nouveau secret généré. Copiez-le dans les réglages du plugin WordPress.' });
        fetchState();
      } else {
        setMsg({ type: 'err', text: data.error || 'Erreur.' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Erreur réseau.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveManual = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${API}/client-sav-secret`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: manual.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setRevealed(manual.trim());
        setManual('');
        setMsg({ type: 'ok', text: 'Secret enregistré. Copiez-le dans les réglages du plugin WordPress.' });
        fetchState();
      } else {
        setMsg({ type: 'err', text: data.error || 'Erreur.' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Erreur réseau.' });
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${API}/client-sav-secret?reveal=1`);
      const data = await res.json();
      if (data.success && data.secret) {
        setRevealed(data.secret);
      } else {
        setMsg({ type: 'err', text: 'Aucun secret à afficher.' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Erreur réseau.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = () => {
    if (revealed) {
      navigator.clipboard?.writeText(revealed);
      setMsg({ type: 'ok', text: 'Secret copié dans le presse-papier.' });
    }
  };

  const handleCopyUrl = () => {
    if (apiUrl) {
      navigator.clipboard?.writeText(apiUrl);
      setMsg({ type: 'ok', text: 'URL copiée dans le presse-papier.' });
    }
  };

  const inputStyle = {
    width: '100%', padding: '9px 12px', border: `1px solid ${C.grisCL}`,
    borderRadius: 7, fontSize: 13, fontFamily: 'monospace', color: C.grisTF, outline: 'none',
  };
  const btnPrimary = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px',
    borderRadius: 7, border: 'none', background: DANGER, color: '#fff',
    fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
  };
  const btnGhost = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px',
    borderRadius: 7, border: `1px solid ${C.grisCL}`, background: C.blanc,
    color: C.grisF, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  };

  return (
    <>
      {/* Bandeau d'avertissement */}
      <div style={{ background: '#FEF2F2', border: `1px solid #FECACA`, borderRadius: 10, padding: '14px 18px', marginBottom: 24, fontSize: 13, color: '#7F1D1D', lineHeight: 1.6 }}>
        <strong style={{ color: DANGER }}>⚠️ Zone sensible — Connexion site ↔ application</strong><br />
        Ce secret authentifie le plugin WordPress « Espace client SAV » auprès de l'application.
        Le <strong>même secret</strong> doit être saisi dans les réglages du plugin côté site.
        Toute modification interrompt la connexion tant que le plugin n'est pas mis à jour.
      </div>

      {/* URL de l'API à renseigner dans le plugin */}
      <div style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10, padding: '16px 18px', marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          URL de l'API — à coller dans le plugin
        </div>
        {loading ? (
          <span style={{ color: C.grisM, fontSize: 13 }}>Chargement…</span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <code style={{ fontSize: 13.5, color: C.grisTF, background: C.grisTL, padding: '6px 12px', borderRadius: 6 }}>{apiUrl || '—'}</code>
            {apiUrl && <button onClick={handleCopyUrl} style={btnGhost}>Copier</button>}
          </div>
        )}
      </div>

      {/* État courant */}
      <div style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10, padding: '16px 18px', marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          État du secret
        </div>
        {loading ? (
          <span style={{ color: C.grisM, fontSize: 13 }}>Chargement…</span>
        ) : configured ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#E5F4EB', color: '#2A8049', borderRadius: 99, padding: '3px 12px', fontSize: 12.5, fontWeight: 700 }}>
              ● Configuré
            </span>
            <code style={{ fontSize: 13, color: C.grisF }}>{revealed || preview}</code>
            {!revealed ? (
              <button onClick={handleReveal} disabled={busy} style={btnGhost}>Afficher</button>
            ) : (
              <button onClick={handleCopy} style={btnGhost}>Copier</button>
            )}
          </div>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#FEF3C7', color: '#92400E', borderRadius: 99, padding: '3px 12px', fontSize: 12.5, fontWeight: 700 }}>
            ● Non configuré — l'espace client est inactif tant qu'aucun secret n'est défini
          </span>
        )}
      </div>

      {/* Génération */}
      <div style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10, padding: '16px 18px', marginBottom: 18 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.grisTF, marginBottom: 6 }}>Générer un nouveau secret</div>
        <div style={{ fontSize: 12.5, color: C.grisM, marginBottom: 12, lineHeight: 1.5 }}>
          Génère automatiquement un secret fort (recommandé). Remplace l'ancien.
        </div>
        <button onClick={handleGenerate} disabled={busy} style={btnPrimary}>
          {busy ? 'Génération…' : 'Générer un secret'}
        </button>
      </div>

      {/* Saisie manuelle */}
      <div style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10, padding: '16px 18px', marginBottom: 18 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.grisTF, marginBottom: 6 }}>Ou saisir un secret manuellement</div>
        <div style={{ fontSize: 12.5, color: C.grisM, marginBottom: 12 }}>Minimum 24 caractères.</div>
        <input
          type="text"
          value={manual}
          onChange={e => setManual(e.target.value)}
          placeholder="Collez ou tapez un secret…"
          style={inputStyle}
        />
        <div style={{ marginTop: 12 }}>
          <button onClick={handleSaveManual} disabled={busy || manual.trim().length < 24} style={{ ...btnPrimary, background: (manual.trim().length < 24) ? C.grisM : DANGER }}>
            Enregistrer ce secret
          </button>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div style={{
          padding: '10px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
          background: msg.type === 'ok' ? '#E5F4EB' : '#FEF2F2',
          color: msg.type === 'ok' ? '#2A8049' : DANGER,
          border: `1px solid ${msg.type === 'ok' ? '#A7D8B8' : '#FECACA'}`,
        }}>
          {msg.text}
        </div>
      )}
    </>
  );
}
