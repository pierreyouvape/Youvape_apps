import { Component } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Filet sous les écrans chargés à la demande (utils/lazyPage.js).
 *
 * Sans lui, un écran qui ne se charge pas — ou qui plante au rendu — laisse une
 * page entièrement blanche. Ici, seul l'écran est remplacé par un message ; le
 * reste (bandeau de version, post-its du Tableau) continue de tourner. Le filet
 * se rouvre dès qu'on change d'adresse.
 */
class Filet extends Component {
  constructor(props) {
    super(props);
    this.state = { erreur: null };
  }

  static getDerivedStateFromError(erreur) {
    return { erreur };
  }

  componentDidCatch(erreur) {
    console.error('Écran indisponible :', erreur);
  }

  componentDidUpdate(prev) {
    if (prev.adresse !== this.props.adresse && this.state.erreur) this.setState({ erreur: null });
  }

  render() {
    if (!this.state.erreur) return this.props.children;
    return (
      <div style={{ padding: '60px 16px', textAlign: 'center', color: '#333' }}>
        <p style={{ fontSize: 16, marginBottom: 18 }}>
          Cet écran n'a pas pu s'afficher.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#135E84', color: '#fff', border: 'none', borderRadius: 7,
            padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Recharger
        </button>
      </div>
    );
  }
}

export default function EcranIndisponible({ children }) {
  const { pathname } = useLocation();
  return <Filet adresse={pathname}>{children}</Filet>;
}
