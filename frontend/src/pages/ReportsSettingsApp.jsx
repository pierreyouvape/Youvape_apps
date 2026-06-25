import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';

const API = '/api/reports/email-settings';
const ACCENT = '#E28F00';

const FREQUENCIES = [
  {
    key: 'daily',
    label: 'Rapport journalier',
    desc: 'Envoyé chaque matin à 6h. Couvre la journée de la veille.',
    icon: '📅',
  },
  {
    key: 'weekly',
    label: 'Rapport hebdomadaire',
    desc: 'Envoyé chaque lundi à 6h. Couvre la semaine écoulée (lundi → dimanche).',
    icon: '🗓️',
  },
  {
    key: 'monthly',
    label: 'Rapport mensuel',
    desc: 'Envoyé le 1er de chaque mois à 6h. Couvre le mois précédent.',
    icon: '📆',
  },
];

function FrequencyCard({ freq, value, onChange, onTest, testState }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 10, padding: '20px 22px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 20 }}>{freq.icon}</span>
        <h3 style={{ margin: 0, fontSize: 16, color: '#2a2e38' }}>{freq.label}</h3>
      </div>
      <p style={{ margin: '0 0 12px', color: '#8A99A4', fontSize: 13 }}>{freq.desc}</p>

      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#8A99A4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Destinataires
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(freq.key, e.target.value)}
        placeholder="ex: pierre@youvape.fr, compta@youvape.fr"
        rows={2}
        style={{
          width: '100%', padding: '10px 12px', border: '1px solid #d8dde2', borderRadius: 7,
          fontSize: 14, fontFamily: 'Lato, sans-serif', color: '#2a2e38', outline: 'none', resize: 'vertical',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => (e.target.style.borderColor = ACCENT)}
        onBlur={(e) => (e.target.style.borderColor = '#d8dde2')}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontSize: 12, color: '#aab3bd' }}>
          Plusieurs adresses : séparez par une virgule, un point-virgule ou un espace. Laissez vide pour ne pas envoyer.
        </span>
        <button
          onClick={() => onTest(freq.key)}
          disabled={testState === 'sending'}
          style={{
            flexShrink: 0, marginLeft: 12, padding: '7px 14px', borderRadius: 7, border: `1px solid ${ACCENT}`,
            background: testState === 'sending' ? '#f5f5f5' : '#fff', color: ACCENT, fontSize: 13, fontWeight: 700,
            cursor: testState === 'sending' ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {testState === 'sending' ? 'Envoi…' : '✉️ Test'}
        </button>
      </div>
      {testState && testState !== 'sending' && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: testState.startsWith('ok') ? '#2A8049' : '#DC2626' }}>
          {testState.startsWith('ok') ? `✓ ${testState.slice(3)}` : `✗ ${testState.slice(4)}`}
        </div>
      )}
    </div>
  );
}

export default function ReportsSettingsApp() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState({ daily: '', weekly: '', monthly: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [tests, setTests] = useState({});

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(API);
      if (res.data.success) setSettings(res.data.settings);
    } catch {
      setSaveMsg('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleChange = (key, val) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
    setSaveMsg('');
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await axios.put(API, settings);
      if (res.data.success) {
        setSettings(res.data.settings);
        setSaveMsg('✓ Paramètres enregistrés');
      } else {
        setSaveMsg('✗ ' + (res.data.error || 'Erreur'));
      }
    } catch (e) {
      setSaveMsg('✗ ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (freq) => {
    // Utilise la première adresse renseignée pour cette fréquence
    const raw = settings[freq] || '';
    const first = raw.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.includes('@'))[0];
    if (!first) {
      setTests((t) => ({ ...t, [freq]: 'err Renseignez d\'abord une adresse email' }));
      return;
    }
    setTests((t) => ({ ...t, [freq]: 'sending' }));
    try {
      const res = await axios.post(`${API}/test`, { frequency: freq, email: first });
      if (res.data.success) {
        setTests((t) => ({ ...t, [freq]: `ok Test envoyé à ${first}` }));
      } else {
        setTests((t) => ({ ...t, [freq]: 'err ' + (res.data.error || 'Échec') }));
      }
    } catch (e) {
      setTests((t) => ({ ...t, [freq]: 'err ' + (e.response?.data?.error || e.message) }));
    }
  };

  return (
    <AppShell currentPath="/financier">
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'Lato, sans-serif' }}>
        {/* Header */}
        <div style={{ backgroundColor: ACCENT, color: 'white', padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button onClick={() => navigate('/financier')} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>
              ← Rapport
            </button>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>✉️ Rapports automatiques par email</h1>
          </div>
        </div>

        {/* Contenu */}
        <div style={{ flex: 1, padding: '28px 60px', maxWidth: 820, width: '100%', boxSizing: 'border-box' }}>
          <div style={{ background: `linear-gradient(135deg, ${ACCENT}18 0%, ${ACCENT}08 100%)`, border: `1px solid ${ACCENT}40`, borderRadius: 10, padding: '14px 18px', marginBottom: 24, fontSize: 13.5, color: '#626E85', lineHeight: 1.6 }}>
            <strong style={{ color: '#2a2e38' }}>Envoi automatique des rapports</strong> — Les emails reproduisent <em>exactement</em> les métriques affichées dans l'application Rapport (CA TTC/HT, profit, marge, commandes, remboursements, coûts). Renseignez les destinataires par fréquence. Une case vide = aucun envoi.
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#8A99A4' }}>Chargement…</div>
          ) : (
            <>
              {FREQUENCIES.map((f) => (
                <FrequencyCard
                  key={f.key}
                  freq={f}
                  value={settings[f.key] || ''}
                  onChange={handleChange}
                  onTest={handleTest}
                  testState={tests[f.key]}
                />
              ))}

              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6 }}>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: '11px 26px', borderRadius: 8, border: 'none',
                    background: saving ? '#c0c5cc' : ACCENT, color: '#fff', fontSize: 14.5, fontWeight: 700,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
                {saveMsg && (
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: saveMsg.startsWith('✓') ? '#2A8049' : '#DC2626' }}>{saveMsg}</span>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
