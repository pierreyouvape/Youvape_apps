import { useState, useRef, useCallback } from 'react';
import axios from 'axios';
import ProcessEditor from './ProcessEditor';
import { API_URL, C, STATUSES, CALLOUTS } from './processConstants';

const inputStyle = {
  padding: '9px 12px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
  fontSize: 13.5, color: C.grisTF, outline: 'none', background: C.blanc, width: '100%',
  boxSizing: 'border-box', fontFamily: 'inherit',
};

// crypto.randomUUID n'existe qu'en contexte sécurisé (https / localhost) :
// repli sur un compteur, l'identifiant ne sert qu'au rendu React.
let uidSeq = 0;
const newUid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `step-${++uidSeq}`);

const iconBtn = (disabled) => ({
  width: 28, height: 28, border: `1px solid ${C.grisCL}`, background: C.blanc,
  borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
  color: disabled ? C.grisCL : C.grisF, fontSize: 13, lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});

/* ─── Bande photo éditable d'une étape ──────────────────────────────────── */
function StepImageEditor({ images, onChange, onUpload, uploading }) {
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const pickFiles = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    files.forEach(onUpload);
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
                  <button type="button" onClick={() => remove(i)} title="Retirer de l'étape"
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
          borderRadius: 8, padding: '12px 14px', textAlign: 'center', cursor: 'pointer',
          fontSize: 12.5, color: dragOver ? C.processF : C.grisM,
        }}
      >
        {uploading
          ? 'Envoi de l\'image…'
          : 'Ajouter une photo — cliquez, déposez un fichier, ou collez une capture (Cmd+V) dans le texte ci-dessus'}
        <input
          ref={fileRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}

/* ─── Une étape en édition ──────────────────────────────────────────────── */
function StepCard({ step, index, total, onPatch, onMove, onRemove, onUpload, uploading }) {
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

      <ProcessEditor
        value={step.body || ''}
        onChange={(html) => onPatch({ body: html })}
        placeholder="Ce qu'il faut faire, précisément. Cmd+V pour coller une capture d'écran."
        onPasteImage={onUpload}
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.grisM, marginRight: 4 }}>Encadré :</span>
        <button
          type="button" onClick={() => onPatch({ callout: null })}
          style={{
            padding: '5px 11px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${!step.callout ? C.grisF : C.grisCL}`,
            background: !step.callout ? C.grisF : C.blanc,
            color: !step.callout ? '#fff' : C.grisF,
          }}
        >
          Aucun
        </button>
        {CALLOUTS.map((co) => {
          const active = step.callout === co.code;
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
        images={step.images || []}
        onChange={(images) => onPatch({ images })}
        onUpload={onUpload}
        uploading={uploading}
      />
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
  // l'instance Tiptap d'une étape voisine lors d'un déplacement ou d'une
  // suppression. Le backend ignore ce champ.
  const [steps, setSteps] = useState(() =>
    (process.steps || []).map((s) => ({
      _uid: newUid(),
      title: s.title || '', body: s.body || '', callout: s.callout || null,
      images: Array.isArray(s.images) ? s.images : [],
    }))
  );
  const [uploadingStep, setUploadingStep] = useState(null);

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
    if (!window.confirm(`Supprimer l'étape ${i + 1} ?`)) return;
    setSteps((prev) => prev.filter((_, k) => k !== i));
  };

  const addStep = () =>
    setSteps((prev) => [...prev, { _uid: newUid(), title: '', body: '', callout: null, images: [] }]);

  // Upload immédiat : le fichier part sur le serveur dès qu'il est choisi, et
  // c'est l'URL renvoyée qu'on stocke dans l'étape. L'enregistrement du process
  // ne transporte donc jamais de binaire.
  const uploadImage = useCallback(async (stepIndex, file) => {
    setUploadingStep(stepIndex);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await axios.post(`${API_URL}/process/${process.id}/images`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const image = res.data.data;
      setSteps((prev) => prev.map((s, k) => (k === stepIndex ? { ...s, images: [...(s.images || []), image] } : s)));
    } catch (err) {
      alert(err.response?.data?.error || "L'envoi de l'image a échoué");
    } finally {
      setUploadingStep(null);
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
          onUpload={(file) => uploadImage(i, file)}
          uploading={uploadingStep === i}
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
