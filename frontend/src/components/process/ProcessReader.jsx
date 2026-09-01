import { useState } from 'react';
import {
  C, statusInfo, calloutInfo, sanitizeProcessHtml, hasContent,
  prettyDateTime, initials,
} from './processConstants';

/* ─── Styles du contenu rendu (injectés une seule fois) ─────────────────── */
const STYLE_ID = 'yv-process-reader-styles';
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    .yv-process-body { font-size: 14.5px; line-height: 1.7; color: ${C.grisTF}; }
    .yv-process-body p { margin: 0 0 10px; }
    .yv-process-body p:last-child { margin-bottom: 0; }
    .yv-process-body h3 { font-size: 15.5px; font-weight: 800; margin: 16px 0 7px; }
    .yv-process-body h4 { font-size: 14.5px; font-weight: 700; margin: 13px 0 6px; }
    .yv-process-body ul, .yv-process-body ol { margin: 0 0 10px; padding-left: 24px; }
    .yv-process-body li { margin: 4px 0; }
    .yv-process-body a { color: ${C.process}; font-weight: 600; text-decoration: underline; word-break: break-word; }
    .yv-process-body code {
      background: ${C.grisTL}; border: 1px solid ${C.grisCL}; border-radius: 4px;
      padding: 1px 5px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px;
    }
    .yv-process-body pre {
      background: ${C.grisTF}; color: #F2F6F8; border-radius: 8px;
      padding: 12px 14px; overflow-x: auto; margin: 10px 0; font-size: 13px; line-height: 1.5;
    }
    .yv-process-body pre code { background: none; border: none; color: inherit; padding: 0; }
    .yv-process-body blockquote {
      border-left: 3px solid ${C.grisCL}; margin: 10px 0; padding: 2px 0 2px 14px; color: ${C.grisF};
    }
    /* Sommaire : masqué sous 1100px, où il volerait la largeur au contenu. */
    .yv-process-toc { display: none; }
    .yv-process-toc a:hover { background: ${C.grisTL}; }
    @media (min-width: 1100px) { .yv-process-toc { display: block; } }
  `;
  document.head.appendChild(el);
}

/* ─── Visionneuse plein écran ───────────────────────────────────────────── */
function Lightbox({ image, onClose }) {
  if (!image) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
        gap: 14, padding: 28, cursor: 'zoom-out',
      }}
    >
      <img
        src={image.url} alt={image.caption || image.original_name || ''}
        style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: 8, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
      />
      {image.caption && (
        <p style={{ color: '#fff', fontSize: 14, margin: 0, textAlign: 'center', maxWidth: 700 }}>{image.caption}</p>
      )}
    </div>
  );
}

/* ─── Bande photo d'une étape ───────────────────────────────────────────── */
function StepImages({ images, onOpen }) {
  if (!images || images.length === 0) return null;
  return (
    <div style={{
      display: 'grid', gap: 12, marginTop: 14,
      gridTemplateColumns: images.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))',
    }}>
      {images.map((img, i) => (
        <figure key={img.url || i} style={{ margin: 0 }}>
          <img
            src={img.url} alt={img.caption || img.original_name || `Illustration ${i + 1}`}
            onClick={() => onOpen(img)}
            style={{
              width: '100%', display: 'block', borderRadius: 8, cursor: 'zoom-in',
              border: `1px solid ${C.grisCL}`, background: C.grisTL,
              maxHeight: images.length === 1 ? 460 : 260, objectFit: 'contain',
            }}
          />
          {img.caption && (
            <figcaption style={{ fontSize: 12, color: C.grisM, marginTop: 6, lineHeight: 1.45 }}>
              {img.caption}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

/* ─── Une étape ─────────────────────────────────────────────────────────── */
function Step({ step, index, isLast, onOpenImage }) {
  const callout = calloutInfo(step.callout);
  return (
    <section id={`etape-${index + 1}`} style={{ display: 'flex', gap: 16, scrollMarginTop: 24 }}>
      {/* Colonne numéro + filet de liaison */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <span style={{
          width: 32, height: 32, borderRadius: '50%', background: C.process, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800,
        }}>
          {index + 1}
        </span>
        {!isLast && <span style={{ flex: 1, width: 2, background: C.grisCL, marginTop: 6, borderRadius: 1 }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: 26 }}>
        {step.title && (
          <h3 style={{ fontSize: 17, fontWeight: 800, color: C.grisTF, margin: '4px 0 10px', lineHeight: 1.35 }}>
            {step.title}
          </h3>
        )}

        {hasContent(step.body) && (
          <div
            className="yv-process-body"
            dangerouslySetInnerHTML={{ __html: sanitizeProcessHtml(step.body) }}
          />
        )}

        {callout && (
          <div style={{
            marginTop: 12, padding: '11px 14px', borderRadius: 8,
            background: callout.bg, borderLeft: `4px solid ${callout.color}`,
            fontSize: 13, fontWeight: 700, color: callout.color,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>{callout.icon}</span> {callout.label}
          </div>
        )}

        <StepImages images={step.images} onOpen={onOpenImage} />
      </div>
    </section>
  );
}

/* ─── Page de lecture ───────────────────────────────────────────────────── */
/**
 * Rend un process en lecture. Sert aussi bien à la version courante qu'à la
 * prévisualisation d'une ancienne version (l'historique lui passe le snapshot).
 */
export default function ProcessReader({ process, headerRight }) {
  ensureStyles();
  const [lightbox, setLightbox] = useState(null);

  const steps = process?.steps || [];
  const st = statusInfo(process?.status);

  return (
    <>
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>

        {/* Sommaire */}
        {steps.length > 1 && (
          <nav className="yv-process-toc" style={{ position: 'sticky', top: 24, width: 210, flexShrink: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px' }}>
              Sommaire
            </p>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {steps.map((s, i) => (
                <li key={i}>
                  <a
                    href={`#etape-${i + 1}`}
                    style={{
                      display: 'flex', gap: 8, padding: '6px 8px', borderRadius: 6,
                      fontSize: 12.5, color: C.grisF, textDecoration: 'none', lineHeight: 1.4,
                    }}
                  >
                    <span style={{ color: C.process, fontWeight: 800, flexShrink: 0 }}>{i + 1}.</span>
                    <span>{s.title || `Étape ${i + 1}`}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <article style={{ flex: 1, minWidth: 0, maxWidth: 860 }}>

          {/* Bandeau : statut, auteur, dernière MAJ */}
          <header style={{
            background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 12,
            padding: '18px 20px', marginBottom: 26,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              {process?.category_name && (
                <span style={{
                  padding: '4px 11px', borderRadius: 20, fontSize: 11.5, fontWeight: 800,
                  background: `${process.category_color || C.grisM}1A`, color: process.category_color || C.grisM,
                }}>
                  {process.category_name}
                </span>
              )}
              <span style={{
                padding: '4px 11px', borderRadius: 20, fontSize: 11.5, fontWeight: 800,
                background: `${st.color}1A`, color: st.color,
              }}>
                {st.label}
              </span>
              <span style={{ fontSize: 12, color: C.grisM }}>version {process?.version_no}</span>
              <div style={{ flex: 1 }} />
              {headerRight}
            </div>

            {/* Le titre vit ici, pas dans la barre de la page : en prévisualisation
                d'une ancienne version, c'est SON titre qu'il faut lire. */}
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.grisTF, margin: '0 0 10px', lineHeight: 1.25, fontFamily: "'Tilt Warp', cursive" }}>
              {process?.title}
            </h1>

            {process?.summary && (
              <p style={{ fontSize: 14.5, color: C.grisF, margin: '0 0 12px', lineHeight: 1.6 }}>
                {process.summary}
              </p>
            )}

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12.5, color: C.grisM }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', background: C.processL, color: C.processF,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800,
                }}>
                  {initials(process?.created_by_name, process?.created_by_email)}
                </span>
                Créé par <strong style={{ color: C.grisF }}>{process?.created_by_name || '—'}</strong>
                le {prettyDateTime(process?.created_at)}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', background: C.grisTL, color: C.grisF,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800,
                }}>
                  {initials(process?.updated_by_name, process?.updated_by_email)}
                </span>
                Dernière MAJ par <strong style={{ color: C.grisF }}>{process?.updated_by_name || '—'}</strong>
                le {prettyDateTime(process?.updated_at)}
              </span>
            </div>
          </header>

          {steps.length === 0 ? (
            <div style={{
              padding: '40px 24px', textAlign: 'center', background: C.blanc,
              border: `1px dashed ${C.grisCL}`, borderRadius: 12,
            }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: C.grisTF, margin: '0 0 5px' }}>
                Ce process n'a pas encore d'étape
              </p>
              <p style={{ fontSize: 13, color: C.grisM, margin: 0 }}>
                Cliquez sur « Modifier » pour décrire la procédure.
              </p>
            </div>
          ) : (
            <div>
              {steps.map((step, i) => (
                <Step key={step.id || i} step={step} index={i} isLast={i === steps.length - 1} onOpenImage={setLightbox} />
              ))}
            </div>
          )}
        </article>
      </div>

      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </>
  );
}
