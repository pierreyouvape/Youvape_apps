import { useCallback, useEffect, useRef, useState } from 'react';
import { C } from '../picking/pickingUi';
import { pdaBtn as bigBtn } from '../pda/pdaStyles';
import { beep } from '../pda/pdaScan';
import { api, errorText, BLUE, card, smallBtn, input } from './pdaInventoryApi';
import { Photo, CameraButton, Sheet, QtySheet, CodeSheet } from './pdaInventoryUi';

/**
 * Inventaire PAR EMPLACEMENT au PDA (04/11/2026, validé avec Pierre).
 *
 *   - on scanne l'étiquette d'un emplacement : la liste de ses produits
 *     s'affiche avec leur quantité (physique BMS − prélevé), qu'on corrige en
 *     absolu ;
 *   - un produit avec du stock doit être VU (scanné, ou quantité saisie) ;
 *     les produits à 0, grisés en bas, restent à 0 si on n'y touche pas ;
 *   - un produit trouvé ici et rangé ailleurs s'ajoute : sa quantité devient
 *     son stock total, et il est rangé ici ;
 *   - « Valider » : pour chaque produit attendu non vu, « Quantité 0 » ou
 *     « Rangé ailleurs » (scan du nouvel emplacement). Tout part alors dans BMS.
 */

const fmtTime = (iso) => {
  if (!iso) return '';
  let s = String(iso).replace(' ', 'T').split('.')[0];
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  return new Date(s).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
};

// ── Accueil du dossier ──────────────────────────────────────────────────────

export function SpotHome({ token, inventory, onChange, onOpenPass, showFlash, onScanRef, onCamera }) {
  const [data, setData] = useState(null);
  const [typing, setTyping] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api(token).get(`/spot/${inventory.id}`));
    } catch (err) {
      showFlash('error', errorText(err));
    }
  }, [token, inventory.id, showFlash]);
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const open = async (code) => {
    try {
      const pass = await api(token).post(`/spot/${inventory.id}/passes`, { code });
      beep(true);
      onOpenPass(pass.id);
    } catch (err) {
      beep(false);
      showFlash('error', errorText(err));
    }
  };
  onScanRef.current = (code) => { if (!typing) open(code); };

  const counting = (data?.passes || []).filter(p => p.status === 'counting');
  const validated = (data?.passes || []).filter(p => p.status === 'validated');

  return (
    <div style={{ padding: 14, display: 'grid', gap: 12 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 18, flex: 1 }}>{inventory.name}</div>
          <button onClick={onChange} style={{ ...smallBtn, fontSize: 13, padding: '6px 10px' }}>Changer</button>
        </div>
        <div style={{ fontSize: 15, color: C.greyT, marginTop: 6 }}>
          Par emplacement · {data ? `${data.validated} emplacement(s) validé(s)` : '…'}
        </div>
      </div>

      <div style={{ ...card, textAlign: 'center', border: `2px dashed ${BLUE}` }}>
        <div style={{ fontWeight: 900, fontSize: 19, color: BLUE }}>Scannez l'étiquette d'un emplacement</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <button onClick={() => setTyping(true)} style={smallBtn}>Saisir l'emplacement</button>
          <CameraButton onClick={onCamera} />
        </div>
      </div>

      {counting.length > 0 && (
        <div>
          <div style={{ fontWeight: 900, fontSize: 14, color: C.greyT, margin: '4px 2px 6px', textTransform: 'uppercase' }}>En cours</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {counting.map(p => (
              <button key={p.id} onClick={() => p.mine && onOpenPass(p.id)} disabled={!p.mine} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 12,
                borderRadius: 12, border: `2px solid ${p.mine ? BLUE : C.greyB}`, background: p.mine ? C.white : C.grey,
                fontFamily: 'inherit', color: C.dark,
              }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 20, flex: 1 }}>{p.location}</span>
                <span style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 13, fontWeight: 700,
                  background: p.mine ? BLUE : C.amberL, color: p.mine ? C.white : C.amber,
                }}>{p.mine ? 'À vous' : `Par ${p.startedBy}`}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {validated.length > 0 && (
        <div>
          <div style={{ fontWeight: 900, fontSize: 14, color: C.greyT, margin: '4px 2px 6px', textTransform: 'uppercase' }}>Validés aujourd'hui</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {validated.map(p => (
              <button key={p.id} onClick={() => onOpenPass(p.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 12,
                borderRadius: 12, border: `1px solid ${C.greyB}`, background: C.white, fontFamily: 'inherit', color: C.dark,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 18 }}>{p.location}</div>
                  <div style={{ fontSize: 13, color: C.greyT }}>{p.validatedBy} · {fmtTime(p.validatedAt)}</div>
                </div>
                <span style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 13, fontWeight: 700,
                  background: p.errors ? C.redL : p.sending ? C.blueL : C.greenL,
                  color: p.errors ? C.red : p.sending ? C.blue : C.green,
                }}>
                  {p.errors ? `${p.errors} erreur(s) BMS` : p.sending ? 'Envoi BMS…' : 'Envoyé'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {typing && (
        <CodeSheet
          title="Emplacement" placeholder="ex. E 2-2" label="Ouvrir"
          onClose={() => setTyping(false)} onCode={(code) => { setTyping(false); open(code); }}
        />
      )}
    </div>
  );
}

