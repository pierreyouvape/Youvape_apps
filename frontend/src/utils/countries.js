// Mapping des codes pays ISO 3166-1 alpha-2 vers noms et drapeaux
export const COUNTRIES = {
  'FR': { name: 'France', flag: '🇫🇷' },
  'BE': { name: 'Belgique', flag: '🇧🇪' },
  'LU': { name: 'Luxembourg', flag: '🇱🇺' },
  'CH': { name: 'Suisse', flag: '🇨🇭' },
  'DE': { name: 'Allemagne', flag: '🇩🇪' },
  'ES': { name: 'Espagne', flag: '🇪🇸' },
  'IT': { name: 'Italie', flag: '🇮🇹' },
  'PT': { name: 'Portugal', flag: '🇵🇹' },
  'NL': { name: 'Pays-Bas', flag: '🇳🇱' },
  'GB': { name: 'Royaume-Uni', flag: '🇬🇧' },
  'IE': { name: 'Irlande', flag: '🇮🇪' },
  'AT': { name: 'Autriche', flag: '🇦🇹' },
  'PL': { name: 'Pologne', flag: '🇵🇱' },
  'CZ': { name: 'République tchèque', flag: '🇨🇿' },
  'DK': { name: 'Danemark', flag: '🇩🇰' },
  'SE': { name: 'Suède', flag: '🇸🇪' },
  'NO': { name: 'Norvège', flag: '🇳🇴' },
  'FI': { name: 'Finlande', flag: '🇫🇮' },
  'GR': { name: 'Grèce', flag: '🇬🇷' },
  'RO': { name: 'Roumanie', flag: '🇷🇴' },
  'BG': { name: 'Bulgarie', flag: '🇧🇬' },
  'HR': { name: 'Croatie', flag: '🇭🇷' },
  'SI': { name: 'Slovénie', flag: '🇸🇮' },
  'SK': { name: 'Slovaquie', flag: '🇸🇰' },
  'HU': { name: 'Hongrie', flag: '🇭🇺' },
  'EE': { name: 'Estonie', flag: '🇪🇪' },
  'LV': { name: 'Lettonie', flag: '🇱🇻' },
  'LT': { name: 'Lituanie', flag: '🇱🇹' },
  'MT': { name: 'Malte', flag: '🇲🇹' },
  'CY': { name: 'Chypre', flag: '🇨🇾' },
  'US': { name: 'États-Unis', flag: '🇺🇸' },
  'CA': { name: 'Canada', flag: '🇨🇦' },
  'MX': { name: 'Mexique', flag: '🇲🇽' },
  'BR': { name: 'Brésil', flag: '🇧🇷' },
  'AR': { name: 'Argentine', flag: '🇦🇷' },
  'CL': { name: 'Chili', flag: '🇨🇱' },
  'CO': { name: 'Colombie', flag: '🇨🇴' },
  'PE': { name: 'Pérou', flag: '🇵🇪' },
  'JP': { name: 'Japon', flag: '🇯🇵' },
  'CN': { name: 'Chine', flag: '🇨🇳' },
  'KR': { name: 'Corée du Sud', flag: '🇰🇷' },
  'IN': { name: 'Inde', flag: '🇮🇳' },
  'AU': { name: 'Australie', flag: '🇦🇺' },
  'NZ': { name: 'Nouvelle-Zélande', flag: '🇳🇿' },
  'ZA': { name: 'Afrique du Sud', flag: '🇿🇦' },
  'MA': { name: 'Maroc', flag: '🇲🇦' },
  'TN': { name: 'Tunisie', flag: '🇹🇳' },
  'DZ': { name: 'Algérie', flag: '🇩🇿' },
  'SN': { name: 'Sénégal', flag: '🇸🇳' },
  'CI': { name: 'Côte d\'Ivoire', flag: '🇨🇮' },
  'TR': { name: 'Turquie', flag: '🇹🇷' },
  'RU': { name: 'Russie', flag: '🇷🇺' },
  'UA': { name: 'Ukraine', flag: '🇺🇦' },
  'IL': { name: 'Israël', flag: '🇮🇱' },
  'AE': { name: 'Émirats arabes unis', flag: '🇦🇪' },
  'SA': { name: 'Arabie saoudite', flag: '🇸🇦' },
  'SG': { name: 'Singapour', flag: '🇸🇬' },
  'MY': { name: 'Malaisie', flag: '🇲🇾' },
  'TH': { name: 'Thaïlande', flag: '🇹🇭' },
  'VN': { name: 'Viêt Nam', flag: '🇻🇳' },
  'PH': { name: 'Philippines', flag: '🇵🇭' },
  'ID': { name: 'Indonésie', flag: '🇮🇩' },
};

/**
 * Obtenir le nom complet d'un pays à partir de son code ISO
 * @param {string} countryCode - Code pays ISO (ex: "FR")
 * @returns {string} Nom complet du pays
 */
export const getCountryName = (countryCode) => {
  if (!countryCode) return 'N/A';
  return COUNTRIES[countryCode]?.name || countryCode;
};

/**
 * Obtenir le drapeau d'un pays à partir de son code ISO
 * @param {string} countryCode - Code pays ISO (ex: "FR")
 * @returns {string} Emoji drapeau
 */
export const getCountryFlag = (countryCode) => {
  if (!countryCode) return '';
  return COUNTRIES[countryCode]?.flag || '';
};

/**
 * Obtenir le label complet (drapeau + nom) d'un pays
 * @param {string} countryCode - Code pays ISO (ex: "FR")
 * @returns {string} "🇫🇷 France"
 */
export const getCountryLabel = (countryCode) => {
  if (!countryCode) return 'N/A';
  const country = COUNTRIES[countryCode];
  if (!country) return countryCode;
  return `${country.flag} ${country.name}`;
};
