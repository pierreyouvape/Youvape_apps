import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const STORAGE_KEY    = 'yv.tickets.openTabs';
const ACTIVE_KEY     = 'yv.tickets.activeTab';
const AFTER_MODE_KEY = 'yv.tickets.afterActionMode'; // 'next' | 'stay'
const PLAY_KEY       = 'yv.tickets.play';            // { queue, viewId, viewStatuses, refetched }

// Onglet virtuel "Play"
export const PLAY_TAB = 'play';

const OpenTicketsContext = createContext(null);

export function OpenTicketsProvider({ children }) {
  // ─── Onglets ouverts ─────────────────────────────────────────────────────
  const [openTickets, setOpenTickets] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  // activeTab = 'list' | 'play' | ticketId (number)
  const [activeTab, setActiveTabState] = useState(() => {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw || raw === 'list') return 'list';
    if (raw === PLAY_TAB) return PLAY_TAB;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? 'list' : n;
  });

  // ─── Mode Play ───────────────────────────────────────────────────────────
  // playState = { queue: number[], currentId: number|null, viewId, viewStatuses, refetched: bool } | null
  const [playState, setPlayState] = useState(() => {
    try {
      const raw = localStorage.getItem(PLAY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  // afterActionMode = 'next' | 'stay'
  const [afterActionMode, setAfterActionModeState] = useState(() => {
    return localStorage.getItem(AFTER_MODE_KEY) === 'stay' ? 'stay' : 'next';
  });

  // ─── Persistance ─────────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(openTickets)); }, [openTickets]);
  useEffect(() => { localStorage.setItem(ACTIVE_KEY, String(activeTab)); }, [activeTab]);
  useEffect(() => {
    if (playState) localStorage.setItem(PLAY_KEY, JSON.stringify(playState));
    else localStorage.removeItem(PLAY_KEY);
  }, [playState]);
  useEffect(() => { localStorage.setItem(AFTER_MODE_KEY, afterActionMode); }, [afterActionMode]);

  const setActiveTab = useCallback((tab) => setActiveTabState(tab), []);
  const setAfterActionMode = useCallback((m) => setAfterActionModeState(m === 'stay' ? 'stay' : 'next'), []);

  // ─── Refetch des méta au chargement ──────────────────────────────────────
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
      setActiveTabState(prev => {
        if (prev === 'list' || prev === PLAY_TAB) return prev;
        return cleaned.find(t => t.id === prev) ? prev : 'list';
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Ouvrir un ticket ────────────────────────────────────────────────────
  const openTicket = useCallback((ticket, { background = false } = {}) => {
    const meta = {
      id: ticket.id,
      subject: ticket.subject,
      customer_name: ticket.customer_name,
      sav_status: ticket.sav_status,
    };
    setOpenTickets(prev => {
      const existing = prev.find(t => t.id === meta.id);
      if (existing) return prev.map(t => t.id === meta.id ? { ...t, ...meta } : t);
      return [...prev, meta];
    });
    if (!background) setActiveTabState(meta.id);
  }, []);

  // ─── Fermer un ticket ────────────────────────────────────────────────────
  const closeTicket = useCallback((id) => {
    setOpenTickets(prev => {
      const idx = prev.findIndex(t => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter(t => t.id !== id);
      setActiveTabState(active => {
        if (active !== id) return active;
        if (next.length === 0) return 'list';
        const target = next[idx - 1] || next[0];
        return target.id;
      });
      return next;
    });
  }, []);

  const updateTicketMeta = useCallback((id, patch) => {
    setOpenTickets(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  // ─── Mode Play : démarrer ────────────────────────────────────────────────
  // queue = liste d'IDs (ordre de la vue) ; viewId/viewStatuses servent au refetch
  const startPlay = useCallback(({ queue, viewId, viewStatuses }) => {
    if (!queue || queue.length === 0) return;
    const first = queue[0];
    setPlayState({
      queue: queue.slice(1),
      currentId: first,
      viewId: viewId || null,
      viewStatuses: viewStatuses || [],
      refetched: false,
    });
    setActiveTabState(PLAY_TAB);
  }, []);

  // ─── Mode Play : arrêter ─────────────────────────────────────────────────
  const stopPlay = useCallback(() => {
    setPlayState(null);
    setActiveTabState(prev => prev === PLAY_TAB ? 'list' : prev);
  }, []);

  // ─── Mode Play : passer au suivant ──────────────────────────────────────
  // - si queue non vide -> bascule sur l'élément en tête
  // - sinon, refetch UNE fois la vue avec viewStatuses pour récupérer de nouveaux tickets
  // - sinon stopPlay()
  const advancePlay = useCallback(async () => {
    if (!playState) return;
    if (playState.queue.length > 0) {
      const [next, ...rest] = playState.queue;
      setPlayState(s => s ? { ...s, queue: rest, currentId: next } : s);
      return;
    }
    // Queue vide
    if (playState.refetched) {
      stopPlay();
      return;
    }
    try {
      const p = new URLSearchParams({ limit: 500, offset: 0 });
      (playState.viewStatuses || []).forEach(s => p.append('sav_statuses', s));
      const res = await fetch(`/api/sav?${p}`);
      const data = await res.json();
      const ids = data.success ? data.tickets.map(t => t.id).filter(id => id !== playState.currentId) : [];
      if (ids.length === 0) { stopPlay(); return; }
      const [first, ...rest] = ids;
      setPlayState(s => s ? { ...s, queue: rest, currentId: first, refetched: true } : s);
    } catch {
      stopPlay();
    }
  }, [playState, stopPlay]);

  const value = {
    openTickets,
    activeTab,
    setActiveTab,
    openTicket,
    closeTicket,
    updateTicketMeta,
    // Mode Play
    playState,
    isPlayActive: !!playState,
    playTicketId: playState?.currentId || null,
    startPlay,
    stopPlay,
    advancePlay,
    afterActionMode,
    setAfterActionMode,
  };

  return (
    <OpenTicketsContext.Provider value={value}>
      {children}
    </OpenTicketsContext.Provider>
  );
}

export function useOpenTickets() {
  return useContext(OpenTicketsContext);
}