// ── Un emplacement ──────────────────────────────────────────────────────────

const Badge = ({ color, bg, children }) => (
  <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 12, fontWeight: 800, color, background: bg, marginRight: 4 }}>
    {children}
  </span>
);

const PUSH = {
  queued: ['Envoi BMS…', C.blue, C.blueL],
  sending: ['Envoi BMS…', C.blue, C.blueL],
  sent: ['Envoyé', C.green, C.greenL],
  error: ['Erreur BMS', C.red, C.redL],
  ignored: ['Laissé tombé', C.greyT, C.grey],
};

/** Ce que la ligne affiche à droite : la quantité retenue, ou celle de BMS en attendant. */
function LineQty({ l }) {
  if (l.outcome === 'moved') {
    return <div style={{ fontSize: 13, fontWeight: 800, color: C.amber, textAlign: 'right' }}>Rangé en<br />{l.movedTo}</div>;
  }
  if (l.seen) {
    const changed = l.shownQty != null && l.qty !== l.shownQty;
    return (
      <div style={{ textAlign: 'right', minWidth: 56 }}>
        <div style={{ fontSize: 30, fontWeight: 900, color: l.qty === 0 ? C.red : C.dark }}>{l.qty}</div>
        {changed && <div style={{ fontSize: 12, color: C.greyT }}>BMS {l.shownQty}</div>}
      </div>
    );
  }
  if (l.reading) return <div style={{ fontSize: 13, color: C.greyM }}>lecture…</div>;
  if (l.refError || l.lockedBy) return <div style={{ fontSize: 13, color: C.greyM }}>—</div>;
  return (
    <div style={{ textAlign: 'right', minWidth: 56 }}>
      <div style={{ fontSize: 26, fontWeight: 900, color: C.greyM }}>{l.shownQty}</div>
      <div style={{ fontSize: 12, color: C.greyM }}>{l.mustSee ? 'à voir' : ''}</div>
    </div>
  );
}

