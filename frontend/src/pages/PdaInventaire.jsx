import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { API_URL, authHeaders, C } from '../components/picking/pickingUi';
import PdaLayout from '../components/pda/PdaLayout';
import { pdaBtn as bigBtn } from '../components/pda/pdaStyles';
import { beep, useScanner } from '../components/pda/pdaScan';
import CameraScanner from '../components/boutique/CameraScanner';

/**
 * Inventaire au PDA — /pda/inventaire, ouvert depuis l'accueil PDA (/pda).
 * Lot 1, validé avec Pierre le 06/10/2026.
 *
 *   - on choisit un emplacement (ou on scanne son étiquette) et on le prend :
 *     personne d'autre n'y entre ;
 *   - comptage À L'AVEUGLE : jamais de stock théorique à l'écran ;
 *     scan = +1, carton = son contenu, ou on touche la ligne pour saisir ;
 *   - chaque référence attendue est comptée ou déclarée absente avant
 *     « Terminer l'emplacement » ;
 *   - le soir, « Valider ma journée » rend ses emplacements terminés définitifs ;
 *   - « À recompter » : les écarts trop forts reviennent ici, un produit à la fois.
 *
 * L'inventaire se crée au bureau (/inventaire). Tout l'avancement est sur le
 * serveur : un PDA qu'on change ne perd rien.
 */

let onUnauthorized = null;
const unauthorized = (err) => {
  if (err.response?.status === 401) onUnauthorized?.();
  throw err;
};

const api = (token) => {
  const base = `${API_URL}/inventaire/pda`;
  const h = authHeaders(token);
  return {
    get: (url) => axios.get(base + url, h).then(r => r.data, unauthorized),
    post: (url, body = {}) => axios.post(base + url, body, h).then(r => r.data, unauthorized),
    put: (url, body = {}) => axios.put(base + url, body, h).then(r => r.data, unauthorized),
    del: (url) => axios.delete(base + url, h).then(r => r.data, unauthorized),
  };
};

const errorText = (err) => err.response?.data?.error || (err.response?.status === 403
  ? 'Vous n\'avez pas le droit Picking : demandez-le à un responsable.'
  : err.message);

const BLUE = '#0369A1';
const locLabel = (l) => l || 'Sans emplacement';
const pct = (n, total) => (total ? Math.floor((n / total) * 100) : 0);

const card = { background: C.white, borderRadius: 14, border: `1px solid ${C.greyB}`, padding: 14 };
const smallBtn = { ...bigBtn(C.white, C.dark), border: `1px solid ${C.greyB}`, fontSize: 14, padding: '9px 12px' };
const input = {
  width: '100%', boxSizing: 'border-box', padding: 14, fontSize: 26, fontWeight: 800, borderRadius: 10,
  border: `2px solid ${C.greyB}`, fontFamily: 'inherit', textAlign: 'center',
};

const Photo = ({ url, size }) => (url
  ? <img src={url} alt="" loading="lazy" style={{
    width: size, height: size, objectFit: 'contain', borderRadius: 10, background: C.white, flexShrink: 0,
  }} />
  : <div style={{
    width: size, height: size, borderRadius: 10, background: C.greyB, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.greyM, fontSize: size / 3,
  }}>?</div>);

const CameraButton = ({ onClick }) => (
  <button type="button" onClick={onClick} title="Scanner avec l'appareil photo" style={{
    ...smallBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px',
  }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  </button>
);

const Sheet = ({ title, onClose, children }) => (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 30,
    display: 'flex', alignItems: 'flex-start', padding: 12, paddingTop: 64, overflowY: 'auto',
  }}>
    <div style={{ background: C.white, borderRadius: 14, padding: 16, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 10 }}>
        <span style={{ fontWeight: 900, fontSize: 19, flex: 1 }}>{title}</span>
        <button type="button" onClick={onClose} style={{ ...smallBtn, padding: '6px 12px' }}>Fermer</button>
      </div>
      {children}
    </div>
  </div>
);

