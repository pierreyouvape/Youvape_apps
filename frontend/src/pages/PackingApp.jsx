import { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { visuelTransporteur } from '../utils/carrierVisuals';
import { trierParAvancement } from '../utils/scanOrder';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { LinkBox } from '../utils/navHelpers';
import axios from 'axios';
import AppShell from '../components/AppShell';

// Champs du bloc « point relais », repris de l'aspect du formulaire d'adresse.
// Déclaré ici et non dans le rendu : le `inputStyle` de ce formulaire lui est
// local, l'utiliser ailleurs ne casse pas le build mais fait planter l'écran.
const CHAMP_RELAIS = {
  padding: '9px 12px',
  fontSize: '15px',
  border: '2px solid #ddd',
  borderRadius: '8px',
  outline: 'none',
  boxSizing: 'border-box'
};

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

// Jour de la semaine en heure de Paris (1 = lundi … 5 = vendredi), quel que
// soit le fuseau du poste.
const JOURS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const jourParis = () =>
  JOURS[new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short' }).format(new Date())];

const EMPTY_MANUAL_FORM = {
  serviceKey: '',
  orderNumber: '', first_name: '', last_name: '', company: '',
  address: '', address_2: '', postcode: '', city: '', country: 'FR', phone: '', email: '',
  weight: '',
  // Point relais : `loadedRelay` est celui de la commande chargée, gardé à part
  // pour être repris si l'on revient à son réseau après avoir changé de
  // service ; `relayDetails` (nom, adresse) n'accompagne que ce point-là.
  relayId: '', relayCountry: 'FR', relayDetails: null, loadedRelay: null,
  saturday: false
};

/** Libellé d'un service d'expédition manuelle (transporteur + mode). */
const manualServiceLabel = (sv) => {
  if (sv.modeLabel) return `${sv.carrierLabel} — ${sv.modeLabel}`;
  if (sv.denominations.length === 1) return `${sv.carrierLabel} — ${sv.denominations[0]}`;
  return sv.carrierLabel;
};

/**
 * Applique un service au formulaire. Le point de la commande chargée n'est
 * repris que s'il appartient au réseau du service : un point Mondial Relay
 * envoyé chez Colissimo ferait livrer le colis on ne sait où.
 */
const withManualService = (form, services, key) => {
  const sv = services.find(x => x.key === key);
  const pt = form.loadedRelay && sv && form.loadedRelay.network === sv.carrierCode ? form.loadedRelay : null;
  return {
    ...form,
    serviceKey: key,
    relayId: pt?.id || '',
    relayCountry: pt?.country || form.country || 'FR',
    relayDetails: pt
  };
};

const PackingApp = () => {
  const { token, user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  // Poids expédié calculé par le backend (tare comprise, packs non comptés deux fois)
  const [weight, setWeight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [isComplete, setIsComplete] = useState(false);
  const [scanBuffer, setScanBuffer] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelData, setLabelData] = useState(null); // { pdfBase64, trackingId, orderNumber }
  const [labelError, setLabelError] = useState(null);
  const [hoveredImage, setHoveredImage] = useState(null); // { url, x, y }
  // Transporteur résolu au scan : sert au bandeau coloré ET au blocage.
  const [carrier, setCarrier] = useState(null);
  // Picking (lot 4) : vague, manquants et tickets de la commande scannée.
  const [pickingInfo, setPickingInfo] = useState(null);
  const [pickingBusy, setPickingBusy] = useState(false);
  // « Envoyer incomplète » : l'étiquette est partie sans les manquants, la
  // génération automatique « tout est scanné » ne doit plus se déclencher.
  const [forcedDone, setForcedDone] = useState(false);
  // Lots (`woosb`) retirés de la liste : leurs articles y sont déjà, à l'unité.
  const [hiddenPacks, setHiddenPacks] = useState([]);
  const [wrongShippingOrder, setWrongShippingOrder] = useState(null); // { orderNumber, denomination } si mode inconnu
  const [editingAddress, setEditingAddress] = useState(false); // édition adresse de livraison
  // Point relais : corrigeable sans quitter le packing. Un client appelle
  // parfois pour changer de point alors que le colis est déjà sur la table.
  const [editingRelay, setEditingRelay] = useState(false);
  const [relayForm, setRelayForm] = useState(null);
  const [relaySaving, setRelaySaving] = useState(false);
  const [relayError, setRelayError] = useState(null);
  const [addressForm, setAddressForm] = useState(null); // copie éditable de order.shipping
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressError, setAddressError] = useState(null);
  const [showManual, setShowManual] = useState(false); // pop-up expédition manuelle
  // Carton scanné dont on ignore encore la contenance (code GTIN-14 venu de BMS)
  const [packQtyPrompt, setPackQtyPrompt] = useState(null);
  const [manualForm, setManualForm] = useState(null); // champs destinataire saisis à la main
  const [manualLookupLoading, setManualLookupLoading] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState(null);
  const [manualInfo, setManualInfo] = useState(null);
  const [manualResult, setManualResult] = useState(null); // réponse de /shipments/label-manual
  // Services proposés (transporteur × mode), tirés de la correspondance des dénominations
  const [manualServices, setManualServices] = useState([]);
  // Livraison le samedi (Chrono 13 et Chrono Relais) : l'interrupteur n'existe
  // que le jeudi et le vendredi, coché d'office le vendredi, et seulement sur
  // une commande scannée qui s'y prête (le backend le dit : saturdayEligible).
  // Le jeudi soir, on le coche à la main si les colis partent le lendemain.
  const [jourCourant, setJourCourant] = useState(jourParis);
  const [samedi, setSamedi] = useState(() => jourParis() === 5);
  const samediVisible = (jourCourant === 4 || jourCourant === 5) && Boolean(carrier?.saturdayEligible);

  // Refs pour accéder aux valeurs courantes dans le listener clavier
  const orderRef = useRef(null);
  const itemsRef = useRef([]);
  const loadingRef = useRef(false);
  const scanBufferRef = useRef('');
  const isCompleteRef = useRef(false);
  const labelLoadingRef = useRef(false);
  const showManualRef = useRef(false);
  const packQtyPromptRef = useRef(null);
  const saturdayRef = useRef(false);

  useEffect(() => { orderRef.current = order; }, [order]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { scanBufferRef.current = scanBuffer; }, [scanBuffer]);
  useEffect(() => { isCompleteRef.current = isComplete; }, [isComplete]);
  useEffect(() => { labelLoadingRef.current = labelLoading; }, [labelLoading]);
  useEffect(() => { showManualRef.current = showManual; }, [showManual]);
  useEffect(() => { packQtyPromptRef.current = packQtyPrompt; }, [packQtyPrompt]);
  useEffect(() => { saturdayRef.current = samediVisible && samedi; }, [samediVisible, samedi]);

  // Poste resté ouvert d'un jour à l'autre : l'interrupteur reprend la valeur
  // du jour, pour qu'un choix du jeudi soir ne vaille pas le vendredi.
  useEffect(() => {
    const t = setInterval(() => setJourCourant(jourParis()), 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { setSamedi(jourCourant === 5); }, [jourCourant]);

  // Télécharger le PDF depuis base64
  /**
   * Télécharge l'étiquette. Le NOM DU FICHIER compte : AutoPrint s'en sert pour
   * choisir l'imprimante. Il est décidé par le backend, qui seul connaît le
   * transporteur — « LS-1259134.pdf » pour la lettre suivie,
   * « mondialrelay_1259134.pdf » pour Mondial Relay. Le repli sur « LS- » ne
   * sert plus qu'à une réimpression dont le transporteur a quitté le registre.
   */
  const downloadPdf = useCallback((base64, orderNumber, fileName) => {
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
    a.download = fileName || `LS-${orderNumber}.pdf`;
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
      // L'état de l'interrupteur part avec chaque étiquette ; seul Chronopost
      // (Chrono 13 et Relais) s'en sert, les autres l'ignorent.
      const res = await axios.post(`${API_URL}/shipments/label/${orderNumber}`, {
        saturdayDelivery: saturdayRef.current
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = res.data;

      // Un mode déclaré « sans étiquette » n'est pas une erreur : on le dit et
      // on s'arrête là, sans PDF ni bruit d'échec.
      if (data.noLabel) {
        setLabelData(null);
        setMessage(data.userMessage || 'Pas d\'étiquette pour ce mode de livraison');
        return;
      }

      setLabelData({
        pdfBase64: data.pdfBase64, trackingId: data.trackingId, orderNumber: data.orderNumber, fileName: data.fileName,
        cn23Base64: data.cn23Base64 || null, cn23FileName: data.cn23FileName || null
      });
      downloadPdf(data.pdfBase64, orderNumber, data.fileName);
      // Déclaration douanière (outre-mer, Royaume-Uni) : un SECOND fichier, que
      // AutoPrint envoie sur la Brother A4 d'après son nom (customs_document_*).
      if (data.cn23Base64) downloadPdf(data.cn23Base64, orderNumber, data.cn23FileName);
      const cn23 = data.cn23Base64 ? ' + declaration douaniere (CN23)' : '';
      setMessage(data.trackingId
        ? `Etiquette ${data.carrierLabel || ''} generee${cn23} — suivi : ${data.trackingId}`
        : `Etiquette ${data.carrierLabel || ''} generee${cn23}`);
      return true;
    } catch (err) {
      if (err.response?.status === 422 && err.response.data?.reason === 'unknown_shipping_method') {
        setLabelData(null);
        setWrongShippingOrder({
          orderNumber: err.response.data.orderNumber,
          denomination: err.response.data.denomination
        });
      } else if (err.response?.status === 409) {
        const data = err.response.data;
        setLabelData(null);
        setLabelError({ message: `Etiquette deja generee pour cette commande — suivi : ${data.trackingId}` });
      } else {
        const data = err.response?.data || {};
        const detail = data.details || data.error || 'Erreur generation etiquette';
        const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
        // userMessage : message clair pour le packing ; detail : technique pour le debug
        setLabelError({ message: data.userMessage || detailStr, detail: data.userMessage ? detailStr : null });
      }
      playSound('error');
    } finally {
      setLabelLoading(false);
    }
  }, [token, downloadPdf]);

  // Vérifier si tout est scanné → appel auto étiquette
  useEffect(() => {
    if (forcedDone) return;
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
  }, [items, isComplete, generateLabel, forcedDone]);

  // Charger une commande
  const loadOrder = useCallback(async (number) => {
    if (!number || loadingRef.current) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    setIsComplete(false);
    setEditingAddress(false);
    setAddressError(null);
    setPickingInfo(null);
    setForcedDone(false);

    try {
      // `scan` : seule l'ouverture au poste compte comme un scan (pas le
      // préremplissage de l'expédition manuelle, qui lit la même route).
      const res = await axios.get(`${API_URL}/packing/orders/${number}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { scan: 1 }
      });

      const loadedOrder = res.data.order;
      const resolu = res.data.carrier;

      // Un mode de livraison que personne n'a associé à un transporteur bloque
      // ici, avant que la personne ne scanne quoi que ce soit. Le libellé exact
      // est affiché pour qu'un responsable puisse le renseigner tel quel.
      if (!resolu || resolu.status === 'unknown') {
        setWrongShippingOrder({
          orderNumber: loadedOrder.wp_order_id,
          denomination: loadedOrder.shipping_method
        });
        playSound('error');
        return;
      }
      setCarrier(resolu);

      setOrder(loadedOrder);
      setWeight(res.data.weight || null);
      setHiddenPacks(res.data.hidden_packs || []);
      axios.get(`${API_URL}/packing/orders/${loadedOrder.wp_order_id}/picking`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => setPickingInfo(r.data)).catch(() => { /* sans picking, le packing marche comme avant */ });
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
      setWeight(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // ── Picking (lot 4) : commande à laquelle il manque des articles ─────────
  // Deux sorties : l'envoyer sans eux, ou la mettre de côté. Dans les deux cas
  // le serveur envoie un mail à contact@youvape.fr et ouvre un ticket SAV.
  const missingText = (pickingInfo?.missing || []).map(m => `${m.qty} × ${m.name}`).join(', ');

  const refreshPickingInfo = useCallback(async (orderNumber) => {
    try {
      const r = await axios.get(`${API_URL}/packing/orders/${orderNumber}/picking`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPickingInfo(r.data);
    } catch { /* affichage seulement */ }
  }, [token]);

  const pickingIncident = async (action) => {
    const r = await axios.post(`${API_URL}/packing/orders/${order.wp_order_id}/${action}`, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = r.data;
    const suite = d.already
      ? 'déjà signalée'
      : `ticket SAV${d.ticketId ? ` #${d.ticketId}` : ' NON créé'}, ${d.mailSent ? 'mail envoyé à contact@youvape.fr' : `mail NON envoyé (${d.mailError})`}`;
    await refreshPickingInfo(order.wp_order_id);
    return suite;
  };

  const sendIncomplete = async () => {
    if (!order || pickingBusy) return;
    if (!window.confirm(`Envoyer la commande ${order.wp_order_id} SANS :\n${missingText} ?\n\nL'étiquette va être générée.`)) return;
    setPickingBusy(true);
    try {
      const ok = await generateLabel(order.wp_order_id);
      if (!ok) return;
      setForcedDone(true);
      setIsComplete(true);
      const suite = await pickingIncident('incomplete');
      setMessage(`Commande envoyée incomplète — ${suite}`);
      playSound('complete');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du signalement de la commande incomplète');
      playSound('error');
    } finally {
      setPickingBusy(false);
    }
  };

  const setAside = async () => {
    if (!order || pickingBusy) return;
    if (!window.confirm(`Mettre de côté la commande ${order.wp_order_id} ?\nIl manque : ${missingText}`)) return;
    setPickingBusy(true);
    try {
      const suite = await pickingIncident('set-aside');
      setMessage(`Commande mise de côté (bloquée dans le Picking) — ${suite}`);
      playSound('ok');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise de côté');
      playSound('error');
    } finally {
      setPickingBusy(false);
    }
  };

  // Ouvrir le formulaire d'édition de l'adresse
  const startEditAddress = useCallback(() => {
    if (!order) return;
    setAddressForm({
      first_name: order.shipping.first_name || '',
      last_name: order.shipping.last_name || '',
      company: order.shipping.company || '',
      address: order.shipping.address || '',
      address_2: order.shipping.address_2 || '',
      postcode: order.shipping.postcode || '',
      city: order.shipping.city || '',
      phone: order.shipping.phone || ''
    });
    setAddressError(null);
    setEditingAddress(true);
  }, [order]);

  // Enregistrer l'adresse corrigée
  const saveAddress = useCallback(async () => {
    if (!order || !addressForm) return;
    if (!addressForm.address.trim() || !addressForm.city.trim() || !addressForm.postcode.trim()) {
      setAddressError('Adresse, code postal et ville sont obligatoires');
      return;
    }
    setAddressSaving(true);
    setAddressError(null);
    try {
      const res = await axios.put(
        `${API_URL}/packing/orders/${order.wp_order_id}/shipping`,
        addressForm,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setOrder(prev => ({ ...prev, shipping: res.data.shipping }));
      setEditingAddress(false);
      setMessage('Adresse mise à jour');
      playSound('ok');
    } catch (err) {
      setAddressError(err.response?.data?.error || 'Erreur lors de la mise à jour');
      playSound('error');
    } finally {
      setAddressSaving(false);
    }
  }, [order, addressForm, token]);

  // ── Point relais ──────────────────────────────────────────────────────────
  // L'enregistrement passe par la même route que la fiche commande, donc par le
  // même contrôle : un point accepté ici ne sera jamais refusé à l'étiquetage.
  // Il est stocké à part (relay_point_manual), hors d'atteinte de la synchro
  // WooCommerce, qui écraserait sinon la correction au premier changement de
  // statut.
  const startEditRelay = useCallback(() => {
    if (!order) return;
    const actuel = order.relay_point || null;
    const attendu = order.relay_point_options?.expected || null;
    setRelayForm({
      network: order.relay_point_manual?.network || attendu?.code || actuel?.network
        || order.relay_point_options?.networks?.[0]?.code || '',
      id: order.relay_point_manual?.id || '',
      country: actuel?.country || order.shipping?.country || 'FR'
    });
    setRelayError(null);
    setEditingRelay(true);
  }, [order]);

  const saveRelay = useCallback(async () => {
    if (!order || !relayForm) return;
    setRelaySaving(true);
    setRelayError(null);
    try {
      const res = await axios.put(
        `${API_URL}/orders/${order.wp_order_id}/relay-point`,
        relayForm,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const saisi = res.data.data.relay_point_manual;
      setOrder(prev => ({ ...prev, relay_point: saisi, relay_point_manual: saisi }));
      setEditingRelay(false);
      setMessage(`Point relais mis a jour : ${saisi.id}`);
      playSound('ok');
    } catch (err) {
      setRelayError(err.response?.data?.error || 'Enregistrement impossible');
      playSound('error');
    } finally {
      setRelaySaving(false);
    }
  }, [order, relayForm, token]);

  // Retirer la correction : le point choisi par le client reprend la main.
  const clearRelay = useCallback(async () => {
    if (!order) return;
    setRelaySaving(true);
    setRelayError(null);
    try {
      const res = await axios.delete(
        `${API_URL}/orders/${order.wp_order_id}/relay-point`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const wc = res.data?.data?.relay_point || null;
      setOrder(prev => ({ ...prev, relay_point: wc, relay_point_manual: null }));
      setEditingRelay(false);
      setMessage('Point relais saisi retire');
      playSound('ok');
    } catch (err) {
      setRelayError(err.response?.data?.error || 'Suppression impossible');
      playSound('error');
    } finally {
      setRelaySaving(false);
    }
  }, [order, token]);

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

      // Code de carton ingéré depuis BMS : le GTIN-14 n'encode pas le nombre
      // d'unités. Sans la question, le `|| 1` du backend ferait compter UNE unité
      // pour un carton entier — une erreur silencieuse. On demande une fois, on
      // enregistre, et le scan est rejoué avec la bonne quantité.
      if (barcodeData.type === 'pack' && !barcodeData.quantity_known) {
        setPackQtyPrompt({
          barcode, name: barcodeData.name, wp_product_id: barcodeData.wp_product_id,
        });
        return;
      }

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

  // --- Expédition manuelle (regénération d'étiquette / envoi hors commande) ---

  const openManualShipment = useCallback(async () => {
    setManualForm({ ...EMPTY_MANUAL_FORM, saturday: jourParis() === 5 });
    setManualError(null);
    setManualInfo(null);
    setManualResult(null);
    setShowManual(true);
    try {
      const res = await axios.get(`${API_URL}/shipments/manual-services`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const services = res.data.services || [];
      setManualServices(services);
      // La lettre suivie reste le choix par défaut : c'était le seul possible.
      const defaut = services.find(sv => sv.carrierCode === 'laposte') || services[0];
      if (defaut) setManualForm(f => (f && !f.serviceKey ? withManualService(f, services, defaut.key) : f));
    } catch (err) {
      setManualError('Impossible de charger la liste des transporteurs');
    }
  }, [token]);

  const closeManualShipment = useCallback(() => {
    setShowManual(false);
    setManualForm(null);
    setManualError(null);
    setManualInfo(null);
    setManualResult(null);
  }, []);

  // Préremplir l'adresse depuis une commande existante (facultatif : on peut tout saisir)
  const lookupManualOrder = useCallback(async () => {
    const number = (manualForm?.orderNumber || '').trim();
    if (!number) {
      setManualError('Saisissez d\'abord un numéro de commande');
      return;
    }
    setManualLookupLoading(true);
    setManualError(null);
    setManualInfo(null);
    try {
      const res = await axios.get(`${API_URL}/packing/orders/${number}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const loaded = res.data.order;
      const s = loaded.shipping || {};
      const carrier = res.data.carrier;
      // Le service de la commande est présélectionné, et avec lui son point
      // relais (celui saisi dans la fiche commande prime sur WooCommerce).
      const serviceCommande = carrier?.status === 'mapped'
        ? manualServices.find(sv => sv.carrierCode === carrier.carrierCode
          && (sv.accountCode || '') === (carrier.accountCode || '')
          && (sv.deliveryMode || '') === (carrier.deliveryMode || ''))
        : null;
      const poids = res.data.weight?.total_g;
      const point = loaded.relay_point?.id ? loaded.relay_point : null;
      setManualForm(f => {
        const next = {
          ...f,
          orderNumber: String(loaded.wp_order_id),
          first_name: s.first_name || '',
          last_name: s.last_name || '',
          company: s.company || '',
          address: s.address || '',
          address_2: s.address_2 || '',
          postcode: s.postcode || '',
          city: s.city || '',
          country: s.country || 'FR',
          // Téléphone de livraison vide sur toutes les commandes Bpost : repli
          // sur celui de facturation, que Colissimo exige en point de retrait.
          phone: s.phone || loaded.billing_phone || '',
          email: loaded.email || '',
          weight: poids > 0 ? String(Math.round(poids)) : '',
          loadedRelay: point
        };
        return withManualService(next, manualServices, serviceCommande ? serviceCommande.key : f.serviceKey);
      });
      setManualInfo(
        `Adresse chargée depuis la commande #${loaded.wp_order_id}`
        + (serviceCommande
          ? ` — ${manualServiceLabel(serviceCommande)}`
          : ` — mode de livraison « ${loaded.shipping_method || 'vide'} » sans transporteur : choisissez-en un`)
        + (point ? ` — point relais ${point.id}${point.name ? ` (${point.name})` : ''}` : '')
      );
      playSound('ok');
    } catch (err) {
      if (err.response?.status === 404) {
        setManualInfo(`Commande #${number} introuvable — saisissez l'adresse à la main`);
      } else {
        setManualError('Erreur lors du chargement de la commande');
      }
      playSound('error');
    } finally {
      setManualLookupLoading(false);
    }
  }, [manualForm, manualServices, token]);

  const submitManualLabel = useCallback(async () => {
    if (!manualForm) return;
    if (!manualForm.orderNumber.trim()) {
      setManualError('Numéro de commande obligatoire');
      return;
    }
    if (!manualForm.address.trim() || !manualForm.postcode.trim() || !manualForm.city.trim()) {
      setManualError('Adresse, code postal et ville sont obligatoires');
      return;
    }
    if (!manualForm.first_name.trim() && !manualForm.last_name.trim() && !manualForm.company.trim()) {
      setManualError('Nom ou société du destinataire obligatoire');
      return;
    }
    const sv = manualServices.find(x => x.key === manualForm.serviceKey);
    if (!sv) {
      setManualError('Choisissez un transporteur');
      return;
    }
    if (!sv.fixedWeight && !(Number(manualForm.weight) > 0)) {
      setManualError(`Poids obligatoire pour ${sv.carrierLabel} (en grammes)`);
      return;
    }
    if (sv.requiresRelayPoint && !manualForm.relayId.trim()) {
      setManualError(`Numéro de point relais obligatoire pour ${manualServiceLabel(sv)}`);
      return;
    }
    setManualSaving(true);
    setManualError(null);
    try {
      const f = manualForm;
      const res = await axios.post(`${API_URL}/shipments/label-manual`, {
        service: { carrierCode: sv.carrierCode, accountCode: sv.accountCode, deliveryMode: sv.deliveryMode },
        orderNumber: f.orderNumber,
        first_name: f.first_name, last_name: f.last_name, company: f.company,
        address: f.address, address_2: f.address_2, postcode: f.postcode, city: f.city,
        country: f.country, phone: f.phone, email: f.email,
        weightGrams: sv.fixedWeight ? null : Number(f.weight),
        relayPoint: sv.requiresRelayPoint
          ? { ...(f.relayDetails || {}), network: sv.carrierCode, id: f.relayId.trim(), country: f.relayCountry }
          : null,
        // Même règle que le packing : l'interrupteur n'existe que jeudi et vendredi.
        saturdayDelivery: sv.saturdayEligible && (jourCourant === 4 || jourCourant === 5) ? f.saturday : undefined
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = res.data;
      setManualResult(data);
      downloadPdf(data.pdfBase64, data.orderNumber, data.fileName);
      // Déclaration douanière : second fichier, pour la Brother A4.
      if (data.cn23Base64) downloadPdf(data.cn23Base64, data.orderNumber, data.cn23FileName);
      playSound('complete');
    } catch (err) {
      const data = err.response?.data || {};
      const detail = data.details || data.error || 'Erreur génération étiquette';
      setManualError(data.userMessage || (typeof detail === 'string' ? detail : JSON.stringify(detail)));
      playSound('error');
    } finally {
      setManualSaving(false);
    }
  }, [manualForm, manualServices, jourCourant, token, downloadPdf]);

  // Réinitialiser
  const handleReset = useCallback(() => {
    setOrder(null);
    setWeight(null);
    setItems([]);
    setError(null);
    setMessage(null);
    setIsComplete(false);
    setManualInput('');
    setLabelData(null);
    setLabelError(null);
    setLabelLoading(false);
    setWrongShippingOrder(null);
    setCarrier(null);
    setHiddenPacks([]);
    setEditingRelay(false);
    setRelayForm(null);
    setRelayError(null);
  }, []);

  // Listener clavier global — capture les scans sans champ de saisie
  useEffect(() => {
    let buffer = '';
    let timeout = null;

    const handleKeyDown = (e) => {
      // Ignorer si on est dans un input (boutons manuels etc.)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // Pop-up expédition manuelle ouverte : ne pas charger de commande en arrière-plan
      if (showManualRef.current) return;
      // Question de contenance ouverte : le scan attend la réponse
      if (packQtyPromptRef.current) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        const value = buffer.trim();
        buffer = '';
        setScanBuffer('');

        if (!value) return;

        if (!orderRef.current || isCompleteRef.current) {
          // Empêcher de charger la commande suivante tant que l'étiquette en cours
          // n'est pas revenue de La Poste : deux POST /label simultanés peuvent
          // répondre dans le désordre → étiquettes imprimées inversées entre colis.
          if (labelLoadingRef.current) {
            setError('Étiquette en cours de génération — attendez avant de scanner la commande suivante');
            playSound('error');
            return;
          }
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
    if (!order || isComplete) {
      // Même garde-fou que le scan : pas de nouvelle commande tant que
      // l'étiquette précédente n'est pas revenue (évite l'inversion d'impression).
      if (labelLoading) {
        setError('Étiquette en cours de génération — attendez avant de charger la commande suivante');
        playSound('error');
        return;
      }
      loadOrder(value);
    } else {
      handleScan(value);
    }
  };

  // Les quatre boutons manuels agissent par IDENTIFIANT de ligne, pas par position.
  // L'ordre d'affichage n'est plus celui du tableau d'état — les lignes complètes
  // descendent en bas — donc un index d'affichage désignerait un autre article.
  const modifierLigne = (itemId, transforme) => {
    setItems(prev => prev.map(item => (item.id === itemId ? transforme({ ...item }) : item)));
  };

  // Incrémenter manuellement (+1)
  const handleManualIncrement = (itemId) => {
    modifierLigne(itemId, item => {
      if (item.scanned < item.qty) {
        item.scanned += 1;
        playSound('ok');
        setMessage(`${item.name} - ${item.scanned}/${item.qty}`);
      }
      return item;
    });
  };

  // Incrémenter tout (++)
  const handleManualIncrementAll = (itemId) => {
    modifierLigne(itemId, item => {
      if (item.scanned < item.qty) {
        item.scanned = item.qty;
        playSound('ok');
        setMessage(`${item.name} - ${item.scanned}/${item.qty}`);
      }
      return item;
    });
  };

  // Décrémenter manuellement (-1)
  const handleManualDecrement = (itemId) => {
    modifierLigne(itemId, item => {
      if (item.scanned > 0) item.scanned -= 1;
      return item;
    });
  };

  // Décrémenter tout (--)
  const handleManualDecrementAll = (itemId) => {
    modifierLigne(itemId, item => {
      if (item.scanned > 0) item.scanned = 0;
      return item;
    });
  };

  // Ordre d'affichage : ce qui reste à scanner en haut, ce qui est complet en bas.
  // La liste se vide par le haut, au lieu d'obliger à chercher les lignes
  // incomplètes entre les vertes. Même comportement pour tous les transporteurs :
  // le tri ne dépend que de l'avancement du scan.
  //
  // Tri stable : à état égal, l'ordre d'origine de la commande est conservé. Sans
  // le départage par index d'origine, deux lignes pourraient permuter d'un rendu à
  // l'autre et faire sauter la ligne sous le doigt du préparateur.
  const itemsAffiches = trierParAvancement(items, item => (item.scanned >= item.qty ? 1 : 0));

  // Couleur de ligne — mêmes teintes qu'à la réception, pour que les deux écrans
  // se lisent pareil. Volontairement saturées : le préparateur lit l'état d'une
  // ligne d'un coup d'œil, à un mètre, souvent debout.
  //
  // Ce sont les couleurs demandées (#1DDB55, #DBB01D, #DB311D) ramenées à 55 %
  // sur fond blanc. Le rouge PLEIN tombe à 3,8 de contraste avec le texte, sous
  // le seuil de lisibilité de 4,5 ; à 55 % il remonte à 8,0 en restant franc.
  const getRowColor = (item) => {
    if (item.scanned >= item.qty) return '#83EBA2';  // complet
    if (item.scanned > 0) return '#EBD483';          // partiel
    return '#EB8E83';                                // rien scanné
  };

  return (
    <AppShell currentPath="/packing">
    <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
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
          <LinkBox
            to="/home"
            display="inline-block"
            style={{
              background: 'rgba(255,255,255,0.2)',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '14px'
            }}
          >
            Retour
          </LinkBox>
          <h1 style={{ margin: 0, fontSize: '22px' }}>Packing</h1>
          <button
            onClick={openManualShipment}
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
            Expedition manuelle
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
          {order && (
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
      <div style={{ flex: 1, maxWidth: '940px', margin: '0 auto', padding: '20px', width: '100%' }}>

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
            {/* Chez qui part ce colis — lisible sans lire. Le préparateur
                enchaîne les commandes : la couleur le renseigne avant même
                qu'il ait lu le libellé. */}
            {carrier && carrier.status === 'mapped' && (() => {
              const v = visuelTransporteur(carrier.carrierCode, carrier.accountCode);
              return (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
                  backgroundColor: v.fond, borderLeft: `10px solid ${v.couleur}`,
                  borderRadius: '12px', padding: '16px 20px', marginTop: '15px'
                }}>
                  {v.logo ? (
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      backgroundColor: 'white', borderRadius: '8px', padding: '6px 12px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.12)'
                    }}>
                      <img src={v.logo} alt={v.label} style={{ height: '40px', width: 'auto', display: 'block' }} />
                      {v.mention && (
                        <span style={{
                          padding: '6px 12px', borderRadius: '6px',
                          backgroundColor: v.couleur, color: v.encre,
                          fontSize: '16px', fontWeight: 800, whiteSpace: 'nowrap'
                        }}>{v.mention}</span>
                      )}
                    </span>
                  ) : (
                    <span style={{
                      padding: '8px 16px', borderRadius: '6px',
                      backgroundColor: v.couleur, color: v.encre,
                      fontSize: '16px', fontWeight: 800, letterSpacing: '0.6px', whiteSpace: 'nowrap'
                    }}>{v.court}</span>
                  )}
                  <span style={{ color: '#333', fontSize: '15px' }}>{carrier.denomination}</span>
                  {samediVisible && (
                    <label
                      title="Chrono 13 domicile et Chrono Relais livrés le samedi"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto',
                        background: samedi ? '#FFCC00' : 'white',
                        color: '#1f2937',
                        border: `2px solid ${samedi ? '#FFCC00' : '#ccc'}`,
                        padding: '8px 14px', borderRadius: '6px', cursor: 'pointer',
                        fontSize: '15px', fontWeight: samedi ? 700 : 400
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={samedi}
                        onChange={(e) => setSamedi(e.target.checked)}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                      Livraison samedi
                    </label>
                  )}
                </div>
              );
            })()}
            {carrier && carrier.status === 'no_label' && (
              <div style={{
                backgroundColor: '#f1f3f5', borderLeft: '10px solid #adb5bd',
                borderRadius: '12px', padding: '16px 20px', marginTop: '15px', color: '#495057'
              }}>
                <strong>{carrier.denomination}</strong> — aucune étiquette à imprimer pour ce mode de livraison.
              </div>
            )}

            {/* Picking : vague, ticket SAV, manquants */}
            {pickingInfo?.wave && (
              <div style={{ marginTop: '10px', fontSize: '14px', color: '#6b7280' }}>
                Vague <strong style={{ fontFamily: 'monospace', color: '#7C3AED' }}>{pickingInfo.wave.waveNumber}</strong>
              </div>
            )}
            {pickingInfo?.tickets?.length > 0 && (
              <div style={{
                backgroundColor: '#DBEAFE', borderLeft: '10px solid #1D4ED8', borderRadius: '12px',
                padding: '14px 20px', marginTop: '15px', color: '#1e3a8a', fontSize: '16px'
              }}>
                <strong>Ticket SAV</strong> sur cette commande — une modification a peut-être été demandée :{' '}
                {pickingInfo.tickets.map(t => (
                  <a key={t.id} href={`/tickets/${t.id}`} target="_blank" rel="noreferrer" style={{ color: '#1D4ED8', fontWeight: 700, marginRight: '12px' }}>
                    #{t.id} ({t.status})
                  </a>
                ))}
              </div>
            )}
            {pickingInfo?.missing?.length > 0 && (() => {
              const done = pickingInfo.incidents || [];
              const sent = done.find(i => i.action === 'incomplete');
              const aside = done.find(i => i.action === 'set_aside');
              return (
                <div style={{
                  backgroundColor: '#FEE2E2', borderLeft: '10px solid #DC2626', borderRadius: '12px',
                  padding: '16px 20px', marginTop: '15px', color: '#7f1d1d'
                }}>
                  <div style={{ fontSize: '18px', fontWeight: 800 }}>Articles manquants au picking</div>
                  <div style={{ fontSize: '16px', marginTop: '6px' }}>
                    Cette commande : {pickingInfo.missing.map(m => `${m.qty} × ${m.name}`).join(', ')}. Ne les cherchez pas.
                  </div>
                  {sent || aside ? (
                    <div style={{ marginTop: '10px', fontWeight: 700 }}>
                      {sent ? 'Envoyée incomplète' : 'Mise de côté'}
                      {(sent || aside).ticketId ? ` — ticket SAV #${(sent || aside).ticketId}` : ''}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
                      <button onClick={sendIncomplete} disabled={pickingBusy || labelLoading} style={{
                        padding: '10px 18px', borderRadius: '8px', border: 'none', backgroundColor: '#DC2626',
                        color: 'white', fontSize: '16px', fontWeight: 700, cursor: 'pointer'
                      }}>Envoyer incomplète</button>
                      <button onClick={setAside} disabled={pickingBusy || labelLoading} style={{
                        padding: '10px 18px', borderRadius: '8px', border: '2px solid #DC2626', backgroundColor: 'white',
                        color: '#DC2626', fontSize: '16px', fontWeight: 700, cursor: 'pointer'
                      }}>Mettre de côté</button>
                    </div>
                  )}
                </div>
              );
            })()}

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
                  {order.shipping.address_2 && (
                    <p style={{ margin: '2px 0 0', color: '#999', fontSize: '14px' }}>
                      {order.shipping.address_2}
                    </p>
                  )}

                  {/* Point relais — affiché quand le mode de livraison en exige un,
                      ou quand la commande en porte déjà un. Corrigeable ici même :
                      un client demande parfois un autre point alors que le colis
                      est sur la table, et aller le changer dans l'app Commandes
                      ferait perdre la commande en cours de scan. */}
                  {(order.relay_point || order.relay_point_options?.expected) && (
                    <div style={{ marginTop: '10px' }}>
                      {!editingRelay ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '14px', color: '#555' }}>
                            <strong>Point relais :</strong>{' '}
                            {order.relay_point ? (
                              <span style={{ fontWeight: 700, color: '#333' }}>
                                {order.relay_point.id}
                                <span style={{ fontWeight: 500, color: '#888' }}>
                                  {' · '}
                                  {order.relay_point_options?.networks?.find(n => n.code === order.relay_point.network)?.label
                                    || order.relay_point.network}
                                  {order.relay_point.country ? ` ${order.relay_point.country}` : ''}
                                </span>
                              </span>
                            ) : (
                              <span style={{ fontWeight: 700, color: '#dc2626' }}>Aucun</span>
                            )}
                          </span>
                          {order.relay_point_manual && (
                            <span style={{ fontSize: '12px', color: '#888' }}>
                              saisi par {order.relay_point_manual.entered_by || 'inconnu'}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={startEditRelay}
                            style={{
                              padding: '5px 12px', backgroundColor: 'white', color: '#6366f1',
                              border: '1px solid #6366f1', borderRadius: '6px',
                              fontSize: '13px', fontWeight: '600', cursor: 'pointer'
                            }}
                          >
                            📍 Modifier le point relais
                          </button>
                        </div>
                      ) : (
                        <div style={{
                          padding: '12px', border: '1px solid #c7d2fe', borderRadius: '8px',
                          backgroundColor: '#eef2ff'
                        }}>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <select
                              value={relayForm.network}
                              onChange={e => setRelayForm(f => ({ ...f, network: e.target.value }))}
                              style={{ ...CHAMP_RELAIS, minWidth: '160px' }}
                            >
                              {(order.relay_point_options?.networks || []).map(n => (
                                <option key={n.code} value={n.code}>{n.label}</option>
                              ))}
                            </select>
                            <input
                              style={{ ...CHAMP_RELAIS, width: '140px' }}
                              placeholder="N° du point"
                              value={relayForm.id}
                              onChange={e => setRelayForm(f => ({ ...f, id: e.target.value }))}
                              autoFocus
                            />
                            <input
                              style={{ ...CHAMP_RELAIS, width: '70px' }}
                              placeholder="Pays"
                              value={relayForm.country}
                              onChange={e => setRelayForm(f => ({ ...f, country: e.target.value.toUpperCase() }))}
                            />
                            <button
                              type="button" onClick={saveRelay} disabled={relaySaving}
                              style={{
                                padding: '8px 16px', backgroundColor: relaySaving ? '#9ca3af' : '#16a34a',
                                color: 'white', border: 'none', borderRadius: '8px',
                                fontSize: '14px', fontWeight: '600', cursor: relaySaving ? 'default' : 'pointer'
                              }}
                            >
                              {relaySaving ? '…' : 'Enregistrer'}
                            </button>
                            {order.relay_point_manual && (
                              <button
                                type="button" onClick={clearRelay} disabled={relaySaving}
                                title="Revenir au point choisi par le client"
                                style={{
                                  padding: '8px 14px', backgroundColor: 'white', color: '#dc2626',
                                  border: '1px solid #dc2626', borderRadius: '8px',
                                  fontSize: '14px', fontWeight: '600', cursor: relaySaving ? 'default' : 'pointer'
                                }}
                              >
                                Retirer
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => { setEditingRelay(false); setRelayError(null); }}
                              disabled={relaySaving}
                              style={{
                                padding: '8px 14px', backgroundColor: '#e5e7eb', color: '#374151',
                                border: 'none', borderRadius: '8px',
                                fontSize: '14px', fontWeight: '600', cursor: relaySaving ? 'default' : 'pointer'
                              }}
                            >
                              Annuler
                            </button>
                          </div>
                          {relayError && (
                            <p style={{ margin: '10px 0 0', color: '#dc2626', fontSize: '14px' }}>{relayError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {!editingAddress && (
                    <button
                      type="button"
                      onClick={startEditAddress}
                      style={{
                        marginTop: '8px',
                        padding: '5px 12px',
                        backgroundColor: 'white',
                        color: '#6366f1',
                        border: '1px solid #6366f1',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      ✏️ Modifier l'adresse
                    </button>
                  )}
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
                    {weight?.total_g != null
                      ? `${weight.total_g} g${weight.packaging_g ? ` (dont ${weight.packaging_g} g d'emballage)` : ''}`
                      : '—'}
                  </p>
                </div>
              </div>

              {/* Formulaire d'édition de l'adresse de livraison */}
              {editingAddress && addressForm && (
                <div style={{
                  marginTop: '15px',
                  paddingTop: '15px',
                  borderTop: '1px solid #eee'
                }}>
                  <h3 style={{ margin: '0 0 12px', color: '#333', fontSize: '16px' }}>
                    Corriger l'adresse de livraison
                  </h3>
                  {(() => {
                    const inputStyle = {
                      width: '100%',
                      padding: '9px 12px',
                      fontSize: '15px',
                      border: '2px solid #ddd',
                      borderRadius: '8px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    };
                    const set = (field) => (e) => setAddressForm(f => ({ ...f, [field]: e.target.value }));
                    return (
                      <div style={{ display: 'grid', gap: '10px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <input style={inputStyle} placeholder="Prénom" value={addressForm.first_name} onChange={set('first_name')} />
                          <input style={inputStyle} placeholder="Nom" value={addressForm.last_name} onChange={set('last_name')} />
                        </div>
                        <input style={inputStyle} placeholder="Société (optionnel)" value={addressForm.company} onChange={set('company')} />
                        <input style={inputStyle} placeholder="Adresse" value={addressForm.address} onChange={set('address')} />
                        <input style={inputStyle} placeholder="Complément d'adresse (optionnel)" value={addressForm.address_2} onChange={set('address_2')} />
                        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '10px' }}>
                          <input style={inputStyle} placeholder="Code postal" value={addressForm.postcode} onChange={set('postcode')} />
                          <input style={inputStyle} placeholder="Ville" value={addressForm.city} onChange={set('city')} />
                        </div>
                        <input style={inputStyle} placeholder="Téléphone (optionnel)" value={addressForm.phone} onChange={set('phone')} />
                      </div>
                    );
                  })()}

                  {addressError && (
                    <p style={{ margin: '10px 0 0', color: '#dc2626', fontSize: '14px' }}>
                      {addressError}
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                    <button
                      type="button"
                      onClick={saveAddress}
                      disabled={addressSaving}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: addressSaving ? '#9ca3af' : '#16a34a',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '15px',
                        fontWeight: '600',
                        cursor: addressSaving ? 'default' : 'pointer'
                      }}
                    >
                      {addressSaving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingAddress(false); setAddressError(null); }}
                      disabled={addressSaving}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: 'white',
                        color: '#666',
                        border: '1px solid #ddd',
                        borderRadius: '8px',
                        fontSize: '15px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
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

            {/* Un lot figure sur la commande mais ne s'emballe pas : sans cette
                mention, le préparateur chercherait un article absent de la liste. */}
            {hiddenPacks.length > 0 && (
              <div style={{
                marginTop: '15px', padding: '12px 18px', borderRadius: '10px',
                backgroundColor: '#eef2ff', color: '#3730a3', fontSize: '15px'
              }}>
                <strong>Rien à emballer pour :</strong>{' '}
                {hiddenPacks.map(p => `${p.name}${p.qty > 1 ? ` ×${p.qty}` : ''}`).join(', ')}
                {' '}— lot{hiddenPacks.length > 1 ? 's' : ''} virtuel{hiddenPacks.length > 1 ? 's' : ''}, ses articles sont listés ci-dessous à l'unité.
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
                    <th style={{ padding: '13px 10px', width: '62px' }}></th>
                    <th style={{ padding: '13px 20px', textAlign: 'left', fontSize: '16px', color: '#666' }}>Article</th>
                    <th style={{ padding: '13px 20px', textAlign: 'center', fontSize: '16px', color: '#666', width: '100px' }}>SKU</th>
                    <th style={{ padding: '13px 20px', textAlign: 'center', fontSize: '16px', color: '#666', width: '325px' }}>Quantite</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsAffiches.map((item) => (
                    <tr
                      key={item.id}
                      style={{
                        backgroundColor: getRowColor(item),
                        transition: 'background-color 0.3s ease'
                      }}
                    >
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt=""
                            style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '4px', cursor: 'pointer' }}
                            onMouseEnter={(e) => {
                              const rect = e.target.getBoundingClientRect();
                              setHoveredImage({ url: item.image_url, x: rect.right + 10, y: rect.top });
                            }}
                            onMouseLeave={() => setHoveredImage(null)}
                          />
                        ) : (
                          <div style={{ width: '50px', height: '50px', backgroundColor: '#e5e7eb', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '18px' }}>?</div>
                        )}
                      </td>
                      <td style={{ padding: '18px 20px', fontSize: '19px', fontWeight: '500' }}>
                        {item.name}
                        {(() => {
                          const m = (pickingInfo?.missing || []).find(x => x.sku && x.sku === item.sku);
                          return m ? (
                            <span style={{
                              marginLeft: '10px', padding: '3px 10px', borderRadius: '999px', backgroundColor: '#DC2626',
                              color: 'white', fontSize: '14px', fontWeight: 700, whiteSpace: 'nowrap'
                            }}>Manquant : {m.qty}</span>
                          ) : null;
                        })()}
                      </td>
                      <td style={{ padding: '18px 20px', textAlign: 'center', fontSize: '16px', color: '#666' }}>
                        {item.sku || '-'}
                      </td>
                      <td style={{ padding: '18px 20px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '5px' }}>
                          <button
                            onClick={() => handleManualDecrementAll(item.id)}
                            disabled={item.scanned === 0}
                            style={{
                              width: '45px',
                              height: '40px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#dee2e6',
                              color: item.scanned === 0 ? '#adb5bd' : '#dc3545',
                              cursor: item.scanned === 0 ? 'default' : 'pointer',
                              fontSize: '16px',
                              fontWeight: '700'
                            }}
                          >
                            --
                          </button>
                          <button
                            onClick={() => handleManualDecrement(item.id)}
                            disabled={item.scanned === 0}
                            style={{
                              width: '45px',
                              height: '40px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#dee2e6',
                              color: item.scanned === 0 ? '#adb5bd' : '#dc3545',
                              cursor: item.scanned === 0 ? 'default' : 'pointer',
                              fontSize: '20px',
                              fontWeight: '700'
                            }}
                          >
                            -
                          </button>
                          <span style={{
                            fontSize: '22px',
                            fontWeight: '700',
                            minWidth: '62px',
                            textAlign: 'center',
                            color: item.scanned >= item.qty ? '#155724' : item.scanned > 0 ? '#856404' : '#721c24'
                          }}>
                            {item.scanned}/{item.qty}
                          </span>
                          <button
                            onClick={() => handleManualIncrement(item.id)}
                            disabled={item.scanned >= item.qty}
                            style={{
                              width: '45px',
                              height: '40px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#dee2e6',
                              color: item.scanned >= item.qty ? '#adb5bd' : '#28a745',
                              cursor: item.scanned >= item.qty ? 'default' : 'pointer',
                              fontSize: '20px',
                              fontWeight: '700'
                            }}
                          >
                            +
                          </button>
                          <button
                            onClick={() => handleManualIncrementAll(item.id)}
                            disabled={item.scanned >= item.qty}
                            style={{
                              width: '45px',
                              height: '40px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#dee2e6',
                              color: item.scanned >= item.qty ? '#adb5bd' : '#28a745',
                              cursor: item.scanned >= item.qty ? 'default' : 'pointer',
                              fontSize: '20px',
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
                    <div>Erreur etiquette : {labelError.message}</div>
                    {labelError.detail && (
                      <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.7, wordBreak: 'break-word' }}>
                        Détail technique : {labelError.detail}
                      </div>
                    )}
                  </div>
                )}

                {labelData && (
                  <div style={{ margin: '0 0 15px' }}>
                    <p style={{ color: '#155724', margin: '0 0 10px', fontSize: '15px' }}>
                      N° suivi : <strong>{labelData.trackingId}</strong>
                    </p>
                    <button
                      onClick={() => downloadPdf(labelData.pdfBase64, labelData.orderNumber, labelData.fileName)}
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
                    {labelData.cn23Base64 && (
                      <button
                        onClick={() => downloadPdf(labelData.cn23Base64, labelData.orderNumber, labelData.cn23FileName)}
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
                        Re-telecharger la CN23
                      </button>
                    )}
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
      </div>

      {/* Pop-up expédition manuelle */}
      {packQtyPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 460, width: '100%',
            boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 800, color: '#135E84' }}>
              Vous scannez un carton — quelle quantité contient-il ?
            </h3>
            <p style={{ fontSize: 14, color: '#111827', margin: '0 0 4px' }}>{packQtyPrompt.name}</p>
            <p style={{ fontSize: 12.5, color: '#6B7280', margin: '0 0 18px' }}>
              Code <strong>{packQtyPrompt.barcode}</strong> — la contenance est enregistrée
              définitivement, la question ne sera plus posée.
            </p>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const qty = parseInt(new FormData(e.target).get('qty'));
              if (!(qty > 0)) return;
              const { barcode: code, wp_product_id } = packQtyPrompt;
              try {
                await axios.post(`${API_URL}/products/${wp_product_id}/barcodes`,
                  { barcode: code, type: 'pack', quantity: qty },
                  { headers: { Authorization: `Bearer ${token}` } });
                setPackQtyPrompt(null);
                handleScan(code);   // rejoue le scan, la quantité est maintenant connue
              } catch {
                setError("La contenance n'a pas pu être enregistrée");
                setPackQtyPrompt(null);
              }
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input name="qty" type="number" min="1" autoFocus placeholder="ex. 10"
                  style={{ width: 110, padding: '9px 11px', textAlign: 'center', fontSize: 15,
                    fontWeight: 700, borderRadius: 8, border: '1px solid #E5E7EB' }} />
                <span style={{ fontSize: 13.5, color: '#6B7280' }}>unités par carton</span>
                <button type="submit" style={{ marginLeft: 'auto', background: '#E28F00', color: '#fff',
                  border: 'none', padding: '9px 17px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                  Enregistrer
                </button>
              </div>
            </form>
            <button onClick={() => setPackQtyPrompt(null)} style={{ marginTop: 14, background: 'none',
              border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0 }}>
              Annuler ce scan
            </button>
          </div>
        </div>
      )}

      {showManual && manualForm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '25px 30px',
            maxWidth: '620px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <h2 style={{ margin: 0, color: '#333', fontSize: '20px' }}>Expedition manuelle</h2>
              <button
                onClick={closeManualShipment}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '22px',
                  color: '#999',
                  cursor: 'pointer',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>
            <p style={{ margin: '0 0 18px', color: '#666', fontSize: '13px' }}>
              Genere une etiquette sans scan, chez le transporteur choisi. L'expedition n'est <strong>pas</strong> confirmee
              dans BMS — a faire manuellement si necessaire.
            </p>

            {manualResult ? (
              <div style={{
                backgroundColor: '#d4edda',
                borderRadius: '10px',
                padding: '25px',
                textAlign: 'center'
              }}>
                <h3 style={{ margin: '0 0 10px', color: '#155724' }}>
                  Etiquette {manualResult.carrierLabel} generee pour #{manualResult.orderNumber}
                </h3>
                <p style={{ color: '#155724', margin: '0 0 18px', fontSize: '15px' }}>
                  {manualResult.trackingId
                    ? <>N° suivi : <strong>{manualResult.trackingId}</strong></>
                    : 'Sans numero de suivi'}
                  {manualResult.cn23Base64 && ' — declaration douaniere (CN23) jointe'}
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      downloadPdf(manualResult.pdfBase64, manualResult.orderNumber, manualResult.fileName);
                      if (manualResult.cn23Base64) {
                        downloadPdf(manualResult.cn23Base64, manualResult.orderNumber, manualResult.cn23FileName);
                      }
                    }}
                    style={{
                      padding: '10px 24px',
                      backgroundColor: '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Re-telecharger l'etiquette
                  </button>
                  <button
                    onClick={openManualShipment}
                    style={{
                      padding: '10px 24px',
                      backgroundColor: 'white',
                      color: '#6366f1',
                      border: '1px solid #6366f1',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Nouvelle expedition
                  </button>
                  <button
                    onClick={closeManualShipment}
                    style={{
                      padding: '10px 24px',
                      backgroundColor: '#6366f1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Fermer
                  </button>
                </div>
              </div>
            ) : (
              (() => {
                const inputStyle = {
                  width: '100%',
                  padding: '9px 12px',
                  fontSize: '15px',
                  border: '2px solid #ddd',
                  borderRadius: '8px',
                  outline: 'none',
                  boxSizing: 'border-box'
                };
                const set = (field) => (e) => setManualForm(f => ({ ...f, [field]: e.target.value }));
                const sv = manualServices.find(x => x.key === manualForm.serviceKey) || null;
                const labelStyle = { fontSize: '12px', color: '#666', fontWeight: 600 };
                return (
                  <form
                    onSubmit={(e) => { e.preventDefault(); submitManualLabel(); }}
                    style={{ display: 'grid', gap: '10px' }}
                  >
                    <label style={{ display: 'grid', gap: '4px' }}>
                      <span style={labelStyle}>Transporteur</span>
                      <select
                        style={{ ...inputStyle, backgroundColor: 'white' }}
                        value={manualForm.serviceKey}
                        onChange={(e) => {
                          const key = e.target.value;
                          setManualForm(f => withManualService(f, manualServices, key));
                        }}
                      >
                        {!manualForm.serviceKey && <option value="">Chargement…</option>}
                        {manualServices.map(x => (
                          <option key={x.key} value={x.key}>{manualServiceLabel(x)}</option>
                        ))}
                      </select>
                      {sv && sv.denominations.length > 1 && (
                        <span style={{ fontSize: '11px', color: '#999' }}>
                          Modes WooCommerce : {sv.denominations.join(', ')}
                        </span>
                      )}
                    </label>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px' }}>
                      <input
                        style={inputStyle}
                        placeholder="N° de commande"
                        value={manualForm.orderNumber}
                        onChange={set('orderNumber')}
                        maxLength={20}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={lookupManualOrder}
                        disabled={manualLookupLoading}
                        style={{
                          padding: '9px 18px',
                          backgroundColor: 'white',
                          color: '#6366f1',
                          border: '1px solid #6366f1',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: '600',
                          whiteSpace: 'nowrap',
                          cursor: manualLookupLoading ? 'default' : 'pointer'
                        }}
                      >
                        {manualLookupLoading ? 'Chargement…' : 'Charger l\'adresse'}
                      </button>
                    </div>

                    {manualInfo && (
                      <div style={{
                        backgroundColor: '#d1ecf1',
                        color: '#0c5460',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        fontSize: '13px'
                      }}>
                        {manualInfo}
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <input style={inputStyle} placeholder="Prénom" value={manualForm.first_name} onChange={set('first_name')} />
                      <input style={inputStyle} placeholder="Nom" value={manualForm.last_name} onChange={set('last_name')} />
                    </div>
                    <input style={inputStyle} placeholder="Société (optionnel)" value={manualForm.company} onChange={set('company')} />
                    <input style={inputStyle} placeholder="Adresse" value={manualForm.address} onChange={set('address')} />
                    <input style={inputStyle} placeholder="Complément d'adresse (optionnel)" value={manualForm.address_2} onChange={set('address_2')} />
                    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 80px', gap: '10px' }}>
                      <input style={inputStyle} placeholder="Code postal" value={manualForm.postcode} onChange={set('postcode')} />
                      <input style={inputStyle} placeholder="Ville" value={manualForm.city} onChange={set('city')} />
                      <input
                        style={inputStyle}
                        placeholder="Pays"
                        title="Code pays à deux lettres (FR, BE, CH…)"
                        maxLength={2}
                        value={manualForm.country}
                        onChange={(e) => setManualForm(f => ({ ...f, country: e.target.value.toUpperCase() }))}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <input style={inputStyle} placeholder="Téléphone (optionnel)" value={manualForm.phone} onChange={set('phone')} />
                      <input style={inputStyle} placeholder="Email (optionnel)" value={manualForm.email} onChange={set('email')} />
                    </div>

                    {sv && !sv.fixedWeight && (
                      <label style={{ display: 'grid', gap: '4px' }}>
                        <span style={labelStyle}>Poids du colis (g, emballage compris)</span>
                        <input
                          style={inputStyle}
                          type="number"
                          min="1"
                          step="1"
                          placeholder="ex. 350"
                          value={manualForm.weight}
                          onChange={set('weight')}
                        />
                      </label>
                    )}

                    {sv && sv.requiresRelayPoint && (
                      <div style={{ display: 'grid', gap: '4px' }}>
                        <span style={labelStyle}>Point relais {sv.relayNetworkLabel}</span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '10px' }}>
                          <input
                            style={inputStyle}
                            placeholder="N° du point relais"
                            value={manualForm.relayId}
                            // Un numéro retapé n'est plus le point chargé : son nom et son
                            // adresse ne l'accompagnent plus.
                            onChange={(e) => {
                              const id = e.target.value;
                              setManualForm(f => ({ ...f, relayId: id, relayDetails: null }));
                            }}
                          />
                          <input
                            style={inputStyle}
                            placeholder="Pays"
                            maxLength={2}
                            value={manualForm.relayCountry}
                            onChange={(e) => {
                              const pays = e.target.value.toUpperCase();
                              setManualForm(f => ({ ...f, relayCountry: pays, relayDetails: null }));
                            }}
                          />
                        </div>
                        {manualForm.relayDetails?.name && (
                          <span style={{ fontSize: '12px', color: '#555' }}>
                            {manualForm.relayDetails.name}
                            {manualForm.relayDetails.address ? ` — ${manualForm.relayDetails.address}` : ''}
                            {manualForm.relayDetails.postcode ? `, ${manualForm.relayDetails.postcode}` : ''}
                            {manualForm.relayDetails.city ? ` ${manualForm.relayDetails.city}` : ''}
                          </span>
                        )}
                        {manualForm.loadedRelay && manualForm.loadedRelay.network !== sv.carrierCode && (
                          <span style={{ fontSize: '12px', color: '#b45309' }}>
                            Le point de la commande ({manualForm.loadedRelay.id}) n'est pas un point {sv.relayNetworkLabel} :
                            saisissez-en un.
                          </span>
                        )}
                      </div>
                    )}

                    {sv && sv.saturdayEligible && (jourCourant === 4 || jourCourant === 5) && (
                      <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '14px', color: '#333' }}>
                        <input
                          type="checkbox"
                          checked={manualForm.saturday}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setManualForm(f => ({ ...f, saturday: checked }));
                          }}
                        />
                        Livraison le samedi
                      </label>
                    )}

                    {manualError && (
                      <div style={{
                        backgroundColor: '#f8d7da',
                        color: '#721c24',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        wordBreak: 'break-word'
                      }}>
                        {manualError}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                      <button
                        type="submit"
                        disabled={manualSaving}
                        style={{
                          padding: '11px 24px',
                          backgroundColor: manualSaving ? '#9ca3af' : '#16a34a',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '15px',
                          fontWeight: '600',
                          cursor: manualSaving ? 'default' : 'pointer'
                        }}
                      >
                        {manualSaving ? 'Generation…' : 'Generer l\'etiquette'}
                      </button>
                      <button
                        type="button"
                        onClick={closeManualShipment}
                        disabled={manualSaving}
                        style={{
                          padding: '11px 24px',
                          backgroundColor: 'white',
                          color: '#666',
                          border: '1px solid #ddd',
                          borderRadius: '8px',
                          fontSize: '15px',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        Annuler
                      </button>
                    </div>
                  </form>
                );
              })()
            )}
          </div>
        </div>
      )}

      {/* Pop-up mauvaise méthode d'expédition */}
      {wrongShippingOrder && (
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
            padding: '40px',
            maxWidth: '450px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}>
            <h3 style={{ margin: '0 0 15px', color: '#dc3545', fontSize: '20px' }}>
              Mode de livraison non reconnu
            </h3>
            <p style={{ color: '#333', margin: '0 0 8px', fontSize: '15px' }}>
              Commande #{wrongShippingOrder.orderNumber}
            </p>
            <div style={{
              backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '6px',
              padding: '12px', margin: '0 0 18px', fontSize: '15px', fontWeight: 600, color: '#333'
            }}>
              {wrongShippingOrder.denomination || '(aucun mode de livraison)'}
            </div>
            <p style={{ color: '#666', margin: '0 0 25px', fontSize: '14px', lineHeight: 1.6 }}>
              Ce mode de livraison n'est associé à aucun transporteur. <strong>Demandez à un
              responsable</strong> de l'ajouter dans les réglages Livraison, onglet
              « Étiquetage », avant d'expédier cette commande.
            </p>
            <button
              onClick={handleReset}
              style={{
                padding: '12px 30px',
                backgroundColor: '#6366f1',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '600'
              }}
            >
              Scanner une autre commande
            </button>
          </div>
        </div>
      )}

      {/* Image zoom tooltip */}
      {hoveredImage && (
        <div style={{
          position: 'fixed',
          left: hoveredImage.x,
          top: hoveredImage.y,
          zIndex: 9999,
          pointerEvents: 'none',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: '#fff'
        }}>
          <img src={hoveredImage.url} alt="" style={{ width: '300px', height: '300px', objectFit: 'cover', display: 'block' }} />
        </div>
      )}
    </main>
    </AppShell>
  );
};

export default PackingApp;
