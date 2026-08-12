import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Présence des agents sur un ticket : qui le regarde, et qui est en train d'y
 * répondre. Sert à éviter les réponses croisées.
 *
 * Deux canaux :
 *  - un battement de cœur POST toutes les 10 s, qui annonce notre présence et
 *    notre état de frappe, et renvoie l'état courant du ticket ;
 *  - le flux SSE, qui pousse les changements des AUTRES sans attendre notre
 *    prochain battement (sinon un collègue pourrait commencer à écrire jusqu'à
 *    10 s avant qu'on le sache — précisément la fenêtre qu'on veut fermer).
 *
 * Le battement continue en arrière-plan si l'onglet est masqué : un agent qui
 * bascule sur un autre logiciel garde son ticket ouvert, et sa réponse en cours
 * ne doit pas cesser d'être signalée à ses collègues.
 *
 * @param {number|string|null} ticketId
 * @param {{id: number|string, name?: string, email?: string}|null} user
 * @returns {{others: Array, typingOthers: Array, setTyping: Function}}
 */
const HEARTBEAT_MS = 10000;

export function useTicketPresence(ticketId, user) {
  const [viewers, setViewers] = useState([]);
  // Ref plutôt que state : la frappe change à chaque touche, un state
  // provoquerait un rendu par caractère.
  const typingRef = useRef(false);
  const lastSentTypingRef = useRef(null);
  const timerRef = useRef();

  const userId = user?.id ?? user?.email ?? null;
  const userName = user?.name || user?.email || 'Agent';

  const beat = useCallback(async (typing) => {
    if (!ticketId || !userId) return;
    try {
      const res = await fetch('/api/sav/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticketId, user_id: userId, user_name: userName, typing,
        }),
      });
      const data = await res.json();
      if (data?.success) setViewers(data.viewers || []);
    } catch { /* réseau : on réessaiera au prochain battement */ }
  }, [ticketId, userId, userName]);

  // Battement régulier + battement immédiat au changement d'état de frappe,
  // pour que le verrou côté collègue s'arme sans attendre 10 s.
  useEffect(() => {
    if (!ticketId || !userId) return;
    beat(false);
    timerRef.current = setInterval(() => {
      const typing = typingRef.current;
      beat(typing);
      lastSentTypingRef.current = typing;
    }, HEARTBEAT_MS);
    return () => clearInterval(timerRef.current);
  }, [ticketId, userId, beat]);

  // Départ : on prévient au démontage et à la fermeture de l'onglet. Le
  // `keepalive` permet à la requête de survivre à la fermeture de la page —
  // sans lui, elle serait annulée et le collègue verrait un fantôme pendant
  // 35 s (jusqu'à expiration).
  useEffect(() => {
    if (!ticketId || !userId) return;
    const payload = JSON.stringify({ ticket_id: ticketId, user_id: userId });
    const leave = () => {
      try {
        fetch('/api/sav/presence/leave', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: payload, keepalive: true,
        });
      } catch { /* best-effort */ }
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [ticketId, userId]);

  // Changements poussés par les autres navigateurs.
  useEffect(() => {
    if (!ticketId) return;
    const es = new EventSource('/api/sav/stream');
    es.addEventListener('presence', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (String(data.ticket_id) === String(ticketId)) setViewers(data.viewers || []);
      } catch { /* payload illisible : ignoré */ }
    });
    return () => es.close();
  }, [ticketId]);

  // Signalé par l'éditeur à chaque frappe. Un passage de false à true déclenche
  // un battement immédiat.
  const setTyping = useCallback((typing) => {
    const was = typingRef.current;
    typingRef.current = typing;
    if (typing && !was) beat(true);
  }, [beat]);

  const others = viewers.filter(v => String(v.user_id) !== String(userId));

  return {
    others,
    typingOthers: others.filter(v => v.typing),
    setTyping,
  };
}