/** Saisie d'une quantité au pavé numérique. */
function QtySheet({ title, subtitle, initial, onSave, onClose, extra }) {
  const [value, setValue] = useState(initial == null ? '' : String(initial));
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(n) && n >= 0;
  return (
    <Sheet title={title} onClose={onClose}>
      {subtitle && <div style={{ fontSize: 15, color: C.greyT, marginBottom: 10 }}>{subtitle}</div>}
      <form onSubmit={(e) => { e.preventDefault(); if (valid) onSave(n); }}>
        <input
          autoFocus type="number" inputMode="numeric" min="0" value={value}
          onChange={(e) => setValue(e.target.value)} style={input}
        />
        <button type="submit" disabled={!valid} style={{ ...bigBtn(valid ? BLUE : C.greyB), width: '100%', marginTop: 12, fontSize: 19 }}>
          Enregistrer
        </button>
      </form>
      {extra}
    </Sheet>
  );
}

const ProgressBar = ({ done, total }) => (
  <div style={{ height: 10, borderRadius: 999, background: C.greyB, overflow: 'hidden' }}>
    <div style={{ width: `${pct(done, total)}%`, height: '100%', background: C.green }} />
  </div>
);

const STATUS = {
  free: { label: 'À compter', bg: C.white, fg: C.greyT },
  counting: { label: 'En cours', bg: C.amberL, fg: C.amber },
  closed: { label: 'Terminé', bg: C.blueL, fg: C.blue },
  validated: { label: 'Validé', bg: C.greenL, fg: C.green },
};

// ── Écran 1 : les emplacements ──────────────────────────────────────────────

