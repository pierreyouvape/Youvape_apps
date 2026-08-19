import React, { useState } from 'react';

/**
 * Bouton pour copier du texte dans le presse-papier
 * Affiche une icône de copie, puis un check pendant 2 secondes après copie
 * `label` : rend un bouton texte + icône au lieu de l'icône seule
 */
const CopyButton = ({ text, size = 14, label, title, style = {} }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation(); // Éviter la propagation du clic
    e.preventDefault();

    try {
      // Méthode moderne
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback pour HTTP ou navigateurs anciens
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Erreur lors de la copie:', err);
      // Fallback ultime
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error('Fallback copie échoué:', e);
      }
    }
  };

  // Fond au repos : transparent pour l'icône seule, blanc pour le bouton avec label
  const baseBg = label ? '#FFFFFF' : 'transparent';

  return (
    <button
      onClick={handleCopy}
      title={title || (copied ? 'Copié !' : 'Copier')}
      style={{
        background: baseBg,
        border: 'none',
        cursor: 'pointer',
        padding: '2px 4px',
        marginLeft: '4px',
        borderRadius: '4px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background-color 0.2s',
        verticalAlign: 'middle',
        ...(label ? {
          gap: 6,
          padding: '7px 13px',
          marginLeft: 0,
          borderRadius: 7,
          border: '1px solid #E2E2E2',
          fontFamily: 'inherit',
          fontSize: 12.5,
          fontWeight: 700,
          color: copied ? '#22c55e' : '#2a2e38',
          whiteSpace: 'nowrap',
        } : null),
        ...style
      }}
      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f0f0f0'}
      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = baseBg}
    >
      {copied ? (
        // Icône check
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      ) : (
        // Icône copie
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      )}
      {label && <span>{copied ? 'Copié !' : label}</span>}
    </button>
  );
};

export default CopyButton;
