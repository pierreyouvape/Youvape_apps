import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const STORAGE_KEY = 'yv.tickets.openTabs';
const ACTIVE_KEY  = 'yv.tickets.activeTab';

const OpenTicketsContext = createContext(null);

export function OpenTicketsProvider({ children }) {
  // openTickets = [{ id, subject, customer_name, sav_status }]
  const [openTickets, setOpenTickets] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  // activeTab = 'list' | ticketId (number)
  const [activeTab, setActiveTabState] = useState(() => {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw || raw === 'list') return 'list';
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? 'list' : n;
  });

  // Persistance
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(openTickets));
  }, [openTickets]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_KEY, String(activeTab));
  }, [activeTab]);

  const setActiveTab = useCallback((tab) => setActiveTabState(tab), []);

  // Refetch des métadonnées des tickets persistés au chargement (titres à jour)
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || openTickets.length === 0) return;
    hydratedRef.current = true;
    Promise.all(openTickets.map(t =>
      fetch(`/api/sav/${t.id}`)
        .then(r => r.json())
        .then(d => d.success ? {
          id: d.ticket.id,
          subject: d.ticket.subject,
          customer_name: d.ticket.customer_name,
          sav_status: d.ticket.sav_status,
        } : null)
        .catch(() => null)
    )).then(results => {
      const cleaned = results.filter(Boolean);
      setOpenTickets(cleaned);
      // Si l'onglet actif n'existe plus, retomber sur 'list'
      setActiveTabState(prev => prev === 'list' || cleaned.find(t => t.id === prev) ? prev : 'list');
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ouvrir un ticket : si déjà ouvert -> bascule (sauf background), sinon ajoute
  const openTicket = useCallback((ticket, { background = false } = {}) => {
    const meta = {
      id: ticket.id,
      subject: ticket.subject,
      customer_name: ticket.customer_name,
      sav_status: ticket.sav_status,
    };
    setOpenTickets(prev => {
      const existing = prev.find(t => t.id === meta.id);
      if (existing) {
        // Mettre à jour les méta au cas où elles auraient changé
        return prev.map(t => t.id === meta.id ? { ...t, ...meta } : t);
      }
      return [...prev, meta];
    });
    if (!background) setActiveTabState(meta.id);
  }, []);

  // Fermer un ticket. Si c'était l'actif, basculer sur l'onglet à gauche (ou 'list').
  const closeTicket = useCallback((id) => {
    setOpenTickets(prev => {
      const idx = prev.findIndex(t => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter(t => t.id !== id);
      setActiveTabState(active => {
        if (active !== id) return active;
        if (next.length === 0) return 'list';
        // Onglet à gauche, sinon premier
        const target = next[idx - 1] || next[0];
        return target.id;
      });
      return next;
    });
  }, []);

  // Mettre à jour les méta d'un ticket ouvert (statut, sujet) — pour resync auto
  const updateTicketMeta = useCallback((id, patch) => {
    setOpenTickets(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const value = {
    openTickets,
    activeTab,
    setActiveTab,
    openTicket,
    closeTicket,
    updateTicketMeta,
  };

  return (
    <OpenTicketsContext.Provider value={value}>
      {children}
    </OpenTicketsContext.Provider>
  );
}

// Retourne null si pas de provider, pour permettre un fallback (ex: routes directes).
export function useOpenTickets() {
  return useContext(OpenTicketsContext);
}
