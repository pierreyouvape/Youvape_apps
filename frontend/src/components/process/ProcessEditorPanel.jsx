import { useState, useRef, useCallback } from 'react';
import axios from 'axios';
import ProcessEditor from './ProcessEditor';
import { API_URL, C, STATUSES, CALLOUTS } from './processConstants';

const inputStyle = {
  padding: '9px 12px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
  fontSize: 13.5, color: C.grisTF, outline: 'none', background: C.blanc, width: '100%',
  boxSizing: 'border-box', fontFamily: 'inherit',
};

const iconBtn = (disabled) => ({
  width: 28, height: 28, border: `1px solid ${C.grisCL}`, background: C.blanc,
  borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
  color: disabled ? C.grisCL : C.grisF, fontSize: 13, lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});

// crypto.randomUUID n'existe qu'en contexte sécurisé (https / localhost) :
// repli sur un compteur, l'identifiant ne sert qu'au rendu React.
let uidSeq = 0;
const newUid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `blk-${++uidSeq}`);

/** Bloc vierge, forme commune à une étape et à une sous-étape. */
const emptyBlock = () => ({ _uid: newUid(), title: '', body: '', callout: null, images: [] });

/** Bloc venant du serveur → forme éditable (identité stable ajoutée). */
const toEditable = (b) => ({
  _uid: newUid(),
  title: b?.title || '',
  body: b?.body || '',
  callout: b?.callout || null,
  images: Array.isArray(b?.images) ? b.images : [],
});

/* ─── Bande photo éditable ──────────────────────────────────────────────── */
function StepImageEditor({ images, onChange, onUpload, uploading }) {
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const pickFiles = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    // Lambda explicite : forEach passerait l'index en 2e argument, que
    // onUpload interprète comme l'indice de sous-étape.
    files.forEach((f) => onUpload(f));
  };

  const setCaption = (i, caption) =>
    onChange(images.map((img, k) => (k === i ? { ...img, caption } : img)));

  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  // On retire seulement la référence : le fichier reste sur le serveur, car les
  // versions précédentes de ce process le montrent encore.
  const remove = (i) => onChange(images.filter((_, k) => k !== i));

  return (
    <div style={{ marginTop: 12 }}>
      {images.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, marginBottom: 10 }}>
          {images.map((img, i) => (
            <div key={img.url || i} style={{ border: `1px solid ${C.grisCL}`, borderRadius: 8, overflow: 'hidden', background: C.blanc }}>
              <img
                src={img.url} alt={img.original_name || ''}
                style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block', background: C.grisTL }}
              />
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  value={img.caption || ''}
                  onChange={(e) => setCaption(i, e.target.value)}
                  placeholder="Légende (facultatif)"
                  style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}
                />
                <div style={{ display: 'flex', gap: 5 }}>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Reculer" style={iconBtn(i === 0)}>←</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === images.length - 1} title="Avancer" style={iconBtn(i === images.length - 1)}>→</button>
                  <div style={{ flex: 1 }} />
                  <button type="button" onClick={() => remove(i)} title="Retirer du bloc"
                    style={{ ...iconBtn(false), color: C.rouge, borderColor: '#F5C6C6' }}>×</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFiles(e.dataTransfer.files); }}
        style={{
          border: `1px dashed ${dragOver ? C.process : C.grisCL}`,
          background: dragOver ? C.processL : C.grisTL,
          borderRadius: 8, padding: '10px 14px', textAlign: 'center', cursor: 'pointer',
          fontSize: 12.5, color: dragOver ? C.processF : C.grisM,
        }}
      >
        {uploading
          ? 'Envoi de l\'image…'
          : 'Ajouter une photo — cliquez, déposez, ou collez une capture (Cmd+V) dans le texte'}
        <input
          ref={fileRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}

/* ─── Corps d'un bloc : texte riche, encadré, photos ────────────────────── */
/**
 * Partagé par les étapes et les sous-étapes. C'est ce partage qui garantit
 * qu'une sous-étape offre exactement les mêmes possibilités qu'une étape —
 * sans quoi on finirait par en manquer une des deux côtés.
 */
