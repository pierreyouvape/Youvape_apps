const pool = require('../config/database');

// Liste des pays avec codes ISO (utilisés dans WooCommerce)
const COUNTRIES = {
  FR: 'France', DE: 'Allemagne', BE: 'Belgique', ES: 'Espagne', IT: 'Italie',
  NL: 'Pays-Bas', PT: 'Portugal', AT: 'Autriche', CH: 'Suisse', LU: 'Luxembourg',
  GB: 'Royaume-Uni', IE: 'Irlande', DK: 'Danemark', SE: 'Suède', FI: 'Finlande',
  NO: 'Norvège', PL: 'Pologne', CZ: 'République tchèque', SK: 'Slovaquie',
  HU: 'Hongrie', RO: 'Roumanie', BG: 'Bulgarie', GR: 'Grèce', HR: 'Croatie',
  SI: 'Slovénie', EE: 'Estonie', LV: 'Lettonie', LT: 'Lituanie', MT: 'Malte',
  CY: 'Chypre', IS: 'Islande', LI: 'Liechtenstein', MC: 'Monaco', SM: 'Saint-Marin',
  VA: 'Vatican', AD: 'Andorre', GI: 'Gibraltar', GG: 'Guernesey', JE: 'Jersey',
  IM: 'Île de Man', FO: 'Îles Féroé', GL: 'Groenland', SJ: 'Svalbard',
  // Europe de l'Est et Balkans
  AL: 'Albanie', BA: 'Bosnie-Herzégovine', ME: 'Monténégro', MK: 'Macédoine du Nord',
  RS: 'Serbie', XK: 'Kosovo', MD: 'Moldavie', UA: 'Ukraine', BY: 'Biélorussie',
  RU: 'Russie', GE: 'Géorgie', AM: 'Arménie', AZ: 'Azerbaïdjan', TR: 'Turquie',
  // DOM-TOM et territoires français
  GF: 'Guyane française', GP: 'Guadeloupe', MQ: 'Martinique', RE: 'La Réunion',
  YT: 'Mayotte', PM: 'Saint-Pierre-et-Miquelon', BL: 'Saint-Barthélemy',
  MF: 'Saint-Martin', NC: 'Nouvelle-Calédonie', PF: 'Polynésie française',
  WF: 'Wallis-et-Futuna',
  // Afrique du Nord et Moyen-Orient
  MA: 'Maroc', DZ: 'Algérie', TN: 'Tunisie', LY: 'Libye', EG: 'Égypte',
  IL: 'Israël', LB: 'Liban', JO: 'Jordanie', SA: 'Arabie saoudite', AE: 'Émirats arabes unis',
  QA: 'Qatar', KW: 'Koweït', BH: 'Bahreïn', OM: 'Oman', YE: 'Yémen',
  IQ: 'Irak', IR: 'Iran', SY: 'Syrie',
  // Afrique subsaharienne
  SN: 'Sénégal', CI: 'Côte d\'Ivoire', ML: 'Mali', BF: 'Burkina Faso', NE: 'Niger',
  NG: 'Nigeria', CM: 'Cameroun', GA: 'Gabon', CG: 'Congo', CD: 'RD Congo',
  KE: 'Kenya', TZ: 'Tanzanie', UG: 'Ouganda', RW: 'Rwanda', ET: 'Éthiopie',
  GH: 'Ghana', ZA: 'Afrique du Sud', MU: 'Maurice', MG: 'Madagascar',
  // Asie
  CN: 'Chine', JP: 'Japon', KR: 'Corée du Sud', KP: 'Corée du Nord',
  TW: 'Taïwan', HK: 'Hong Kong', MO: 'Macao', MN: 'Mongolie',
  IN: 'Inde', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Népal',
  TH: 'Thaïlande', VN: 'Vietnam', MY: 'Malaisie', SG: 'Singapour', ID: 'Indonésie',
  PH: 'Philippines', MM: 'Myanmar', KH: 'Cambodge', LA: 'Laos',
  KZ: 'Kazakhstan', UZ: 'Ouzbékistan', TM: 'Turkménistan', KG: 'Kirghizistan', TJ: 'Tadjikistan',
  // Amériques
  US: 'États-Unis', CA: 'Canada', MX: 'Mexique',
  BR: 'Brésil', AR: 'Argentine', CL: 'Chili', CO: 'Colombie', PE: 'Pérou',
  VE: 'Venezuela', EC: 'Équateur', BO: 'Bolivie', PY: 'Paraguay', UY: 'Uruguay',
  CU: 'Cuba', DO: 'République dominicaine', HT: 'Haïti', JM: 'Jamaïque',
  PR: 'Porto Rico', CR: 'Costa Rica', PA: 'Panama', GT: 'Guatemala',
  HN: 'Honduras', SV: 'Salvador', NI: 'Nicaragua',
  // Océanie
  AU: 'Australie', NZ: 'Nouvelle-Zélande', FJ: 'Fidji', PG: 'Papouasie-Nouvelle-Guinée',
  // Autres
  SX: 'Sint Maarten', AW: 'Aruba', CW: 'Curaçao', BQ: 'Pays-Bas caribéens'
};

