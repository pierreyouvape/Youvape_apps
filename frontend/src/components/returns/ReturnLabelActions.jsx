import { useState } from 'react';
import axios from 'axios';
import { C } from '../picking/pickingUi';
import { RETURNS_API, RETURNS_COLOR, btn, field, errorText } from './returnsUi';

const EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'text/plain': 'txt' };

/** Fichier de l'étiquette, tel que Mondial Relay l'a rendu (PDF ou QR code). */
const fetchLabelFile = async (ret) => {
  const { data } = await axios.get(`${RETURNS_API}/${ret.id}/label`, { responseType: 'blob' });
  return new File([data], `retour_${ret.id}_mondialrelay_${ret.label_tracking}.${EXT[data.type] || 'bin'}`, { type: data.type });
};

/**
 * Étiquette retour Mondial Relay d'un retour : la créer (PDF ou QR code), la
 * télécharger et, depuis un ticket, la joindre à la réponse en cours.
 */
export default function ReturnLabelActions({ ret, ticketId, onChange, small }) {
  const [format, setFormat] = useState('pdf');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attached, setAttached] = useState(false);

  if (!ret.return_required || ret.status === 'annule') return null;
  const size = small ? { padding: '4px 9px', fontSize: 12 } : {};

  const create = async (force = false) => {
    if (force && !window.confirm('Créer une nouvelle étiquette ? L’ancienne reste valable chez Mondial Relay (elle n’est facturée que si elle sert).')) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.post(`${RETURNS_API}/${ret.id}/label`, { format, force });
      onChange?.(data);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  const download = async () => {
    try {
      const file = await fetchLabelFile(ret);
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const attach = async () => {
    try {
      const file = await fetchLabelFile(ret);
      window.dispatchEvent(new CustomEvent('sav:attach-file', { detail: { ticketId, file } }));
      setAttached(true);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {ret.has_label ? (
        <>
          <span style={{ fontSize: small ? 12 : 13, color: C.dark }}>
            Étiquette MR <strong>n°{ret.label_tracking}</strong> ({ret.label_format === 'qr' ? 'QR code' : 'PDF'})
          </span>
          <button type="button" onClick={download} style={{ ...btn('ghost'), ...size }}>Télécharger</button>
          {ticketId && (
            <button type="button" onClick={attach} disabled={attached} style={{ ...btn('primary', attached), ...size }}>
              {attached ? 'Jointe ✓' : 'Joindre à la réponse'}
            </button>
          )}
          {!small && (
            <button type="button" onClick={() => create(true)} disabled={busy} style={{ ...btn('ghost'), ...size, color: C.greyT }}>
              Refaire
            </button>
          )}
        </>
      ) : (
        <>
          <select value={format} onChange={e => setFormat(e.target.value)} style={{ ...field, ...size }}>
            <option value="pdf">PDF à imprimer</option>
            <option value="qr">QR code (sans imprimante)</option>
          </select>
          <button
            type="button" onClick={() => create(false)} disabled={busy}
            style={{ ...btn('ghost', busy), ...size, color: RETURNS_COLOR, borderColor: RETURNS_COLOR }}
          >
            {busy ? 'Création…' : 'Étiquette retour Mondial Relay'}
          </button>
        </>
      )}
      {error && <span style={{ fontSize: 12, color: C.red, fontWeight: 600, width: '100%' }}>{error}</span>}
    </div>
  );
}
