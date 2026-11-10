import { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import PdaLayout from '../components/pda/PdaLayout';
import PrelevementsTab from '../components/boutique/PrelevementsTab';

/**
 * PDA « Prélèvement boutique » (/pda/prelevement) : le même écran que
 * Boutique Castelnau › Prélèvements site, pour tout utilisateur du PDA
 * (droit picking). Les vendeurs de Castelnau sont les gens du PDA.
 */
const CASTELNAU = { id: 2, slug: 'castelnau', label: 'Castelnau' };

export default function PdaPrelevement() {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();
  return (
    <PdaLayout title="Prélèvement boutique" onBack={() => navigate('/pda')} backLabel="Accueil">
      <div style={{ padding: 10 }}>
        <PrelevementsTab shop={CASTELNAU} token={token} />
      </div>
    </PdaLayout>
  );
}
