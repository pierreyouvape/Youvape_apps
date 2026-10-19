const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', euro: '€', deg: '°', times: '×', reg: '®', trade: '™', copy: '©', omega: 'Ω' };

// Titres WooCommerce : entités HTML (&nbsp;, &#8211;, &amp;…) et espaces insécables
// rendus en texte lisible ; &amp;nbsp; (double encodage) est aussi couvert.
export const decodeHtml = (str) => {
  if (!str || typeof str !== 'string') return str || '';
  let out = str;
  for (let i = 0; i < 2; i++) {
    out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return HTML_ENTITIES[e.toLowerCase()] ?? m;
    });
  }
  return out.replace(/[  ]/g, ' ');
};
