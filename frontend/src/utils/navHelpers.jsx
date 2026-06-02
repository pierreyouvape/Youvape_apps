import { forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';

function isModifiedClick(e) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1;
}

/**
 * <LinkBox to="/path" style={...}>...</LinkBox>
 *
 * Rend un <a href={to}> mais visuellement transparent (display:block par defaut,
 * couleur/decoration heritees) — comportement React Router en clic gauche,
 * comportement natif (nouvel onglet) en cmd/ctrl/middle clic.
 *
 * Props :
 *   - to       : URL cible (string)
 *   - display  : 'block' (defaut) | 'inline' | 'inline-block' | 'flex' ...
 *   - onClick  : callback optionnel (peut e.preventDefault() pour annuler)
 *   - tout le reste passe au <a>
 */
export const LinkBox = forwardRef(function LinkBox(
  { to, onClick, children, style, display = 'block', ...rest },
  ref
) {
  const navigate = useNavigate();

  const handleClick = (e) => {
    if (onClick) onClick(e);
    if (e.defaultPrevented) return;
    if (isModifiedClick(e)) return;
    if (e.button !== 0 && e.button !== undefined) return;
    e.preventDefault();
    navigate(to);
  };

  const baseStyle = {
    color: 'inherit',
    textDecoration: 'none',
    cursor: 'pointer',
    display,
    ...style,
  };

  return (
    <a ref={ref} href={to} onClick={handleClick} style={baseStyle} {...rest}>
      {children}
    </a>
  );
});

/**
 * <LinkTr to="/path">...</LinkTr>
 *
 * Pour les lignes de tableau cliquables : on ne peut pas remplacer un <tr>
 * par un <a>, donc on intercepte clic + auxclick et on ouvre dans un
 * nouvel onglet si modifier appuye.
 */
export const LinkTr = forwardRef(function LinkTr(
  { to, onClick, children, style, ...rest },
  ref
) {
  const navigate = useNavigate();

  const handleClick = (e) => {
    if (onClick) onClick(e);
    if (e.defaultPrevented) return;
    if (isModifiedClick(e)) {
      window.open(to, '_blank', 'noopener');
      return;
    }
    navigate(to);
  };

  const handleAuxClick = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      window.open(to, '_blank', 'noopener');
    }
  };

  return (
    <tr
      ref={ref}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      style={{ cursor: 'pointer', ...style }}
      {...rest}
    >
      {children}
    </tr>
  );
});
