import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { API_URL, authHeaders, C, CarrierLogo } from '../components/picking/pickingUi';
import PdaLayout from '../components/pda/PdaLayout';
import { pdaBtn as bigBtn } from '../components/pda/pdaStyles';
import { beep, useScanner } from '../components/pda/pdaScan';

/**
 * Picking au PDA (lot 3) — /pda/picking, ouvert depuis l'accueil PDA (/pda).
 *
 * Tranché avec Pierre le 28/09/2026 :
 *   - la liste des vagues à préparer ; on en ouvre une en la touchant ou en
 *     scannant le code-barres de sa page de garde ;
 *   - « Me l'assigner » est un geste volontaire ; ensuite personne d'autre n'y
 *     entre (« En cours par Pierre ») ;
 *   - scan = +1, la ligne se valide seule à la quantité ; « Valider » met le
 *     reste d'un coup ; « Manquant » déclare manquant le reste ;
 *   - l'avancement est sur le serveur : à l'ouverture, on retombe sur sa vague.
 *
 * Le scanner Zebra (DataWedge) « tape » le code puis Entrée. On écoute le
 * clavier au niveau de la page, SANS champ de saisie : un champ ouvrirait le
 * clavier virtuel d'Android à chaque scan.
 */

// Session fermée (19h30, ou déconnexion ailleurs) : le serveur répond 401,
// on repasse par le login au lieu d'afficher une erreur incompréhensible.
let onUnauthorized = null;
const unauthorized = (err) => {
  if (err.response?.status === 401) onUnauthorized?.();
  throw err;
};

const api = (token) => ({
  get: (url) => axios.get(`${API_URL}/picking/pda${url}`, authHeaders(token)).then(r => r.data, unauthorized),
  post: (url, body = {}) => axios.post(`${API_URL}/picking/pda${url}`, body, authHeaders(token)).then(r => r.data, unauthorized),
});

const errorText = (err) => err.response?.data?.error || (err.response?.status === 403
  ? 'Vous n\'avez pas le droit Picking : demandez-le à un responsable.'
  : err.message);

// ── Écran 1 : les vagues à préparer ─────────────────────────────────────────