// Préfixes postaux spéciaux (Corse, DOM-TOM, Canaries, etc.)
const POSTAL_PREFIXES = [
  { code: '20', name: 'Corse (20xxx)', country: 'FR' },
  { code: '97', name: 'DOM-TOM (97xxx)', country: 'FR' },
  { code: '98', name: 'Monaco/Territoires (98xxx)', country: 'FR' },
  { code: '35', name: 'Canaries (35xxx)', country: 'ES' },
  { code: '38', name: 'Canaries (38xxx)', country: 'ES' }
];

// Configuration des transporteurs et méthodes
const CARRIERS = {
  laposte: {
    name: 'La Poste',
    methods: {
      lettre_suivie: 'Lettre Suivie'
    }
  },
  colissimo: {
    name: 'Colissimo',
    methods: {
      domicile_sans_signature: 'Domicile sans signature',
      domicile_avec_signature: 'Domicile avec signature',
      point_relais: 'Point relais'
    }
  },
  chronopost: {
    name: 'Chronopost',
    methods: {
      '2shop': '2Shop',
      domicile: 'Domicile',
      relais: 'Relais'
    }
  },
  mondial_relay: {
    name: 'Mondial Relay',
    methods: {
      point_relais: 'Point relais'
    }
  }
};

/**
 * Récupérer la configuration des transporteurs
 */