function BlockEditor({ block, onPatch, onUpload, uploading, placeholder }) {
  return (
    <>
      <ProcessEditor
        value={block.body || ''}
        onChange={(html) => onPatch({ body: html })}
        placeholder={placeholder}
        onPasteImage={onUpload}
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.grisM, marginRight: 4 }}>Encadré :</span>
        <button
          type="button" onClick={() => onPatch({ callout: null })}
          style={{
            padding: '5px 11px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${!block.callout ? C.grisF : C.grisCL}`,
            background: !block.callout ? C.grisF : C.blanc,
            color: !block.callout ? '#fff' : C.grisF,
          }}
        >
          Aucun
        </button>
        {CALLOUTS.map((co) => {
          const active = block.callout === co.code;
          return (
            <button
              key={co.code} type="button" onClick={() => onPatch({ callout: active ? null : co.code })}
              style={{
                padding: '5px 11px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${active ? co.color : C.grisCL}`,
                background: active ? co.color : C.blanc,
                color: active ? '#fff' : C.grisF,
              }}
            >
              {co.icon} {co.label}
            </button>
          );
        })}
      </div>

      <StepImageEditor
        images={block.images || []}
        onChange={(images) => onPatch({ images })}
        onUpload={onUpload}
        uploading={uploading}
      />
    </>
  );
}

/* ─── Une sous-étape ────────────────────────────────────────────────────── */
function SubStepCard({ sub, stepNumber, index, total, onPatch, onMove, onRemove, onUpload, uploading }) {
  return (
    <div style={{
      marginTop: 12, paddingLeft: 14,
      borderLeft: `2px solid ${C.grisCL}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.process, flexShrink: 0, minWidth: 26 }}>
          {stepNumber}.{index + 1}
        </span>
        <input
          value={sub.title || ''}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder={`Titre de la sous-étape ${stepNumber}.${index + 1}`}
          style={{ ...inputStyle, fontWeight: 600, flex: 1, fontSize: 13 }}
        />
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} title="Monter" style={iconBtn(index === 0)}>↑</button>
        <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} title="Descendre" style={iconBtn(index === total - 1)}>↓</button>
        <button type="button" onClick={onRemove} title="Supprimer la sous-étape"
          style={{ ...iconBtn(false), color: C.rouge, borderColor: '#F5C6C6' }}>×</button>
      </div>

      <BlockEditor
        block={sub}
        onPatch={onPatch}
        onUpload={onUpload}
        uploading={uploading}
        placeholder="Ce point précis, avec la ou les captures qui l'illustrent."
      />
    </div>
  );
}

/* ─── Une étape ─────────────────────────────────────────────────────────── */
function StepCard({
  step, index, total, onPatch, onMove, onRemove, onUpload, uploading,
  onSubPatch, onSubMove, onSubRemove, onSubAdd, uploadingSub,
}) {
  const subs = step.substeps || [];
  return (
    <div style={{
      background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 12,
      padding: 16, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{
          width: 28, height: 28, borderRadius: '50%', background: C.process, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0,
        }}>
          {index + 1}
        </span>
        <input
          value={step.title || ''}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder={`Titre de l'étape ${index + 1}`}
          style={{ ...inputStyle, fontWeight: 700, flex: 1 }}
        />
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} title="Monter" style={iconBtn(index === 0)}>↑</button>
        <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} title="Descendre" style={iconBtn(index === total - 1)}>↓</button>
        <button type="button" onClick={onRemove} title="Supprimer l'étape"
          style={{ ...iconBtn(false), color: C.rouge, borderColor: '#F5C6C6' }}>×</button>
      </div>

      <BlockEditor
        block={step}
        onPatch={onPatch}
        onUpload={onUpload}
        uploading={uploading}
        placeholder="Ce qu'il faut faire. Découpez en sous-étapes si plusieurs captures sont nécessaires."
      />

      {subs.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: 11.5, fontWeight: 800, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 4px' }}>
            Sous-étapes
          </p>
          {subs.map((sub, j) => (
            <SubStepCard
              key={sub._uid}
              sub={sub} stepNumber={index + 1} index={j} total={subs.length}
              onPatch={(patch) => onSubPatch(j, patch)}
              onMove={(delta) => onSubMove(j, delta)}
              onRemove={() => onSubRemove(j)}
              onUpload={(file) => onUpload(file, j)}
              uploading={uploadingSub === j}
            />
          ))}
        </div>
      )}

      <button
        type="button" onClick={onSubAdd}
        style={{
          marginTop: 12, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
          border: `1px dashed ${C.grisCL}`, background: C.grisTL,
          color: C.process, fontWeight: 700, fontSize: 12.5,
        }}
      >
        + Ajouter une sous-étape
      </button>
    </div>
  );
}