function WaveList({ token, onOpen, notice, setNotice }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api(token).get('/waves'));
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err) });
    }
  }, [token, setNotice]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  useScanner(async (code) => {
    try {
      const { id } = await api(token).get(`/waves/find?number=${encodeURIComponent(code)}`);
      beep(true);
      onOpen(id);
    } catch (err) {
      beep(false);
      setNotice({ kind: 'error', text: errorText(err) });
    }
  }, true);

  return (
    <div style={{ padding: 14 }}>
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}
      <p style={{ margin: '4px 2px 12px', color: C.greyT, fontSize: 14 }}>
        Touchez une vague, ou scannez le code-barres de sa page de garde.
      </p>
      {!data && <p style={{ color: C.greyT }}>Chargement…</p>}
      {data && data.waves.length === 0 && (
        <p style={{ color: C.greyT, textAlign: 'center', padding: 30, fontSize: 16 }}>Aucune vague à préparer.</p>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {data?.waves.map(w => (
          <button
            key={w.id}
            onClick={() => !w.locked && onOpen(w.id)}
            disabled={w.locked}
            style={{
              textAlign: 'left', width: '100%', padding: 14, borderRadius: 14, fontFamily: 'inherit',
              border: `2px solid ${w.mine ? C.violet : C.greyB}`, background: w.locked ? C.grey : C.white,
              opacity: w.locked ? 0.6 : 1, color: C.dark,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 21, flex: 1 }}>{w.waveNumber}</span>
              {w.assignedTo && (
                <span style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 13, fontWeight: 700,
                  background: w.mine ? C.violet : C.amberL, color: w.mine ? C.white : C.amber,
                }}>{w.mine ? 'À vous' : `En cours par ${w.assignedTo}`}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15 }}>
                <strong>{w.orders}</strong> cmd
                {w.items > 0 && <> · <strong>{w.itemsDone}/{w.items}</strong> articles</>}
              </span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {w.carriers.map(c => <CarrierLogo key={`${c.carrierCode}:${c.accountCode}`} carrier={c} height={16} />)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Écran 2 : le picking d'une vague ────────────────────────────────────────

/**
 * Une ligne de picking. La photo d'abord : on reconnaît l'article avant d'avoir
 * lu son nom. La ligne à prendre est en grand — c'est elle qu'on cherche des
 * yeux, le PDA à bout de bras ; les autres restent compactes.
 */
function Line({ line, current, mine, busy, onValidate, onMissing, onUndo, refProp }) {
  const remaining = line.qtyNeeded - line.qtyPicked - line.qtyMissing;
  const bg = !line.done ? (current ? C.violetL : C.white) : line.qtyMissing > 0 ? C.amberL : C.greenL;
  const big = current;
  const img = big ? 104 : 56;
  return (
    <div ref={refProp} style={{
      display: 'flex', alignItems: 'stretch', gap: big ? 12 : 8, padding: big ? 14 : 8, borderRadius: 14, background: bg,
      border: `${big ? 3 : 1}px solid ${big ? C.violet : C.greyB}`,
      boxShadow: big ? '0 6px 18px rgba(124,58,237,0.25)' : 'none',
      opacity: line.done ? 0.85 : 1,
    }}>
      {line.imageUrl
        ? <img src={line.imageUrl} alt="" loading="lazy" style={{
          width: img, height: img, objectFit: 'contain', borderRadius: 10, background: C.white, flexShrink: 0, alignSelf: 'center',
        }} />
        : <div style={{
          width: img, height: img, borderRadius: 10, background: C.greyB, flexShrink: 0, alignSelf: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.greyM, fontSize: big ? 30 : 18,
        }}>?</div>}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 900, fontSize: big ? 30 : 18, lineHeight: 1.1, color: line.location ? C.dark : C.greyM }}>
            {line.location || 'Sans empl.'}
          </span>
          <span style={{ fontSize: big ? 13 : 11.5, color: C.greyT }}>pour {line.ordersCount} cmd</span>
        </div>
        <div style={{ fontWeight: 700, fontSize: big ? 18 : 14, lineHeight: 1.25, marginTop: 3 }}>{line.name}</div>
        <div style={{ fontSize: big ? 13 : 11.5, color: C.greyT, marginTop: 2 }}>
          {[line.brand, line.sku && `SKU ${line.sku}`].filter(Boolean).join(' · ')}
          {line.hasBarcode === false && <strong style={{ color: C.amber }}> · pas de code-barres</strong>}
        </div>
        {line.done && line.qtyMissing > 0 && (
          <div style={{ fontSize: 13, fontWeight: 800, color: C.amber, marginTop: 4 }}>Manquant : {line.qtyMissing}</div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: big ? 34 : 20, fontWeight: 900, whiteSpace: 'nowrap', lineHeight: 1 }}>
          {line.qtyPicked}<span style={{ color: C.greyT, fontWeight: 600, fontSize: big ? 20 : 14 }}>/{line.qtyNeeded}</span>
        </span>
        {mine && !line.done && (
          <button disabled={busy} onClick={() => onValidate(line)} style={{
            ...bigBtn(C.green), fontSize: big ? 17 : 13, padding: big ? '12px 16px' : '7px 10px',
          }}>
            Valider{remaining < line.qtyNeeded ? ` ${remaining}` : ''}
          </button>
        )}
        {mine && !line.done && (
          <button disabled={busy} onClick={() => onMissing(line)} style={{
            border: `1px solid ${C.red}`, borderRadius: 8, background: C.white, color: C.red,
            fontSize: 11.5, fontWeight: 700, padding: '3px 8px', fontFamily: 'inherit', cursor: 'pointer',
          }}>Manquant</button>
        )}
        {mine && line.done && (line.qtyManual > 0 || line.qtyMissing > 0) && (
          <button disabled={busy} onClick={() => onUndo(line)} style={{
            ...bigBtn(C.white, C.greyT), border: `1px solid ${C.greyB}`, fontSize: 12, padding: '5px 8px', fontWeight: 600,
          }}>Annuler</button>
        )}
        {line.done && line.qtyMissing === 0 && <span style={{ fontSize: 20, color: C.green }}>✓</span>}
      </div>
    </div>
  );
}

function WaveScreen({ token, waveId, onBack, setNotice, notice }) {
  const [wave, setWave] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const [typing, setTyping] = useState(false);
  // Carton au contenu inconnu : { code, message } — on demande la quantité une fois.
  const [packAsk, setPackAsk] = useState(null);
  const [packQty, setPackQty] = useState('');
  const [typed, setTyped] = useState('');
  const currentRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setWave(await api(token).get(`/waves/${waveId}`));
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err) });
      onBack();
    }
  }, [token, waveId, setNotice, onBack]);

  useEffect(() => { load(); }, [load]);

  const replaceLine = (line) => setWave(w => ({ ...w, lines: w.lines.map(l => (l.id === line.id ? line : l)) }));

  const showFlash = (kind, text) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash(f => (f?.text === text ? null : f)), kind === 'ok' ? 700 : 2500);
  };

  const act = async (fn) => {
    setBusy(true);
    try {
      replaceLine(await fn());
    } catch (err) {
      beep(false);
      showFlash('error', errorText(err));
      if (err.response?.status === 403) load();
    } finally {
      setBusy(false);
    }
  };

  const mine = !!wave?.mine;

  const scan = async (code) => {
    if (!mine) {
      beep(false);
      showFlash('error', 'Assignez-vous la vague avant de scanner.');
      return;
    }
    try {
      const line = await api(token).post(`/waves/${waveId}/scan`, { code });
      replaceLine(line);
      beep(true);
      showFlash('ok', `${line.name} — ${line.qtyPicked}/${line.qtyNeeded}`);
    } catch (err) {
      beep(false);
      if (err.response?.data?.code === 'PACK_QTY_UNKNOWN') {
        setPackQty('');
        setPackAsk({ code: err.response.data.barcode, message: err.response.data.error });
        return;
      }
      showFlash('error', errorText(err));
    }
  };

  // Contenu du carton saisi : enregistré pour la suite, puis le carton est compté.
  const confirmPackQty = async () => {
    const ask = packAsk;
    setPackAsk(null);
    try {
      const line = await api(token).post(`/waves/${waveId}/pack-quantity`, { code: ask.code, quantity: packQty });
      replaceLine(line);
      beep(true);
      showFlash('ok', `${line.name} — ${line.qtyPicked}/${line.qtyNeeded}`);
    } catch (err) {
      beep(false);
      showFlash('error', errorText(err));
    }
  };
  useScanner(scan, !!wave && !typing && !packAsk);

  const current = wave?.lines.find(l => !l.done);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [current?.id]);

  const assign = async () => {
    setBusy(true);
    try {
      setWave(await api(token).post(`/waves/${waveId}/assign`));
      beep(true);
    } catch (err) {
      beep(false);
      setNotice({ kind: 'error', text: errorText(err) });
      load();
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!window.confirm(`Terminer la vague ${wave.waveNumber} ?`)) return;
    setBusy(true);
    try {
      await api(token).post(`/waves/${waveId}/finish`);
      beep(true);
      setNotice({ kind: 'ok', text: `Vague ${wave.waveNumber} terminée.` });
      onBack();
    } catch (err) {
      beep(false);
      showFlash('error', errorText(err));
      setBusy(false);
    }
  };

  if (!wave) return <p style={{ padding: 20, color: C.greyT }}>Chargement…</p>;

  const total = wave.lines.reduce((s, l) => s + l.qtyNeeded, 0);
  const picked = wave.lines.reduce((s, l) => s + l.qtyPicked, 0);
  const missing = wave.lines.reduce((s, l) => s + l.qtyMissing, 0);
  const openLines = wave.lines.filter(l => !l.done).length;

  return (
    <div style={{ paddingBottom: 110 }}>
      <div style={{ padding: '12px 14px', background: C.white, borderBottom: `1px solid ${C.greyB}`, position: 'sticky', top: 56, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 22, flex: 1 }}>{wave.waveNumber}</span>
          <span style={{ fontSize: 14, color: C.greyT }}>{wave.orders} cmd</span>
        </div>
        {mine && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 8, borderRadius: 99, background: C.greyB, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${total ? ((picked + missing) / total) * 100 : 0}%`, background: C.violet }} />
            </div>
            <div style={{ fontSize: 13, color: C.greyT, marginTop: 5 }}>
              {picked}/{total} articles pris{missing > 0 && <strong style={{ color: C.amber }}> · {missing} manquant(s)</strong>}
              {' · '}{openLines} ligne(s) restante(s)
            </div>
          </div>
        )}
      </div>

      {notice && <div style={{ padding: '10px 14px 0' }}><Notice notice={notice} onClose={() => setNotice(null)} /></div>}

      {!mine && (
        <div style={{ margin: 14, padding: 14, borderRadius: 12, background: wave.locked ? C.amberL : C.violetL }}>
          {wave.locked
            ? <strong style={{ color: C.amber }}>En cours par {wave.assignedTo} : vous ne pouvez pas la préparer.</strong>
            : <span style={{ fontSize: 14 }}>Aperçu de la vague. Assignez-la-vous pour commencer à scanner.</span>}
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, padding: '12px 10px' }}>
        {wave.lines.map(l => (
          <Line
            key={l.id} line={l} mine={mine} busy={busy}
            current={mine && current?.id === l.id}
            refProp={current?.id === l.id ? currentRef : null}
            onValidate={(line) => act(() => api(token).post(`/waves/${waveId}/lines/${line.id}/validate`))}
            onMissing={(line) => {
              const reste = line.qtyNeeded - line.qtyPicked - line.qtyMissing;
              if (window.confirm(`${line.name}\n\nDéclarer ${reste} manquant(s) ?`)) {
                act(() => api(token).post(`/waves/${waveId}/lines/${line.id}/missing`));
              }
            }}
            onUndo={(line) => act(() => api(token).post(`/waves/${waveId}/lines/${line.id}/undo`))}
          />
        ))}
      </div>

      {/* Barre du bas : l'action du moment, toujours sous le pouce. */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, background: C.white,
        borderTop: `1px solid ${C.greyB}`, display: 'flex', gap: 10, zIndex: 10,
      }}>
        {!mine && !wave.locked && (
          <button disabled={busy} onClick={assign} style={{ ...bigBtn(C.violet), flex: 1, fontSize: 19 }}>Me l'assigner</button>
        )}
        {mine && (
          <>
            <button onClick={() => { setTyping(true); setTyped(''); }} style={{ ...bigBtn(C.white, C.dark), border: `1px solid ${C.greyB}`, fontSize: 14 }}>
              Saisir un code
            </button>
            <button disabled={busy || openLines > 0} onClick={finish} style={{
              ...bigBtn(openLines > 0 ? C.greyB : C.green, openLines > 0 ? C.greyT : C.white), flex: 1,
            }}>
              {openLines > 0 ? `Encore ${openLines} ligne(s)` : 'Terminer la vague'}
            </button>
          </>
        )}
      </div>

      {flash && (
        <div style={{
          position: 'fixed', left: 12, right: 12, bottom: 90, zIndex: 20, padding: '14px 16px', borderRadius: 12,
          background: flash.kind === 'ok' ? C.green : C.red, color: C.white, fontWeight: 800, fontSize: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}>{flash.text}</div>
      )}

      {packAsk && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 30, display: 'flex', alignItems: 'flex-start', padding: 16, paddingTop: 80 }}>
          <form
            onSubmit={(e) => { e.preventDefault(); if (parseInt(packQty, 10) >= 2) confirmPackQty(); }}
            style={{ background: C.white, borderRadius: 14, padding: 16, width: '100%' }}
          >
            <div style={{ fontWeight: 800, fontSize: 16 }}>{packAsk.message}</div>
            <div style={{ fontSize: 13, color: C.greyT, marginTop: 6 }}>
              Code {packAsk.code} — la réponse est enregistrée, la question ne reviendra plus.
            </div>
            <input
              autoFocus value={packQty} onChange={e => setPackQty(e.target.value)} inputMode="numeric" placeholder="ex. 10"
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 12, padding: 12, fontSize: 22, fontWeight: 800, textAlign: 'center', borderRadius: 10, border: `1px solid ${C.greyB}` }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button type="button" onClick={() => setPackAsk(null)} style={{ ...bigBtn(C.white, C.dark), border: `1px solid ${C.greyB}`, flex: 1 }}>Annuler</button>
              <button type="submit" disabled={!(parseInt(packQty, 10) >= 2)} style={{ ...bigBtn(C.violet), flex: 1, opacity: parseInt(packQty, 10) >= 2 ? 1 : 0.5 }}>Compter</button>
            </div>
          </form>
        </div>
      )}

      {typing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 30, display: 'flex', alignItems: 'flex-start', padding: 16, paddingTop: 80 }}>
          <form
            onSubmit={(e) => { e.preventDefault(); setTyping(false); if (typed.trim()) scan(typed.trim()); }}
            style={{ background: C.white, borderRadius: 14, padding: 16, width: '100%' }}
          >
            <label style={{ fontWeight: 700 }}>Code-barres ou SKU</label>
            <input
              autoFocus value={typed} onChange={e => setTyped(e.target.value)} inputMode="numeric"
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, padding: 12, fontSize: 18, borderRadius: 10, border: `1px solid ${C.greyB}` }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button type="button" onClick={() => setTyping(false)} style={{ ...bigBtn(C.white, C.dark), border: `1px solid ${C.greyB}`, flex: 1 }}>Annuler</button>
              <button type="submit" style={{ ...bigBtn(C.violet), flex: 1 }}>OK</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const Notice = ({ notice, onClose }) => (
  <div onClick={onClose} style={{
    marginBottom: 12, padding: '12px 14px', borderRadius: 12, fontSize: 15, fontWeight: 600,
    background: notice.kind === 'error' ? C.redL : C.greenL, color: notice.kind === 'error' ? C.red : C.green,
  }}>{notice.text}</div>
);

// ── Page ────────────────────────────────────────────────────────────────────

export default function PdaPicking() {
  const { token, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  onUnauthorized = logout;
  const [waveId, setWaveId] = useState(null);
  const [notice, setNotice] = useState(null);
  const resumed = useRef(false);

  // À l'ouverture : si une vague m'est assignée et pas terminée, j'y retourne
  // directement — l'avancement est sur le serveur, pas dans ce PDA.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    api(token).get('/waves').then(d => { if (d.current) setWaveId(d.current); }).catch(() => {});
  }, [token]);

  const back = useCallback(() => setWaveId(null), []);

  return (
    <PdaLayout
      title="Picking"
      onBack={waveId ? back : () => navigate('/pda')}
      backLabel={waveId ? 'Vagues' : 'Accueil'}
    >
      {waveId
        ? <WaveScreen key={waveId} token={token} waveId={waveId} onBack={back} notice={notice} setNotice={setNotice} />
        : <WaveList token={token} onOpen={setWaveId} notice={notice} setNotice={setNotice} />}
    </PdaLayout>
  );
}