export function SpotPassScreen({ token, passId, onDone, showFlash, onScanRef, onCamera }) {
  const [pass, setPass] = useState(null);
  const [edit, setEdit] = useState(null);         // ligne dont on saisit la quantité
  const [ask, setAsk] = useState(null);           // { kind: 'choice' | 'add' | 'waitAdd' | 'move' | 'unseen' | 'abandon', ... }
  const [addQty, setAddQty] = useState('');
  const [typing, setTyping] = useState(null);     // 'product' | 'location'
  const [lastId, setLastId] = useState(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    try {
      setPass(await api(token).get(`/spot-passes/${passId}`));
    } catch (err) {
      showFlash('error', errorText(err));
      onDone();
    }
  }, [token, passId, showFlash, onDone]);
  useEffect(() => { load(); }, [load]);

  // Les quantités BMS arrivent au fil des relevés : on relit tant qu'il en manque.
  const reading = pass?.reading > 0;
  useEffect(() => {
    if (!reading) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [reading, load]);

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

  const scanProduct = async (code, productId) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const data = await api(token).post(`/spot-passes/${passId}/scan`, { code, productId });
      setPass(data);
      setAsk(null);
      setLastId(data.scanned.lineId);
      beep(true);
      const l = data.lines.find(x => x.id === data.scanned.lineId);
      showFlash('ok', `Vu : ${l?.name || ''}${l?.qty != null ? ` (${l.qty})` : ''}`);
    } catch (err) {
      beep(false);
      const d = err.response?.data;
      if (d?.code === 'AMBIGUOUS') setAsk({ kind: 'choice', code: d.barcode, choices: d.choices });
      else if (d?.code === 'NOT_HERE') { setAddQty(''); setAsk({ kind: 'add', product: d.product }); }
      else showFlash('error', errorText(err));
    } finally {
      busy.current = false;
    }
  };

  const move = (line, code) => run(async () => {
    setPass(await api(token).post(`/spot-passes/${passId}/lines/${line.id}/move`, { code }));
    beep(true);
    showFlash('ok', `${line.name} : rangé ailleurs.`);
    setAsk(a => (a?.kind === 'move' && a.back ? { kind: 'unseen' } : null));
  });

  onScanRef.current = (code) => {
    if (!pass?.canCount || edit || typing) return;
    if (ask?.kind === 'move') move(ask.line, code);
    else if (!ask || ask.kind === 'waitAdd') scanProduct(code);
  };

  const saveQty = (line, qty) => run(async () => {
    setEdit(null);
    setPass(await api(token).put(`/spot-passes/${passId}/lines/${line.id}`, { qty }));
    setLastId(line.id);
  });
  const remove = (line) => run(async () => {
    setEdit(null);
    setPass(await api(token).del(`/spot-passes/${passId}/lines/${line.id}`));
  });
  const add = () => run(async () => {
    const p = ask.product;
    const data = await api(token).post(`/spot-passes/${passId}/add`, { productId: p.productId, qty: Number(addQty) });
    setAsk(null);
    setPass(data);
    const l = data.lines.find(x => x.productId === p.productId);
    if (l) setLastId(l.id);
    showFlash('ok', `${p.name} ajouté ici.`);
  });
  const validate = () => run(async () => {
    try {
      const r = await api(token).post(`/spot-passes/${passId}/validate`);
      beep(true);
      showFlash('ok', `${r.location} validé : ${r.queued} ligne(s) envoyée(s) à BMS.`);
      onDone();
    } catch (err) {
      if (err.response?.data?.code !== 'UNSEEN') throw err;
      beep(false);
      await load();
      setAsk({ kind: 'unseen' });
    }
  });
  const abandon = () => run(async () => {
    await api(token).post(`/spot-passes/${passId}/abandon`);
    showFlash('ok', 'Emplacement abandonné : rien n\'a été envoyé.');
    onDone();
  });

  if (!pass) return <p style={{ color: C.greyT, padding: 20 }}>Chargement…</p>;

  const expected = pass.lines.filter(l => !l.added && !l.lockedBy && !l.refError && l.shownQty > 0);
  const seen = expected.filter(l => l.seen).length;
  const unseen = pass.lines.filter(l => l.mustSee);

  return (
    <div style={{ padding: 14, paddingBottom: 110, display: 'grid', gap: 10 }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 30 }}>{pass.location}</div>
          <div style={{ fontSize: 15, color: C.greyT }}>
            {pass.status === 'counting' && `${seen} / ${expected.length} vus`}
            {pass.status === 'validated' && `Validé par ${pass.validatedBy} à ${fmtTime(pass.validatedAt)}`}
            {pass.status === 'abandoned' && 'Abandonné'}
            {reading && ` · lecture BMS (${pass.reading})…`}
          </div>
        </div>
        {pass.canCount && (
          <button onClick={() => setAsk({ kind: 'abandon' })} style={{ ...smallBtn, fontSize: 13, padding: '6px 10px' }}>Abandonner</button>
        )}
      </div>

      {pass.status === 'counting' && !pass.canCount && (
        <p style={{ margin: 0, color: C.amber, fontWeight: 700 }}>En cours de comptage par {pass.startedBy}.</p>
      )}
      {pass.canCount && (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setAsk({ kind: 'waitAdd' })} style={{ ...bigBtn(BLUE), flex: 1, fontSize: 16, padding: 12 }}>
              Ajouter un produit
            </button>
            <button onClick={() => setTyping('product')} style={smallBtn}>Saisir un code</button>
            <CameraButton onClick={onCamera} />
          </div>
          <div style={{ fontSize: 14, color: C.greyT }}>
            Scannez chaque produit présent (il est vu à la quantité affichée), ou touchez la ligne pour corriger.
          </div>
        </>
      )}

      {pass.lines.length === 0 && (
        <p style={{ color: C.greyT, textAlign: 'center', padding: 20 }}>Aucun produit rangé ici.</p>
      )}
      {pass.lines.map(l => {
        const isLast = l.id === lastId;
        const dimmed = l.lockedBy || (!l.seen && !l.added && l.shownQty === 0);
        const push = l.pushStatus && PUSH[l.pushStatus];
        return (
          <button
            key={l.id}
            onClick={() => pass.canCount && !l.lockedBy && setEdit(l)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 10,
              borderRadius: 12, fontFamily: 'inherit', color: C.dark, opacity: dimmed ? 0.6 : 1,
              border: `${isLast ? 3 : 1}px solid ${isLast ? BLUE : (l.seen ? C.green : C.greyB)}`,
              background: l.seen ? (l.qty === 0 ? C.redL : C.greenL) : (dimmed ? C.grey : C.white),
            }}
          >
            <Photo url={l.imageUrl} size={56} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.25 }}>{l.name}</div>
              <div style={{ fontSize: 13, color: C.greyT }}>
                {l.sku}{l.brand ? ` · ${l.brand}` : ''}{!l.hasBarcode && ' · sans code-barres'}
              </div>
              <div style={{ marginTop: 2 }}>
                {l.notPublished && <Badge color={C.greyT} bg={C.greyB}>Non publié</Badge>}
                {l.added && <Badge color={C.amber} bg={C.amberL}>Trouvé ici{l.fromLocation ? ` (était en ${l.fromLocation})` : ''}</Badge>}
                {l.lockedBy && <Badge color={C.greyT} bg={C.greyB}>Inventaire « {l.lockedBy} »</Badge>}
                {l.refError && <Badge color={C.red} bg={C.redL}>{l.refError}</Badge>}
                {!l.added && l.bmsLocation && l.bmsLocation !== pass.location && (
                  <Badge color={C.amber} bg={C.amberL}>BMS : {l.bmsLocation}</Badge>
                )}
                {push && <Badge color={push[1]} bg={push[2]}>{push[0]}</Badge>}
              </div>
              {l.pushError && <div style={{ fontSize: 12, color: C.red }}>{l.pushError}</div>}
            </div>
            <LineQty l={l} />
          </button>
        );
      })}

      {pass.canCount && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, background: C.white, borderTop: `1px solid ${C.greyB}`, zIndex: 20 }}>
          <button onClick={validate} disabled={reading} style={{ ...bigBtn(reading ? C.greyB : C.green, reading ? C.greyT : C.white), width: '100%', fontSize: 19 }}>
            {reading ? 'Lecture du stock BMS…' : `Valider l'emplacement${unseen.length ? ` (${unseen.length} pas vu${unseen.length > 1 ? 's' : ''})` : ''}`}
          </button>
        </div>
      )}

      {edit && (
        <QtySheet
          title={edit.name}
          subtitle={`${edit.sku}${edit.shownQty != null ? ` · BMS : ${edit.shownQty}` : ''}`}
          initial={edit.qty ?? edit.shownQty}
          onSave={(n) => saveQty(edit, n)}
          onClose={() => setEdit(null)}
          extra={(
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              <button onClick={() => saveQty(edit, 0)} style={{ ...bigBtn(C.white, C.dark), border: `2px solid ${C.greyB}` }}>
                Il n'y en a plus (0)
              </button>
              {!edit.added && (
                <button onClick={() => { const line = edit; setEdit(null); setAsk({ kind: 'move', line }); }}
                  style={{ ...bigBtn(C.amberL, C.amber) }}>
                  Rangé ailleurs
                </button>
              )}
              {edit.added && (
                <button onClick={() => remove(edit)} style={{ ...bigBtn(C.redL, C.red) }}>Retirer de cet emplacement</button>
              )}
            </div>
          )}
        />
      )}

      {ask?.kind === 'waitAdd' && (
        <Sheet title="Ajouter un produit" onClose={() => setAsk(null)}>
          <p style={{ fontSize: 16, marginTop: 0 }}>Scannez le produit trouvé ici.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setTyping('product')} style={{ ...smallBtn, flex: 1 }}>Saisir un code</button>
            <CameraButton onClick={onCamera} />
          </div>
        </Sheet>
      )}

      {ask?.kind === 'add' && (
        <Sheet title="Ajouter ici ?" onClose={() => setAsk(null)}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <Photo url={ask.product.imageUrl} size={64} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{ask.product.name}</div>
              <div style={{ fontSize: 13, color: C.greyT }}>{ask.product.sku}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.amber, marginTop: 2 }}>
                {ask.product.location ? `Rangé en ${ask.product.location} dans BMS` : 'Sans emplacement dans BMS'}
              </div>
            </div>
          </div>
          <p style={{ fontSize: 14, color: C.greyT, marginTop: 0 }}>
            Il sera rangé en {pass.location}, et la quantité saisie deviendra son stock total.
          </p>
          <form onSubmit={(e) => { e.preventDefault(); if (Number(addQty) >= 1) add(); }}>
            <input autoFocus type="number" inputMode="numeric" min="1" value={addQty}
              onChange={(e) => setAddQty(e.target.value)} style={input} placeholder="Quantité" />
            <button type="submit" disabled={!(Number.isInteger(Number(addQty)) && Number(addQty) >= 1)}
              style={{ ...bigBtn(BLUE), width: '100%', marginTop: 12, fontSize: 19 }}>
              Ajouter en {pass.location}
            </button>
          </form>
        </Sheet>
      )}

      {ask?.kind === 'move' && (
        <Sheet title="Rangé ailleurs" onClose={() => setAsk(ask.back ? { kind: 'unseen' } : null)}>
          <p style={{ fontSize: 16, marginTop: 0 }}>
            <strong>{ask.line.name}</strong> : scannez l'étiquette de l'emplacement où il est rangé.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setTyping('location')} style={{ ...smallBtn, flex: 1 }}>Saisir l'emplacement</button>
            <CameraButton onClick={onCamera} />
          </div>
        </Sheet>
      )}

      {ask?.kind === 'unseen' && (
        <Sheet title="Produits pas vus" onClose={() => setAsk(null)}>
          {unseen.length === 0 ? (
            <button onClick={() => { setAsk(null); validate(); }} style={{ ...bigBtn(C.green), width: '100%', fontSize: 19 }}>
              Valider l'emplacement
            </button>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <p style={{ fontSize: 15, margin: 0, color: C.greyT }}>Ces produits devraient être ici. Pour chacun :</p>
              {unseen.map(l => (
                <div key={l.id} style={{ ...card, padding: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Photo url={l.imageUrl} size={48} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{l.name}</div>
                      <div style={{ fontSize: 13, color: C.greyT }}>{l.sku} · BMS : {l.shownQty}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => saveQty(l, 0)} style={{ ...bigBtn(C.white, C.dark), border: `2px solid ${C.greyB}`, flex: 1, fontSize: 15, padding: 10 }}>
                      Quantité 0
                    </button>
                    <button onClick={() => setAsk({ kind: 'move', line: l, back: true })} style={{ ...bigBtn(C.amberL, C.amber), flex: 1, fontSize: 15, padding: 10 }}>
                      Rangé ailleurs
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Sheet>
      )}

      {ask?.kind === 'abandon' && (
        <Sheet title="Abandonner l'emplacement" onClose={() => setAsk(null)}>
          <p style={{ fontSize: 16, marginTop: 0 }}>Rien ne sera envoyé à BMS. L'emplacement pourra être recompté.</p>
          <button onClick={abandon} style={{ ...bigBtn(C.red), width: '100%', fontSize: 19 }}>Abandonner</button>
        </Sheet>
      )}

      {ask?.kind === 'choice' && (
        <Sheet title="Quel produit ?" onClose={() => setAsk(null)}>
          <div style={{ display: 'grid', gap: 8 }}>
            {ask.choices.map(c => (
              <button key={c.productId} onClick={() => scanProduct(ask.code, c.productId)}
                style={{ ...smallBtn, textAlign: 'left', fontSize: 16, padding: 14 }}>
                {c.name}<div style={{ fontSize: 13, color: C.greyT, fontWeight: 600 }}>{c.sku}</div>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {typing === 'product' && (
        <CodeSheet label="Valider" onClose={() => setTyping(null)} onCode={(code) => { setTyping(null); scanProduct(code); }} />
      )}
      {typing === 'location' && ask?.kind === 'move' && (
        <CodeSheet
          title="Emplacement" placeholder="ex. E 2-2" label="Ranger ici"
          onClose={() => setTyping(null)} onCode={(code) => { setTyping(null); move(ask.line, code); }}
        />
      )}
    </div>
  );
}