/* ─── Panneau d'édition ─────────────────────────────────────────────────── */
export default function ProcessEditorPanel({ process, categories, onSave, onCancel, saving }) {
  const [title, setTitle] = useState(process.title || '');
  const [summary, setSummary] = useState(process.summary || '');
  const [categoryId, setCategoryId] = useState(process.category_id ? String(process.category_id) : '');
  const [status, setStatus] = useState(process.status || 'draft');
  const [changeNote, setChangeNote] = useState('');

  // _uid : identité stable côté client, pour que React ne recycle pas
  // l'instance Tiptap d'un bloc voisin lors d'un déplacement ou d'une
  // suppression. Le backend ignore ce champ.
  const [steps, setSteps] = useState(() =>
    (process.steps || []).map((s) => ({
      ...toEditable(s),
      substeps: Array.isArray(s.substeps) ? s.substeps.map(toEditable) : [],
    }))
  );

  // Cible de l'upload en cours : { step, sub } — sub vaut null pour l'étape.
  const [uploadTarget, setUploadTarget] = useState(null);

  /* ─── Étapes ─────────────────────────────────────────────────────────── */
  const patchStep = (i, patch) =>
    setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  const moveStep = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const removeStep = (i) => {
    const subCount = (steps[i]?.substeps || []).length;
    const warn = subCount > 0 ? ` et ses ${subCount} sous-étape${subCount > 1 ? 's' : ''}` : '';
    if (!window.confirm(`Supprimer l'étape ${i + 1}${warn} ?`)) return;
    setSteps((prev) => prev.filter((_, k) => k !== i));
  };

  const addStep = () =>
    setSteps((prev) => [...prev, { ...emptyBlock(), substeps: [] }]);

  /* ─── Sous-étapes ────────────────────────────────────────────────────── */
  const updateSubs = (i, fn) =>
    setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, substeps: fn(s.substeps || []) } : s)));

  const patchSub = (i, j, patch) =>
    updateSubs(i, (subs) => subs.map((sub, k) => (k === j ? { ...sub, ...patch } : sub)));

  const moveSub = (i, j, delta) =>
    updateSubs(i, (subs) => {
      const t = j + delta;
      if (t < 0 || t >= subs.length) return subs;
      const next = [...subs];
      [next[j], next[t]] = [next[t], next[j]];
      return next;
    });

  const removeSub = (i, j) => {
    if (!window.confirm(`Supprimer la sous-étape ${i + 1}.${j + 1} ?`)) return;
    updateSubs(i, (subs) => subs.filter((_, k) => k !== j));
  };

  const addSub = (i) => updateSubs(i, (subs) => [...subs, emptyBlock()]);

  /* ─── Photos ─────────────────────────────────────────────────────────── */
  // Upload immédiat : le fichier part sur le serveur dès qu'il est choisi, et
  // c'est l'URL renvoyée qu'on stocke dans le bloc. L'enregistrement du process
  // ne transporte donc jamais de binaire.
  const uploadImage = useCallback(async (stepIndex, subIndex, file) => {
    setUploadTarget({ step: stepIndex, sub: subIndex });
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await axios.post(`${API_URL}/process/${process.id}/images`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const image = res.data.data;

      setSteps((prev) => prev.map((s, k) => {
        if (k !== stepIndex) return s;
        if (subIndex === null) return { ...s, images: [...(s.images || []), image] };
        return {
          ...s,
          substeps: (s.substeps || []).map((sub, m) =>
            (m === subIndex ? { ...sub, images: [...(sub.images || []), image] } : sub)),
        };
      }));
    } catch (err) {
      alert(err.response?.data?.error || "L'envoi de l'image a échoué");
    } finally {
      setUploadTarget(null);
    }
  }, [process.id]);

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      summary: summary.trim() || null,
      category_id: categoryId || null,
      status,
      steps,
      change_note: changeNote.trim() || null,
    });
  };

  return (
    <form onSubmit={submit} style={{ maxWidth: 900 }}>

      {/* Entête du process */}
      <div style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 12, padding: 18, marginBottom: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.grisF }}>Titre</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, fontSize: 16, fontWeight: 700 }} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.grisF }}>Résumé</span>
            <textarea
              value={summary} onChange={(e) => setSummary(e.target.value)} rows={2}
              placeholder="À quoi sert cette procédure, et quand l'applique-t-on ?"
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </label>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 200px' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.grisF }}>Catégorie</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={inputStyle}>
                <option value="">Sans catégorie</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 200px' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.grisF }}>Statut</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
                {STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label} — {s.hint}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Étapes */}
      <h2 style={{ fontSize: 14, fontWeight: 800, color: C.grisTF, margin: '0 0 12px' }}>
        Étapes {steps.length > 0 && <span style={{ color: C.grisM, fontWeight: 600 }}>({steps.length})</span>}
      </h2>

      {steps.map((step, i) => (
        <StepCard
          key={step._uid}
          step={step} index={i} total={steps.length}
          onPatch={(patch) => patchStep(i, patch)}
          onMove={(delta) => moveStep(i, delta)}
          onRemove={() => removeStep(i)}
          onUpload={(file, subIndex = null) => uploadImage(i, subIndex, file)}
          uploading={uploadTarget?.step === i && uploadTarget?.sub === null}
          onSubPatch={(j, patch) => patchSub(i, j, patch)}
          onSubMove={(j, delta) => moveSub(i, j, delta)}
          onSubRemove={(j) => removeSub(i, j)}
          onSubAdd={() => addSub(i)}
          uploadingSub={uploadTarget?.step === i ? uploadTarget?.sub : null}
        />
      ))}

      <button
        type="button" onClick={addStep}
        style={{
          width: '100%', padding: '13px', borderRadius: 10, cursor: 'pointer',
          border: `1px dashed ${C.grisCL}`, background: C.blanc,
          color: C.process, fontWeight: 700, fontSize: 13.5, marginBottom: 24,
        }}
      >
        + Ajouter une étape
      </button>

      {/* Barre d'enregistrement */}
      <div style={{
        position: 'sticky', bottom: 0, background: C.blanc,
        border: `1px solid ${C.grisCL}`, borderRadius: 12, padding: 16,
        display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap',
        boxShadow: '0 -4px 16px rgba(0,0,0,0.06)',
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 320px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.grisF }}>
            Qu'avez-vous changé ? <span style={{ fontWeight: 500, color: C.grisM }}>(apparaîtra dans l'historique)</span>
          </span>
          <input
            value={changeNote} onChange={(e) => setChangeNote(e.target.value)}
            placeholder="Ex. Ajout de l'étape de vérification des tickets SAV"
            style={inputStyle}
          />
        </label>
        <button type="button" onClick={onCancel} disabled={saving}
          style={{
            padding: '10px 18px', borderRadius: 9, border: `1px solid ${C.grisCL}`,
            background: C.blanc, color: C.grisF, fontWeight: 700, fontSize: 13, cursor: 'pointer',
          }}>
          Annuler
        </button>
        <button type="submit" disabled={saving || !title.trim()}
          style={{
            padding: '10px 22px', borderRadius: 9, border: 'none', background: C.process, color: '#fff',
            fontWeight: 700, fontSize: 13,
            cursor: saving || !title.trim() ? 'default' : 'pointer',
            opacity: saving || !title.trim() ? 0.5 : 1,
          }}>
          {saving ? 'Enregistrement…' : `Enregistrer (v${(process.version_no || 0) + 1})`}
        </button>
      </div>
    </form>
  );
}
