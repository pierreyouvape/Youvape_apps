/** Retour visible après « Enregistrer » (ou rappel qu'il reste à enregistrer). */
const SaveStatus = ({ state, publishHint = true }) => {
  if (!state) return null;
  if (state.kind === 'saving') return null;
  if (state.kind === 'dirty') return <span style={{ fontSize: 12, fontWeight: 700, color: '#E28F00' }}>Modifications non enregistrées</span>;
  if (state.kind === 'error') return <span style={{ fontSize: 12, fontWeight: 700, color: '#DE2020' }}>Échec : {state.message}</span>;
  const hh = state.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return (
    <span style={{ fontSize: 12, color: '#2a2e38' }}>
      <span style={{ fontWeight: 700, color: '#2E8B57' }}>✓ Enregistré à {hh}</span>
      {publishHint && <span style={{ color: '#8A99A4' }}> — visible sur le site après « Publier sur le site »</span>}
    </span>
  );
};

export default SaveStatus;
