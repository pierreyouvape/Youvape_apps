import { useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import TicketDetail from '../components/tickets/TicketDetail';

export default function TicketDetailPage() {
  const { id } = useParams();

  return (
    <AppShell currentPath="/tickets">
      <TicketDetail ticketId={id} />
    </AppShell>
  );
}