const getCarriersConfig = async (req, res) => {
  try {
    res.json({ success: true, carriers: CARRIERS });
  } catch (error) {
    console.error('Error getting carriers config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupérer la liste des pays
 */
const getCountries = async (req, res) => {
  try {
    res.json({ success: true, countries: COUNTRIES, postalPrefixes: POSTAL_PREFIXES });
  } catch (error) {
    console.error('Error getting countries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupérer toutes les zones d'un transporteur/méthode avec leurs tarifs
 */
const getZones = async (req, res) => {
  try {
    const { carrier, method } = req.params;

    const zonesResult = await pool.query(`
      SELECT id, zone_name, zone_order, COALESCE(fuel_surcharge, 0) as fuel_surcharge
      FROM shipping_tariff_zones
      WHERE carrier = $1 AND method = $2
      ORDER BY zone_order, zone_name
    `, [carrier, method]);

    const zones = [];
    for (const zone of zonesResult.rows) {
      const ratesResult = await pool.query(`
        SELECT id, weight_from, weight_to, price_ht
        FROM shipping_tariff_rates
        WHERE zone_id = $1
        ORDER BY weight_from
      `, [zone.id]);

      zones.push({
        id: zone.id,
        name: zone.zone_name,
        order: zone.zone_order,
        fuel_surcharge: parseFloat(zone.fuel_surcharge),
        rates: ratesResult.rows.map(r => ({
          id: r.id,
          weight_from: parseFloat(r.weight_from),
          weight_to: parseFloat(r.weight_to),
          price_ht: parseFloat(r.price_ht)
        }))
      });
    }

    res.json({ success: true, carrier, method, zones });
  } catch (error) {
    console.error('Error getting zones:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Créer une nouvelle zone
 */
const createZone = async (req, res) => {
  try {
    const { carrier, method } = req.params;
    const { zone_name } = req.body;

    const result = await pool.query(`
      INSERT INTO shipping_tariff_zones (carrier, method, zone_name)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [carrier, method, zone_name]);

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ success: false, error: 'Cette zone existe déjà' });
    } else {
      console.error('Error creating zone:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
};

/**
 * Supprimer une zone (et ses tarifs en cascade)
 */
const deleteZone = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM shipping_tariff_zones WHERE id = $1', [id]);
    res.json({ success: true, message: 'Zone supprimée' });
  } catch (error) {
    console.error('Error deleting zone:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Ajouter une tranche de tarif
 */
const createRate = async (req, res) => {
  try {
    const { zone_id, weight_from, weight_to, price_ht } = req.body;

    const result = await pool.query(`
      INSERT INTO shipping_tariff_rates (zone_id, weight_from, weight_to, price_ht)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [zone_id, weight_from || 0, weight_to || 250, price_ht || 0]);

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error creating rate:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Mettre à jour une tranche de tarif
 */
const updateRate = async (req, res) => {
  try {
    const { id } = req.params;
    const { weight_from, weight_to, price_ht } = req.body;

    await pool.query(`
      UPDATE shipping_tariff_rates
      SET weight_from = $1, weight_to = $2, price_ht = $3, updated_at = NOW()
      WHERE id = $4
    `, [weight_from, weight_to, price_ht, id]);

    res.json({ success: true, message: 'Tarif mis à jour' });
  } catch (error) {
    console.error('Error updating rate:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Supprimer une tranche de tarif
 */
const deleteRate = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM shipping_tariff_rates WHERE id = $1', [id]);
    res.json({ success: true, message: 'Tranche supprimée' });
  } catch (error) {
    console.error('Error deleting rate:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupérer le mapping pays -> zone
 */
const getCountryMapping = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, country_code, zone_name, is_postal_prefix
      FROM shipping_country_mapping
      ORDER BY country_code
    `);

    res.json({ success: true, mappings: result.rows });
  } catch (error) {
    console.error('Error getting country mapping:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupérer toutes les zones uniques (pour le dropdown)
 */
const getAllZoneNames = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT zone_name FROM (
        SELECT zone_name FROM shipping_tariff_zones
        UNION
        SELECT zone_name FROM shipping_country_mapping
      ) all_zones
      ORDER BY zone_name
    `);

    res.json({ success: true, zones: result.rows.map(r => r.zone_name) });
  } catch (error) {
    console.error('Error getting zone names:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Ajouter ou modifier un mapping pays
 */
const upsertCountryMapping = async (req, res) => {
  try {
    const { country_code, zone_name, is_postal_prefix } = req.body;

    // Vérifier si le pays/préfixe existe déjà
    const existing = await pool.query(
      'SELECT id, zone_name FROM shipping_country_mapping WHERE country_code = $1',
      [country_code]
    );

    let message = 'Mapping ajouté';
    if (existing.rows.length > 0 && existing.rows[0].zone_name !== zone_name) {
      message = `${country_code} déplacé de "${existing.rows[0].zone_name}" vers "${zone_name}"`;
    }

    const result = await pool.query(`
      INSERT INTO shipping_country_mapping (country_code, zone_name, is_postal_prefix)
      VALUES ($1, $2, $3)
      ON CONFLICT (country_code)
      DO UPDATE SET zone_name = $2, is_postal_prefix = $3
      RETURNING id
    `, [country_code, zone_name, is_postal_prefix || false]);

    res.json({ success: true, id: result.rows[0].id, message, moved: existing.rows.length > 0 });
  } catch (error) {
    console.error('Error upserting country mapping:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Supprimer un mapping pays
 */
const deleteCountryMapping = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM shipping_country_mapping WHERE id = $1', [id]);
    res.json({ success: true, message: 'Mapping supprimé' });
  } catch (error) {
    console.error('Error deleting country mapping:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Import en masse des tranches de tarif pour une zone (remplace les existantes)
 */
const bulkImportRates = async (req, res) => {
  try {
    const { zone_id, rates } = req.body;

    if (!zone_id || !Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ success: false, error: 'zone_id et rates[] requis' });
    }

    // Vérifier que la zone existe
    const zoneCheck = await pool.query('SELECT id FROM shipping_tariff_zones WHERE id = $1', [zone_id]);
    if (zoneCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Zone non trouvée' });
    }

    // Supprimer les anciennes tranches
    await pool.query('DELETE FROM shipping_tariff_rates WHERE zone_id = $1', [zone_id]);

    // Insérer les nouvelles
    let inserted = 0;
    for (const rate of rates) {
      await pool.query(
        'INSERT INTO shipping_tariff_rates (zone_id, weight_from, weight_to, price_ht) VALUES ($1, $2, $3, $4)',
        [zone_id, rate.weight_from, rate.weight_to, rate.price_ht]
      );
      inserted++;
    }

    res.json({ success: true, message: `${inserted} tranches importées`, inserted });
  } catch (error) {
    console.error('Error bulk importing rates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Mettre à jour la surcharge carburant d'une zone
 */
const updateZoneFuelSurcharge = async (req, res) => {
  try {
    const { id } = req.params;
    const { fuel_surcharge } = req.body;

    await pool.query(`
      UPDATE shipping_tariff_zones
      SET fuel_surcharge = $1
      WHERE id = $2
    `, [fuel_surcharge || 0, id]);

    res.json({ success: true, message: 'Surcharge carburant mise à jour' });
  } catch (error) {
    console.error('Error updating fuel surcharge:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getCarriersConfig,
  getCountries,
  getZones,
  createZone,
  deleteZone,
  createRate,
  updateRate,
  deleteRate,
  bulkImportRates,
  getCountryMapping,
  getAllZoneNames,
  upsertCountryMapping,
  deleteCountryMapping,
  updateZoneFuelSurcharge
};
