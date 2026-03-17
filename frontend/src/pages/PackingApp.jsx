import { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

// Génération de sons avec Web Audio API
const playSound = (type) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'ok') {
      osc.frequency.value = 1200;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === 'complete') {
      osc.frequency.value = 1400;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
      setTimeout(() => {
        const ctx2 = new (window.AudioContext || window.webkitAudioContext)();
        const osc2 = ctx2.createOscillator();
        const gain2 = ctx2.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx2.destination);
        osc2.frequency.value = 1600;
        gain2.gain.value = 0.3;
        osc2.start();
        osc2.stop(ctx2.currentTime + 0.15);
      }, 150);
    } else {
      osc.frequency.value = 300;
      gain.gain.value = 0.4;
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    }
  } catch (e) {
    // Pas de son si pas de Web Audio
  }
};

const PackingApp = () => {
  const { token, user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [isComplete, setIsComplete] = useState(false);
  const [scanBuffer, setScanBuffer] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelData, setLabelData] = useState(null); // { pdfBase64, trackingId, orderNumber }
  const [labelError, setLabelError] = useState(null);
  const [showLabels, setShowLabels] = useState(false);
  const [labelsList, setLabelsList] = useState([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(null); // label id to confirm cancel
  const [cancelLoading, setCancelLoading] = useState(false);

  // Refs pour accéder aux valeurs courantes dans le listener clavier
  const orderRef = useRef(null);
  const itemsRef = useRef([]);
  const loadingRef = useRef(false);
  const scanBufferRef = useRef('');
  const isCompleteRef = useRef(false);

  useEffect(() => { orderRef.current = order; }, [order]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { scanBufferRef.current = scanBuffer; }, [scanBuffer]);
  useEffect(() => { isCompleteRef.current = isComplete; }, [isComplete]);

  // Télécharger le PDF depuis base64
  const downloadPdf = useCallback((base64, orderNumber) => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LS-${orderNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Générer l'étiquette La Poste
  const generateLabel = useCallback(async (orderNumber) => {
    setLabelLoading(true);
    setLabelError(null);
    try {
      const res = await axios.post(`${API_URL}/laposte/label/${orderNumber}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = res.data;
      setLabelData({ pdfBase64: data.pdfBase64, trackingId: data.trackingId, orderNumber: data.orderNumber });
      downloadPdf(data.pdfBase64, orderNumber);
      setMessage(`Etiquette generee — suivi : ${data.trackingId}`);
    } catch (err) {
      const detail = err.response?.data?.details || err.response?.data?.error || 'Erreur generation etiquette';
      setLabelError(typeof detail === 'string' ? detail : JSON.stringify(detail));
      playSound('error');
    } finally {
      setLabelLoading(false);
    }
  }, [token, downloadPdf]);

  // Vérifier si tout est scanné → appel auto étiquette
  useEffect(() => {
    if (items.length > 0 && items.every(item => item.scanned >= item.qty)) {
      if (!isComplete) {
        setIsComplete(true);
        playSound('complete');
        setMessage('Commande complete ! Generation etiquette...');
        // Appel auto La Poste
        if (orderRef.current) {
          generateLabel(orderRef.current.wp_order_id);
        }
      }
    } else {
      setIsComplete(false);
    }
  }, [items, isComplete, generateLabel]);

  // Charger une commande
  const loadOrder = useCallback(async (number) => {
    if (!number || loadingRef.current) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    setIsComplete(false);

    try {
      const res = await axios.get(`${API_URL}/packing/orders/${number}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setOrder(res.data.order);
      setItems(res.data.items.map(item => ({
        ...item,
        scanned: 0
      })));
      playSound('ok');
    } catch (err) {
      if (err.response?.status === 404) {
        setError(`Commande #${number} introuvable`);
      } else {
        setError('Erreur lors du chargement de la commande');
      }
      playSound('error');
      setOrder(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Gérer le scan d'un article
  const handleScan = useCallback(async (barcode) => {
    if (!barcode || !orderRef.current) return;
    setError(null);
    setMessage(null);

    try {
      const res = await axios.get(`${API_URL}/packing/barcode/${barcode}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const barcodeData = res.data;
      const incrementQty = barcodeData.type === 'pack' ? barcodeData.quantity : 1;
      const currentItems = itemsRef.current;

      const matchIndex = currentItems.findIndex(item => {
        const itemProductId = item.variation_id && item.variation_id !== 0 ? item.variation_id : item.product_id;
        return itemProductId === barcodeData.wp_product_id && item.scanned < item.qty;
      });

      if (matchIndex === -1) {
        const alreadyComplete = currentItems.find(item => {
          const itemProductId = item.variation_id && item.variation_id !== 0 ? item.variation_id : item.product_id;
          return itemProductId === barcodeData.wp_product_id;
        });

        if (alreadyComplete) {
          setError(`"${alreadyComplete.name}" deja complet`);
        } else {
          setError(`Article "${barcodeData.name}" non present dans cette commande`);
        }
        playSound('error');
        return;
      }

      setItems(prev => {
        const updated = [...prev];
        const item = { ...updated[matchIndex] };
        item.scanned = Math.min(item.scanned + incrementQty, item.qty);
        updated[matchIndex] = item;
        return updated;
      });

      const currentItem = currentItems[matchIndex];
      const newScanned = Math.min(currentItem.scanned + incrementQty, currentItem.qty);
      if (newScanned >= currentItem.qty) {
        setMessage(`${currentItem.name} - complet`);
      } else {
        setMessage(`${currentItem.name} - ${newScanned}/${currentItem.qty}`);
      }

      playSound('ok');

    } catch (err) {
      if (err.response?.status === 404) {
        setError(`Code-barres "${barcode}" inconnu`);
      } else {
        setError('Erreur lors du scan');
      }
      playSound('error');
    }
  }, [token]);

  // Charger la liste des étiquettes
  const loadLabels = useCallback(async () => {
    setLabelsLoading(true);
    try {
      const res = await axios.get(`${API_URL}/laposte/labels`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLabelsList(res.data);
    } catch (err) {
      console.error('Erreur chargement étiquettes:', err);
    } finally {
      setLabelsLoading(false);
    }
  }, [token]);

  // Annuler une étiquette
  const handleCancelLabel = useCallback(async (id) => {
    setCancelLoading(true);
    try {
      await axios.post(`${API_URL}/laposte/labels/${id}/cancel`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCancelConfirm(null);
      loadLabels();
    } catch (err) {
      const detail = err.response?.data?.error || 'Erreur annulation';
      alert(detail);
    } finally {
      setCancelLoading(false);
    }
  }, [token, loadLabels]);

  // Réinitialiser
  const handleReset = useCallback(() => {
    setOrder(null);
    setItems([]);
    setError(null);
    setMessage(null);
    setIsComplete(false);
    setManualInput('');
    setLabelData(null);
    setLabelError(null);
    setLabelLoading(false);
  }, []);

  // Listener clavier global — capture les scans sans champ de saisie
  useEffect(() => {
    let buffer = '';
    let timeout = null;

    const handleKeyDown = (e) => {
      // Ignorer si on est dans un input (boutons manuels etc.)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter') {
        e.preventDefault();
        const value = buffer.trim();
        buffer = '';
        setScanBuffer('');

        if (!value) return;

        if (!orderRef.current || isCompleteRef.current) {
          // Pas de commande ou commande terminée → charger une nouvelle commande
          handleReset();
          loadOrder(value);
        } else {
          handleScan(value);
        }
      } else if (e.key.length === 1) {
        // Caractère imprimable
        buffer += e.key;
        setScanBuffer(buffer);

        // Reset le buffer après 2s d'inactivité
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          buffer = '';
          setScanBuffer('');
        }, 2000);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeout);
    };
  }, [loadOrder, handleScan, handleReset]);

  // Submit du champ manuel
  const handleManualSubmit = (e) => {
    e.preventDefault();
    const value = manualInput.trim();
    if (!value) return;
    setManualInput('');
    if (!order) {
      loadOrder(value);
    } else {
      handleScan(value);
    }
  };

  // Incrémenter manuellement (+1)
  const handleManualIncrement = (index) => {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };
      if (item.scanned < item.qty) {
        item.scanned += 1;
        updated[index] = item;
        playSound('ok');
        setMessage(`${item.name} - ${item.scanned}/${item.qty}`);
      }
      return updated;
    });
  };

  // Incrémenter tout (++)
  const handleManualIncrementAll = (index) => {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };
      if (item.scanned < item.qty) {
        item.scanned = item.qty;
        updated[index] = item;
        playSound('ok');
        setMessage(`${item.name} - ${item.scanned}/${item.qty}`);
      }
      return updated;
    });
  };

  // Décrémenter manuellement (-1)
  const handleManualDecrement = (index) => {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };
      if (item.scanned > 0) {
        item.scanned -= 1;
        updated[index] = item;
      }
      return updated;
    });
  };

  // Décrémenter tout (--)
  const handleManualDecrementAll = (index) => {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };
      if (item.scanned > 0) {
        item.scanned = 0;
        updated[index] = item;
      }
      return updated;
    });
  };

  // Couleur de ligne
  const getRowColor = (item) => {
    if (item.scanned >= item.qty) return '#d4edda';
    if (item.scanned > 0) return '#fff3cd';
    return '#f8d7da';
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#6366f1',
        padding: '15px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        color: 'white',
        position: 'relative'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', zIndex: 1 }}>
          <button
            onClick={() => navigate('/home')}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Retour
          </button>
          <h1 style={{ margin: 0, fontSize: '22px' }}>Packing</h1>
          <button
            onClick={() => { setShowLabels(true); loadLabels(); }}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Etiquettes
          </button>
        </div>
        <span style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '24px',
          fontWeight: '700'
        }}>
          {user?.name || user?.email || ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', zIndex: 1 }}>
          {order && !showLabels && (
            <button
              onClick={handleReset}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Nouvelle commande
            </button>
          )}
          <button
            onClick={() => { logout(); navigate('/login'); }}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Changer de preparateur
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, maxWidth: '900px', margin: '0 auto', padding: '20px', width: '100%' }}>

        {showLabels ? (
          <>
            {/* Vue liste étiquettes */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h2 style={{ margin: 0, color: '#333' }}>Etiquettes generees</h2>
                <button
                  onClick={() => setShowLabels(false)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#6366f1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Retour packing
                </button>
              </div>

              {labelsLoading ? (
                <p style={{ textAlign: 'center', color: '#666' }}>Chargement...</p>
              ) : labelsList.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#999' }}>Aucune etiquette</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8f9fa' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '13px', color: '#666' }}>Commande</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '13px', color: '#666' }}>N° suivi</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '13px', color: '#666' }}>Date</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '13px', color: '#666' }}>Packer</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '13px', color: '#666', width: '120px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {labelsList.map(label => (
                      <tr
                        key={label.id}
                        style={{
                          backgroundColor: label.status === 'cancelled' ? '#f8d7da' : 'white',
                          borderBottom: '1px solid #eee'
                        }}
                      >
                        <td style={{ padding: '10px 12px', fontSize: '14px', fontWeight: '500' }}>
                          #{label.order_number}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '13px', color: '#666' }}>
                          {label.tracking_id}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '13px', color: '#666' }}>
                          {new Date(label.created_at).toLocaleDateString('fr-FR')}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '13px', color: '#666' }}>
                          {label.packer_name || '-'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {label.status === 'cancelled' ? (
                            <span style={{ color: '#dc3545', fontSize: '13px', fontWeight: '600' }}>Annulee</span>
                          ) : (
                            <button
                              onClick={() => setCancelConfirm(label)}
                              disabled={!label.cancellable}
                              style={{
                                padding: '5px 12px',
                                backgroundColor: label.cancellable ? '#dc3545' : '#e9ecef',
                                color: label.cancellable ? 'white' : '#adb5bd',
                                border: 'none',
                                borderRadius: '5px',
                                cursor: label.cancellable ? 'pointer' : 'default',
                                fontSize: '12px',
                                fontWeight: '600'
                              }}
                            >
                              Annuler
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Popup confirmation annulation */}
            {cancelConfirm && (
              <div style={{
                position: 'fixed',
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000
              }}>
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '30px',
                  maxWidth: '450px',
                  width: '90%',
                  textAlign: 'center',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
                }}>
                  <h3 style={{ margin: '0 0 15px', color: '#333' }}>
                    Annuler l'etiquette #{cancelConfirm.order_number} ?
                  </h3>
                  <p style={{ color: '#666', margin: '0 0 15px', fontSize: '14px' }}>
                    Etes-vous sur de vouloir annuler cette etiquette ? Cette action est definitive.
                  </p>
                  <p style={{ color: '#dc3545', margin: '0 0 25px', fontSize: '13px', fontWeight: 'bold' }}>
                    Attention : il faut aussi annuler l'expedition manuellement dans BMS.
                  </p>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    <button
                      onClick={() => setCancelConfirm(null)}
                      disabled={cancelLoading}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                    >
                      Non, revenir en arriere
                    </button>
                    <button
                      onClick={() => handleCancelLabel(cancelConfirm.id)}
                      disabled={cancelLoading}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: cancelLoading ? 'default' : 'pointer',
                        fontSize: '14px'
                      }}
                    >
                      {cancelLoading ? 'Annulation...' : "Oui, annuler l'etiquette"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
        <>
        {/* Attente de scan — pas de commande */}
        {!order && !loading && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '40px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            textAlign: 'center'
          }}>
            <h2 style={{ color: '#333', marginBottom: '20px' }}>
              {scanBuffer ? `Scan : ${scanBuffer}` : 'Scannez ou saisissez un numero de commande'}
            </h2>
            <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="N° commande..."
                style={{
                  width: '100%',
                  maxWidth: '300px',
                  padding: '12px 16px',
                  fontSize: '20px',
                  textAlign: 'center',
                  border: '2px solid #ddd',
                  borderRadius: '8px',
                  outline: 'none'
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#6366f1',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  cursor: 'pointer'
                }}
              >
                OK
              </button>
            </form>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '60px 40px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            textAlign: 'center'
          }}>
            <h2 style={{ color: '#6366f1' }}>Chargement...</h2>
          </div>
        )}

        {/* Erreur */}
        {error && (
          <div style={{
            backgroundColor: '#f8d7da',
            color: '#721c24',
            padding: '12px 20px',
            borderRadius: '8px',
            marginTop: '15px',
            fontSize: '16px',
            fontWeight: '500'
          }}>
            {error}
          </div>
        )}

        {/* Message */}
        {message && !error && (
          <div style={{
            backgroundColor: isComplete ? '#d4edda' : '#d1ecf1',
            color: isComplete ? '#155724' : '#0c5460',
            padding: '12px 20px',
            borderRadius: '8px',
            marginTop: '15px',
            fontSize: '16px',
            fontWeight: '500'
          }}>
            {message}
          </div>
        )}

        {/* Commande chargée */}
        {order && (
          <>
            {/* Info commande */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              marginTop: '15px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <h2 style={{ margin: 0, color: '#333' }}>Commande #{order.wp_order_id}</h2>
                  <p style={{ margin: '5px 0 0', color: '#666' }}>
                    {order.shipping.first_name} {order.shipping.last_name}
                    {order.shipping.company && ` - ${order.shipping.company}`}
                  </p>
                  <p style={{ margin: '2px 0 0', color: '#999', fontSize: '14px' }}>
                    {order.shipping.address}, {order.shipping.postcode} {order.shipping.city}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '6px 14px',
                    backgroundColor: '#6366f1',
                    color: 'white',
                    borderRadius: '20px',
                    fontSize: '14px',
                    fontWeight: '600'
                  }}>
                    {order.shipping_method}
                  </span>
                  <p style={{ margin: '5px 0 0', color: '#666', fontSize: '14px' }}>
                    {order.total} EUR
                  </p>
                  <p style={{ margin: '3px 0 0', color: '#999', fontSize: '13px' }}>
                    {(items.reduce((sum, item) => sum + (item.weight || 0) * item.qty, 0) * 1000).toFixed(0)}g
                  </p>
                </div>
              </div>
            </div>

            {/* Zone scan article */}
            {!isComplete && (
              <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '15px 20px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                marginTop: '15px'
              }}>
                {scanBuffer && (
                  <p style={{ margin: '0 0 10px', color: '#6366f1', fontSize: '16px', textAlign: 'center' }}>
                    Scan : {scanBuffer}
                  </p>
                )}
                <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="text"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="EAN ou n° article..."
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      fontSize: '16px',
                      border: '2px solid #ddd',
                      borderRadius: '8px',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#6366f1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      cursor: 'pointer'
                    }}
                  >
                    OK
                  </button>
                </form>
              </div>
            )}

            {/* Liste des articles */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              marginTop: '15px',
              overflow: 'hidden'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '14px', color: '#666' }}>Article</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '14px', color: '#666', width: '80px' }}>SKU</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '14px', color: '#666', width: '260px' }}>Quantite</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr
                      key={item.id}
                      style={{
                        backgroundColor: getRowColor(item),
                        transition: 'background-color 0.3s ease'
                      }}
                    >
                      <td style={{ padding: '14px 16px', fontSize: '15px', fontWeight: '500' }}>
                        {item.name}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center', fontSize: '13px', color: '#666' }}>
                        {item.sku || '-'}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px' }}>
                          <button
                            onClick={() => handleManualDecrementAll(index)}
                            disabled={item.scanned === 0}
                            style={{
                              width: '36px',
                              height: '32px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#dee2e6',
                              color: item.scanned === 0 ? '#adb5bd' : '#dc3545',
                              cursor: item.scanned === 0 ? 'default' : 'pointer',
                              fontSize: '13px',
                              fontWeight: '700'
                            }}
                          >
                            --
                          </button>
                          <button
                            onClick={() => handleManualDecrement(index)}
                            disabled={item.scanned === 0}
                            style={{
                              width: '36px',
                              height: '32px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#dee2e6',
                              color: item.scanned === 0 ? '#adb5bd' : '#dc3545',
                              cursor: item.scanned === 0 ? 'default' : 'pointer',
                              fontSize: '16px',
                              fontWeight: '700'
                            }}
                          >
                            -
                          </button>
                          <span style={{
                            fontSize: '18px',
                            fontWeight: '700',
                            minWidth: '50px',
                            textAlign: 'center',
                            color: item.scanned >= item.qty ? '#155724' : item.scanned > 0 ? '#856404' : '#721c24'
                          }}>
                            {item.scanned}/{item.qty}
                          </span>
                          <button
                            onClick={() => handleManualIncrement(index)}
                            disabled={item.scanned >= item.qty}
                            style={{
                              width: '36px',
                              height: '32px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#dee2e6',
                              color: item.scanned >= item.qty ? '#adb5bd' : '#28a745',
                              cursor: item.scanned >= item.qty ? 'default' : 'pointer',
                              fontSize: '16px',
                              fontWeight: '700'
                            }}
                          >
                            +
                          </button>
                          <button
                            onClick={() => handleManualIncrementAll(index)}
                            disabled={item.scanned >= item.qty}
                            style={{
                              width: '36px',
                              height: '32px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#dee2e6',
                              color: item.scanned >= item.qty ? '#adb5bd' : '#28a745',
                              cursor: item.scanned >= item.qty ? 'default' : 'pointer',
                              fontSize: '16px',
                              fontWeight: '700'
                            }}
                          >
                            ++
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Commande complete */}
            {isComplete && (
              <div style={{
                backgroundColor: '#d4edda',
                borderRadius: '12px',
                padding: '30px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                marginTop: '15px',
                textAlign: 'center'
              }}>
                <h2 style={{ color: '#155724', margin: '0 0 10px' }}>Commande prete !</h2>

                {labelLoading && (
                  <p style={{ color: '#155724', margin: '0 0 15px', fontSize: '15px' }}>
                    Generation de l'etiquette en cours...
                  </p>
                )}

                {labelError && (
                  <div style={{
                    backgroundColor: '#f8d7da',
                    color: '#721c24',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    margin: '0 0 15px',
                    fontSize: '14px'
                  }}>
                    Erreur etiquette : {labelError}
                  </div>
                )}

                {labelData && (
                  <div style={{ margin: '0 0 15px' }}>
                    <p style={{ color: '#155724', margin: '0 0 10px', fontSize: '15px' }}>
                      N° suivi : <strong>{labelData.trackingId}</strong>
                    </p>
                    <button
                      onClick={() => downloadPdf(labelData.pdfBase64, labelData.orderNumber)}
                      style={{
                        padding: '10px 24px',
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        cursor: 'pointer',
                        marginRight: '10px'
                      }}
                    >
                      Re-telecharger l'etiquette
                    </button>
                  </div>
                )}

                <button
                  onClick={handleReset}
                  style={{
                    padding: '12px 40px',
                    backgroundColor: '#6366f1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    cursor: 'pointer'
                  }}
                >
                  Commande suivante
                </button>
              </div>
            )}
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
};

export default PackingApp;
