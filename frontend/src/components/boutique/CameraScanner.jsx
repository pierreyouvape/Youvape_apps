import { useEffect, useRef, useState } from 'react';

/**
 * Scanner code-barres via la caméra (API native BarcodeDetector, Android/Chrome).
 * onDetect(code) est appelé à chaque code lu (cooldown anti double-scan).
 * Fallback propre si l'appareil ne supporte pas BarcodeDetector.
 */
export default function CameraScanner({ onDetect, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lastRef = useRef({ code: null, at: 0 });
  const [error, setError] = useState(null);
  const [supported] = useState(() => typeof window !== 'undefined' && 'BarcodeDetector' in window);
  const [flash, setFlash] = useState(false);

  const beep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      o.start(); o.stop(ctx.currentTime + 0.09);
      setTimeout(() => ctx.close(), 200);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    let detector;
    try {
      detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] });
    } catch {
      detector = new window.BarcodeDetector();
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play();

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length) {
              const code = codes[0].rawValue;
              const now = Date.now();
              // cooldown 1.2 s (évite de compter 30× la même présentation)
              if (code && (now - lastRef.current.at > 1200)) {
                lastRef.current = { code, at: now };
                setFlash(true); setTimeout(() => setFlash(false), 150);
                beep();
                onDetect(code);
              }
            }
          } catch { /* frame non prête */ }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        setError(e.name === 'NotAllowedError' ? 'Accès caméra refusé.' : 'Caméra indisponible.');
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [supported, onDetect]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#111', color: '#fff' }}>
        <span style={{ fontWeight: 700 }}>Scanner caméra</span>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 16, fontWeight: 700 }}>Fermer ✕</button>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {!supported ? (
          <div style={{ color: '#fff', padding: 24, textAlign: 'center', marginTop: 40 }}>
            Le scanner caméra n'est pas supporté sur cet appareil.<br />Utilise la douchette ou la saisie manuelle.
          </div>
        ) : error ? (
          <div style={{ color: '#fff', padding: 24, textAlign: 'center', marginTop: 40 }}>{error}</div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {/* Cadre de visée */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              width: '78%', height: 130, border: `3px solid ${flash ? '#22c55e' : 'rgba(255,255,255,0.9)'}`,
              borderRadius: 12, boxShadow: '0 0 0 2000px rgba(0,0,0,0.35)',
            }} />
            <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 14 }}>
              Vise un code-barres — bip à chaque scan
            </div>
          </>
        )}
      </div>
    </div>
  );
}
