import { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';

// Redirige toute URL /tickets/:id vers l'app à onglets /tickets,
// en faisant pré-charger le ticket cible pour qu'il s'ouvre automatiquement
// comme onglet actif (via localStorage lu par OpenTicketsProvider).
export default function TicketDetailPage() {
  const { id } = useParams();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const ticketId = parseInt(id, 10);
    if (Number.isNaN(ticketId)) { setReady(true); return; }

    try {
      const raw = localStorage.getItem('yv.tickets.openTabs');
      const tabs = raw ? JSON.parse(raw) : [];
      if (!tabs.find(t => t.id === ticketId)) {
        // On insère un placeholder ; le provider va refetch les méta au montage
        tabs.push({ id: ticketId, subject: '', customer_name: '', sav_status: null });
        localStorage.setItem('yv.tickets.openTabs', JSON.stringify(tabs));
      }
      localStorage.setItem('yv.tickets.activeTab', String(ticketId));
    } catch { /* ignore */ }

    setReady(true);
  }, [id]);

  if (!ready) return null;
  return <Navigate to="/tickets" replace />;
}