function HomeScreen({ token, data, reload, onOpenLocation, onRecounts, showFlash, onScanRef, onCamera }) {
  const [filter, setFilter] = useState('todo');
  const [confirmDay, setConfirmDay] = useState(false);

  onScanRef.current = async (code) => {
    try {
      const { id } = await api(token).get(`/locations/find?code=${encodeURIComponent(code)}`);
      beep(true);
      onOpenLocation(id);
    } catch (err) {
      beep(false);
      showFlash('error', errorText(err));
    }
  };

  const validateDay = async () => {
    setConfirmDay(false);
    try {
      const r = await api(token).post('/validate-day');
      showFlash('ok', `${r.validated} emplacement(s) validé(s).${r.stillCounting ? ` ${r.stillCounting} en cours reste(nt) à vous.` : ''}`);
      reload();
    } catch (err) {
      showFlash('error', errorText(err));
    }
  };

  if (!data) return <p style={{ color: C.greyT, padding: 20 }}>Chargement…</p>;
  if (!data.inventory) {
    return (
      <p style={{ color: C.greyT, textAlign: 'center', padding: 30, fontSize: 16 }}>
        Aucun inventaire en cours. Il se crée au bureau, dans l'app Inventaire.
      </p>
    );
  }

  const { progress, locations } = data;
  const shown = locations.filter(l => {
    if (filter === 'todo') return l.status === 'free' || (l.status === 'counting' && l.mine);
    if (filter === 'mine') return l.mine;
    return true;
  });
  const aisles = [];
  for (const l of shown) {
    const last = aisles[aisles.length - 1];
    if (last && last.aisle === l.aisle) last.items.push(l);
    else aisles.push({ aisle: l.aisle, items: [l] });
  }

  return (
    <div style={{ padding: 14, display: 'grid', gap: 12 }}>
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>{data.inventory.name}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '8px 0' }}>
          <span style={{ fontSize: 30, fontWeight: 900, color: C.green }}>{pct(progress.done, progress.total)} %</span>
          <span style={{ fontSize: 15, color: C.greyT }}>{progress.done} / {progress.total} réfs comptées</span>
        </div>
        <ProgressBar done={progress.done} total={progress.total} />
      </div>

      {progress.recount > 0 && (
        <button onClick={onRecounts} style={{ ...bigBtn(C.accent), width: '100%', fontSize: 18 }}>
          À recompter : {progress.recount}
        </button>
      )}
      {data.myClosed > 0 && (
        <button onClick={() => setConfirmDay(true)} style={{ ...bigBtn(C.green), width: '100%', fontSize: 18 }}>
          Valider ma journée ({data.myClosed} terminé{data.myClosed > 1 ? 's' : ''})
        </button>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {[['todo', 'À faire'], ['mine', 'Les miens'], ['all', 'Tous']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            ...smallBtn, flex: 1, fontSize: 15,
            background: filter === k ? BLUE : C.white, color: filter === k ? C.white : C.dark,
            border: `1px solid ${filter === k ? BLUE : C.greyB}`,
          }}>{label}</button>
        ))}
        <CameraButton onClick={onCamera} />
      </div>
      <p style={{ margin: 0, color: C.greyT, fontSize: 14 }}>Touchez un emplacement, ou scannez son étiquette.</p>

      {shown.length === 0 && (
        <p style={{ color: C.greyT, textAlign: 'center', padding: 20, fontSize: 16 }}>Rien ici.</p>
      )}
      {aisles.map(a => (
        <div key={a.aisle || '-'}>
          <div style={{ fontWeight: 900, fontSize: 14, color: C.greyT, margin: '4px 2px 6px', textTransform: 'uppercase' }}>
            {a.aisle ? `Allée ${a.aisle}` : 'Sans emplacement'}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {a.items.map(l => {
              const st = STATUS[l.status];
              return (
                <button key={l.id} onClick={() => onOpenLocation(l.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 12,
                  borderRadius: 12, border: `2px solid ${l.mine ? BLUE : C.greyB}`, background: l.locked ? C.grey : C.white,
                  fontFamily: 'inherit', color: C.dark, opacity: l.locked ? 0.7 : 1,
                }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 20, flex: 1 }}>{locLabel(l.location)}</span>
                  <span style={{ fontSize: 14, color: C.greyT }}>{l.counted}/{l.expected}</span>
                  <span style={{
                    padding: '3px 10px', borderRadius: 999, fontSize: 13, fontWeight: 700,
                    background: l.mine && l.status === 'counting' ? BLUE : st.bg,
                    color: l.mine && l.status === 'counting' ? C.white : st.fg,
                    border: l.status === 'free' ? `1px solid ${C.greyB}` : 'none',
                  }}>
                    {l.status === 'counting' ? (l.mine ? 'À vous' : `Par ${l.assignedTo}`) : st.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {confirmDay && (
        <Sheet title="Valider ma journée" onClose={() => setConfirmDay(false)}>
          <p style={{ fontSize: 16, marginTop: 0 }}>
            Vos {data.myClosed} emplacement(s) terminé(s) deviennent définitifs : vous ne pourrez plus les rouvrir.
            {data.myCounting > 0 && ` Vos ${data.myCounting} emplacement(s) en cours restent à vous.`}
          </p>
          <button onClick={validateDay} style={{ ...bigBtn(C.green), width: '100%', fontSize: 19 }}>Valider</button>
        </Sheet>
      )}
    </div>
  );
}

// ── Écran 2 : un emplacement ────────────────────────────────────────────────

function LocationScreen({ token, locationId, onDone, showFlash, onScanRef, onCamera }) {
  const [loc, setLoc] = useState(null);
  const [edit, setEdit] = useState(null);        // ligne dont on saisit la quantité
  const [ask, setAsk] = useState(null);          // { kind: 'pack' | 'choice', ... }
  const [packQty, setPackQty] = useState('');
  const [lastId, setLastId] = useState(null);
  const [typing, setTyping] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoc(await api(token).get(`/locations/${locationId}`));
    } catch (err) {
      showFlash('error', errorText(err));
      onDone();
    }
  }, [token, locationId, showFlash, onDone]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    if (busy.current) return null;
    busy.current = true;
    try {
      return await fn();
    } catch (err) {
      beep(false);
      showFlash('error', errorText(err));
      return null;
    } finally {
      busy.current = false;
    }
  };

  const scan = async (code, productId) => {
    if (!loc?.canCount) {
      beep(false);
      showFlash('error', 'Prenez l\'emplacement avant de compter.');
      return;
    }
    if (busy.current) return;
    busy.current = true;
    try {
      const data = await api(token).post(`/locations/${locationId}/scan`, { code, productId });
      setLoc(data);
      setLastId(data.scanned.productId);
      beep(true);
      const line = data.lines.find(l => l.productId === data.scanned.productId);
      showFlash('ok', `+${data.scanned.qty} ${line?.name || ''} → ${line?.qty ?? ''}`);
    } catch (err) {
      beep(false);
      const d = err.response?.data;
      if (d?.code === 'PACK_QTY_UNKNOWN') {
        setPackQty('');
        setAsk({ kind: 'pack', code: d.barcode, productId: d.productId, message: d.error });
      } else if (d?.code === 'AMBIGUOUS') {
        setAsk({ kind: 'choice', code: d.barcode, choices: d.choices });
      } else {
        showFlash('error', errorText(err));
      }
    } finally {
      busy.current = false;
    }
  };
  onScanRef.current = (code) => { if (!ask && !edit && !typing) scan(code); };

  const confirmPack = async () => {
    const a = ask;
    setAsk(null);
    const ok = await run(() => api(token).post('/pack-quantity', { code: a.code, productId: a.productId, quantity: packQty }));
    if (ok) await scan(a.code, a.productId);
  };

  const take = () => run(async () => { setLoc(await api(token).post(`/locations/${locationId}/take`)); });
  const reopen = () => run(async () => { setLoc(await api(token).post(`/locations/${locationId}/reopen`)); });
  const saveQty = (line, qty) => run(async () => {
    setEdit(null);
    setLoc(await api(token).put(`/locations/${locationId}/products/${line.productId}`, { qty }));
    setLastId(line.productId);
  });
  const remove = (line) => run(async () => {
    setEdit(null);
    setLoc(await api(token).del(`/locations/${locationId}/products/${line.productId}`));
  });
  const close = () => run(async () => {
    await api(token).post(`/locations/${locationId}/close`);
    showFlash('ok', `${locLabel(loc.location)} terminé.`);
    onDone();
  });

  if (!loc) return <p style={{ color: C.greyT, padding: 20 }}>Chargement…</p>;

  const expected = loc.lines.filter(l => l.expected);
  const countedExpected = expected.filter(l => l.qty != null).length;
  const left = expected.length - countedExpected;
  const st = STATUS[loc.status];

  return (
    <div style={{ padding: 14, paddingBottom: 110, display: 'grid', gap: 10 }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 30 }}>{locLabel(loc.location)}</div>
          <div style={{ fontSize: 15, color: C.greyT }}>{countedExpected} / {expected.length} réfs comptées</div>
        </div>
        <span style={{ padding: '4px 12px', borderRadius: 999, fontSize: 14, fontWeight: 800, background: st.bg, color: st.fg }}>
          {loc.status === 'counting' && !loc.canCount ? `Par ${loc.assignedTo}` : st.label}
        </span>
      </div>

      {loc.status === 'free' && (
        <button onClick={take} style={{ ...bigBtn(BLUE), width: '100%', fontSize: 20 }}>Prendre cet emplacement</button>
      )}
      {loc.canReopen && (
        <button onClick={reopen} style={{ ...bigBtn(C.white, C.dark), border: `2px solid ${C.greyB}`, width: '100%' }}>
          Rouvrir pour corriger
        </button>
      )}
      {loc.canCount && (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, fontSize: 14, color: C.greyT, alignSelf: 'center' }}>
            Scannez chaque article, ou touchez la ligne pour saisir.
          </div>
          <button onClick={() => setTyping(true)} style={smallBtn}>Saisir un code</button>
          <CameraButton onClick={onCamera} />
        </div>
      )}

      {loc.lines.map(l => {
        const done = l.qty != null;
        const isLast = l.productId === lastId;
        return (
          <button
            key={l.productId}
            onClick={() => loc.canCount && setEdit(l)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 10,
              borderRadius: 12, fontFamily: 'inherit', color: C.dark,
              border: `${isLast ? 3 : 1}px solid ${isLast ? BLUE : (done ? C.green : C.greyB)}`,
              background: done ? (l.qty === 0 ? C.grey : C.greenL) : C.white,
            }}
          >
            <Photo url={l.imageUrl} size={56} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.25 }}>{l.name}</div>
              <div style={{ fontSize: 13, color: C.greyT }}>
                {l.sku}{l.brand ? ` · ${l.brand}` : ''}{!l.hasBarcode && ' · sans code-barres'}
              </div>
              {!l.expected && (
                <div style={{ fontSize: 13, fontWeight: 800, color: C.amber }}>
                  Trouvé ici{l.expectedLocation && l.expectedLocation !== loc.location ? ` (prévu en ${l.expectedLocation})` : ''}
                </div>
              )}
            </div>
            <div style={{ fontSize: done ? 30 : 15, fontWeight: 900, color: done ? (l.qty === 0 ? C.greyT : C.dark) : C.greyM, minWidth: 54, textAlign: 'right' }}>
              {done ? (l.qty === 0 ? 'Absent' : l.qty) : 'à compter'}
            </div>
          </button>
        );
      })}

      {loc.canCount && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, background: C.white, borderTop: `1px solid ${C.greyB}`, zIndex: 20 }}>
          <button onClick={close} disabled={left > 0} style={{ ...bigBtn(left > 0 ? C.greyB : C.green, left > 0 ? C.greyT : C.white), width: '100%', fontSize: 19 }}>
            {left > 0 ? `Encore ${left} réf${left > 1 ? 's' : ''} à compter` : 'Terminer l\'emplacement'}
          </button>
        </div>
      )}

      {edit && (
        <QtySheet
          title={edit.name}
          subtitle={edit.sku}
          initial={edit.qty}
          onSave={(n) => saveQty(edit, n)}
          onClose={() => setEdit(null)}
          extra={(
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {edit.expected && (
                <button onClick={() => saveQty(edit, 0)} style={{ ...bigBtn(C.white, C.dark), border: `2px solid ${C.greyB}` }}>
                  Absent (0)
                </button>
              )}
              {!edit.expected && (
                <button onClick={() => remove(edit)} style={{ ...bigBtn(C.redL, C.red) }}>
                  Retirer de cet emplacement
                </button>
              )}
            </div>
          )}
        />
      )}

      {typing && (
        <CodeSheet onClose={() => setTyping(false)} onCode={(code) => { setTyping(false); scan(code); }} />
      )}

      {ask?.kind === 'pack' && (
        <Sheet title="Carton inconnu" onClose={() => setAsk(null)}>
          <p style={{ fontSize: 16, marginTop: 0 }}>{ask.message}</p>
          <form onSubmit={(e) => { e.preventDefault(); confirmPack(); }}>
            <input autoFocus type="number" inputMode="numeric" min="2" value={packQty}
              onChange={(e) => setPackQty(e.target.value)} style={input} />
            <button type="submit" disabled={!(Number(packQty) >= 2)} style={{ ...bigBtn(BLUE), width: '100%', marginTop: 12 }}>
              Enregistrer et compter
            </button>
          </form>
        </Sheet>
      )}
      {ask?.kind === 'choice' && (
        <Sheet title="Quel produit ?" onClose={() => setAsk(null)}>
          <div style={{ display: 'grid', gap: 8 }}>
            {ask.choices.map(c => (
              <button key={c.productId} onClick={() => { setAsk(null); scan(ask.code, c.productId); }}
                style={{ ...smallBtn, textAlign: 'left', fontSize: 16, padding: 14 }}>
                {c.name}<div style={{ fontSize: 13, color: C.greyT, fontWeight: 600 }}>{c.sku}</div>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Code tapé à la main (SKU, code-barres illisible). */
function CodeSheet({ onCode, onClose }) {
  const [value, setValue] = useState('');
  return (
    <Sheet title="Saisir un code" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onCode(value.trim()); }}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="SKU ou code-barres"
          style={{ ...input, fontSize: 20, fontWeight: 600 }} />
        <button type="submit" disabled={!value.trim()} style={{ ...bigBtn(BLUE), width: '100%', marginTop: 12 }}>Compter</button>
      </form>
    </Sheet>
  );
}

// ── Écran 3 : à recompter ───────────────────────────────────────────────────

function RecountList({ token, onOpen, showFlash }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    api(token).get('/recounts').then(d => setList(d.recounts)).catch(err => showFlash('error', errorText(err)));
  }, [token, showFlash]);

  if (!list) return <p style={{ color: C.greyT, padding: 20 }}>Chargement…</p>;
  return (
    <div style={{ padding: 14, display: 'grid', gap: 10 }}>
      <p style={{ margin: 0, color: C.greyT, fontSize: 14 }}>
        Ces produits ont un écart trop fort : on les recompte en entier, dans tous leurs emplacements.
      </p>
      {list.length === 0 && <p style={{ color: C.greyT, textAlign: 'center', padding: 20 }}>Plus rien à recompter.</p>}
      {list.map(r => (
        <button key={r.id} onClick={() => !r.locked && onOpen(r.id)} disabled={r.locked} style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 10,
          borderRadius: 12, border: `2px solid ${r.mine ? BLUE : C.greyB}`, background: r.locked ? C.grey : C.white,
          fontFamily: 'inherit', color: C.dark, opacity: r.locked ? 0.7 : 1,
        }}>
          <Photo url={r.imageUrl} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{r.name}</div>
            <div style={{ fontSize: 13, color: C.greyT }}>{r.locations.map(locLabel).join(' · ')}</div>
          </div>
          {r.lockedBy && (
            <span style={{ fontSize: 13, fontWeight: 700, color: r.mine ? BLUE : C.amber }}>{r.mine ? 'À vous' : `Par ${r.lockedBy}`}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function RecountScreen({ token, itemId, onDone, showFlash, onScanRef, onCamera }) {
  const [r, setR] = useState(null);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [packAsk, setPackAsk] = useState(null);
  const [packQty, setPackQty] = useState('');

  const load = useCallback(async () => {
    try {
      setR(await api(token).get(`/recounts/${itemId}`));
    } catch (err) {
      showFlash('error', errorText(err));
      onDone();
    }
  }, [token, itemId, showFlash, onDone]);
  useEffect(() => { load(); }, [load]);

  const fail = (err) => { beep(false); showFlash('error', errorText(err)); };

  const scan = async (code) => {
    if (!r?.mine) { beep(false); showFlash('error', 'Prenez ce recomptage avant de compter.'); return; }
    try {
      const data = await api(token).post(`/recounts/${itemId}/scan`, { code });
      setR(data);
      beep(true);
      showFlash('ok', `+${data.scanned.qty} → ${data.qty}`);
    } catch (err) {
      const d = err.response?.data;
      if (d?.code === 'PACK_QTY_UNKNOWN') {
        beep(false);
        setPackQty('');
        setPackAsk({ code: d.barcode, productId: d.productId, message: d.error });
      } else fail(err);
    }
  };
  onScanRef.current = (code) => { if (!edit && !confirm && !packAsk) scan(code); };

  const take = async () => { try { setR(await api(token).post(`/recounts/${itemId}/take`)); } catch (err) { fail(err); } };
  const save = async (qty) => {
    setEdit(false);
    try { setR(await api(token).put(`/recounts/${itemId}`, { qty })); } catch (err) { fail(err); }
  };
  const finish = async () => {
    setConfirm(false);
    try {
      await api(token).post(`/recounts/${itemId}/finish`);
      showFlash('ok', 'Recomptage enregistré.');
      onDone();
    } catch (err) { fail(err); }
  };
  const confirmPack = async () => {
    const a = packAsk;
    setPackAsk(null);
    try {
      await api(token).post('/pack-quantity', { code: a.code, productId: a.productId, quantity: packQty });
      await scan(a.code);
    } catch (err) { fail(err); }
  };

  if (!r) return <p style={{ color: C.greyT, padding: 20 }}>Chargement…</p>;
  return (
    <div style={{ padding: 14, display: 'grid', gap: 12 }}>
      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Photo url={r.imageUrl} size={96} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 900, fontSize: 17 }}>{r.name}</div>
          <div style={{ fontSize: 14, color: C.greyT }}>{r.sku}{r.brand ? ` · ${r.brand}` : ''}</div>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.greyT, textTransform: 'uppercase' }}>Cherchez-le en</div>
        <div style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 22, marginTop: 4 }}>
          {r.locations.map(locLabel).join('  ·  ')}
        </div>
      </div>

      {!r.mine && (
        <button onClick={take} style={{ ...bigBtn(BLUE), width: '100%', fontSize: 20 }}>Je le recompte</button>
      )}
      {r.mine && (
        <>
          <div style={{ ...card, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: C.greyT }}>Compté jusqu'ici, tous emplacements</div>
            <div style={{ fontSize: 56, fontWeight: 900 }}>{r.qty ?? 0}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setEdit(true)} style={{ ...smallBtn, flex: 1, fontSize: 16, padding: 14 }}>Saisir la quantité</button>
            <CameraButton onClick={onCamera} />
          </div>
          <button onClick={() => setConfirm(true)} style={{ ...bigBtn(C.green), width: '100%', fontSize: 19 }}>
            Valider le recomptage
          </button>
        </>
      )}

      {edit && <QtySheet title="Quantité totale" subtitle={r.name} initial={r.qty} onSave={save} onClose={() => setEdit(false)} />}
      {confirm && (
        <Sheet title="Valider le recomptage" onClose={() => setConfirm(false)}>
          <p style={{ fontSize: 16, marginTop: 0 }}>
            <strong>{r.qty ?? 0}</strong> pièce(s) au total, tous emplacements confondus. Ce chiffre fera foi.
          </p>
          <button onClick={finish} style={{ ...bigBtn(C.green), width: '100%', fontSize: 19 }}>Valider</button>
        </Sheet>
      )}
      {packAsk && (
        <Sheet title="Carton inconnu" onClose={() => setPackAsk(null)}>
          <p style={{ fontSize: 16, marginTop: 0 }}>{packAsk.message}</p>
          <form onSubmit={(e) => { e.preventDefault(); confirmPack(); }}>
            <input autoFocus type="number" inputMode="numeric" min="2" value={packQty}
              onChange={(e) => setPackQty(e.target.value)} style={input} />
            <button type="submit" disabled={!(Number(packQty) >= 2)} style={{ ...bigBtn(BLUE), width: '100%', marginTop: 12 }}>
              Enregistrer et compter
            </button>
          </form>
        </Sheet>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function PdaInventaire() {
  const { token, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [screen, setScreen] = useState({ kind: 'home' });
  const [data, setData] = useState(null);
  const [flash, setFlash] = useState(null);
  const [camera, setCamera] = useState(false);
  const onScanRef = useRef(null);
  onUnauthorized = logout;

  const showFlash = useCallback((kind, text) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash(f => (f?.text === text ? null : f)), kind === 'ok' ? 1200 : 3500);
  }, []);

  const reload = useCallback(async () => {
    try {
      setData(await api(token).get('/current'));
    } catch (err) {
      showFlash('error', errorText(err));
    }
  }, [token, showFlash]);

  useEffect(() => {
    if (screen.kind !== 'home') return undefined;
    reload();
    const t = setInterval(reload, 20000);
    return () => clearInterval(t);
  }, [screen.kind, reload]);

  useScanner((code) => onScanRef.current?.(code), !camera);

  const onCameraCode = useCallback((code) => {
    setCamera(false);
    onScanRef.current?.(code);
  }, []);
  const openCamera = useCallback(() => setCamera(true), []);
  const home = useCallback(() => setScreen({ kind: 'home' }), []);
  const recounts = useCallback(() => setScreen({ kind: 'recounts' }), []);

  // Un bouton touché garde le focus : l'Entrée du scan suivant le
  // « cliquerait » à nouveau. On le lâche aussitôt.
  const releaseButton = () => {
    if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
  };

  const back = {
    home: [() => navigate('/pda'), 'Accueil'],
    location: [home, 'Emplacements'],
    recounts: [home, 'Emplacements'],
    recount: [recounts, 'À recompter'],
  }[screen.kind];

  if (screen.kind === 'recounts') onScanRef.current = null;

  return (
    <PdaLayout title="Inventaire" onBack={back[0]} backLabel={back[1]}>
      <div onClick={releaseButton}>
        {screen.kind === 'home' && (
          <HomeScreen
            token={token} data={data} reload={reload} showFlash={showFlash} onScanRef={onScanRef} onCamera={openCamera}
            onOpenLocation={(id) => setScreen({ kind: 'location', id })} onRecounts={recounts}
          />
        )}
        {screen.kind === 'location' && (
          <LocationScreen
            key={screen.id} token={token} locationId={screen.id} onDone={home}
            showFlash={showFlash} onScanRef={onScanRef} onCamera={openCamera}
          />
        )}
        {screen.kind === 'recounts' && (
          <RecountList token={token} showFlash={showFlash} onOpen={(id) => setScreen({ kind: 'recount', id })} />
        )}
        {screen.kind === 'recount' && (
          <RecountScreen
            key={screen.id} token={token} itemId={screen.id} onDone={recounts}
            showFlash={showFlash} onScanRef={onScanRef} onCamera={openCamera}
          />
        )}
      </div>

      {camera && <CameraScanner onDetect={onCameraCode} onClose={() => setCamera(false)} />}

      {flash && (
        <div style={{
          position: 'fixed', left: 12, right: 12, bottom: 90, zIndex: 40, padding: '14px 16px', borderRadius: 12,
          background: flash.kind === 'ok' ? C.green : C.red, color: C.white, fontWeight: 800, fontSize: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}>{flash.text}</div>
      )}
    </PdaLayout>
  );
}
