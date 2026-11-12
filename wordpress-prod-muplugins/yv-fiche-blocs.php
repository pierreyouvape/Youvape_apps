<?php
/**
 * Plugin Name: YouVape – blocs automatiques des fiches produits
 * Description: Tableau d'attributs, autres formats, conditions d'utilisation et questions, construits depuis les attributs WooCommerce. « Composition aromatique » (par recette) et « La marque » (par marque) se saisissent une fois.
 * Version:     0.4.2
 *
 * À placer dans wp-content/mu-plugins/. Branchement : trois modifications des gabarits
 * views/woo/partials/accordions/ (short-description.twig, description.twig, faq.twig) du thème enfant, et l'affichage des accordéons
 * vides dans woocommerce.php.
 * Le champ « description courte » n'est jamais modifié : il continue d'alimenter les données produit.
 *
 * Règle de rédaction (publicité des produits du vapotage, CSP L. 3513-4) : le code ne produit que des
 * informations objectives (composition, contenance, nicotine, PG/VG, conditions d'utilisation, matériel
 * recommandé, conservation, formats vendus). Aucun produit suggéré, aucune marque ni aucun modèle de
 * matériel nommé, aucun classement de ventes, aucun adjectif valorisant, aucune description de ressenti,
 * aucun lien vers le blog.
 *
 * 0.3.0 (06/11/2026) : tableau sans intertitres (la ligne « Informations » vide et « Inhalation
 * conseillée » disparaissent) ; lignes « Matériel recommandé » et « Conservation » ; la phrase
 * « … est aussi vendu en » passe dans la description, sous la présentation ; MTL = tirage serré ;
 * nom affiché dans les phrases = recette « de » marque (« Red Astaire de T-Juice »).
 *
 * 0.4.0 (09/11/2026) : reprend les corrections de la 0.2.1 (cache invalidé dès qu'une fiche change, ratio PG/VG
 * non ancré, chargement groupé des fiches voisines, filtre woocommerce_short_description) ; intertitre de marque
 * jamais vide ; présélection du goût robuste au chargement différé.
 * 0.4.1 (09/11/2026) : « Note fraîche : Oui », sans parler de menthe (attribut distinct).
 * 0.4.2 (09/11/2026) : termes comparés en entiers (le cache n'est plus vidé à chaque sauvegarde) ; titres des
 * fiches de la marque chargés d'un coup ; en-têtes du tableau resserrés pour tenir en mobile.
 */

defined( 'ABSPATH' ) || exit;

/* ------------------------------------------------------------------ *
 * Réglages
 * ------------------------------------------------------------------ */

const YVFB_SEUIL_MOTS       = 150;                 // texte ajouté seulement sous ce nombre de mots de description longue
const YVFB_TAX_MARQUE       = 'pwb-brand';         // Perfect Brands for WooCommerce
const YVFB_TAX_RECETTE      = 'yv_recette';        // relie les formats d'une même recette
const YVFB_META_COMPOSITION = 'yv_composition';    // texte « Composition aromatique », sur le terme de recette
const YVFB_META_MARQUE      = 'yv_texte_marque';   // texte « La marque », sur le terme de marque
const YVFB_CACHE            = 43200;               // 12 h
const YVFB_NB               = "\u{00A0}";          // espace insécable

// Attributs d'arômes, dans l'ordre d'affichage. « Frais » est une note, pas un arôme.
const YVFB_AROMES = array( 'pa_fruits', 'pa_plantes', 'pa_gourmandises', 'pa_boissons', 'pa_classics' );
const YVFB_FRAIS  = array( 'pa_types-de-e-liquides' => 'frais', 'pa_plantes' => 'menthe-ou-fraicheur' );

// Catégorie produit => format. Les produits ne sont rangés que dans la sous-catégorie.
const YVFB_FORMATS = array(
	'eliquides-10ml'             => 'flacon',
	'eliquides-grands-formats'   => 'grand',
	'eliquides-sels-de-nicotine' => 'sel',
	'concentres-10ml'            => 'concentre',
	'concentres-grands-formats'  => 'concentre',
	'bases-avec-nicotine'        => 'base',
	'bases-sans-nicotine'        => 'base',
	'boosters-de-nicotine'       => 'booster',
);
// Une même recette sous deux noms, le temps que le fabricant renomme ses produits : ancien nom => nom retenu.
const YVFB_ALIAS_RECETTES = array( 'love 66' => 'luv 66' );
const YVFB_ORDRE_FORMATS = array( 'flacon' => 1, 'grand' => 2, 'sel' => 3, 'concentre' => 4, 'base' => 5, 'booster' => 6, 'puff' => 7, 'cartouche' => 8 );

// Matériel recommandé par profil (yvfb_profil) : la plage de résistance seulement. Un même liquide va dans
// un pod, une cartouche ou un clearomiseur : nommer un type de matériel serait faux (choix du 06/11/2026).
// 1,8 Ω couvre les résistances MTL courantes des clearomiseurs.
const YVFB_MATERIEL = array(
	'sel'        => "de 0,8\u{00A0}Ω ou plus",
	'mtl'        => "de 0,8\u{00A0}Ω ou plus",
	'dl'         => "inférieure à 0,5\u{00A0}Ω",
);
// Intertitre H2 en tête de « La Description du Produit », par format.
const YVFB_PREFIXE_TITRE = array( 'flacon' => 'E-liquide', 'grand' => 'E-liquide', 'sel' => 'E-liquide', 'concentre' => 'Concentré' );
// Catégories citées dans les étapes de préparation d'un concentré (slug => texte du lien).
const YVFB_CATEGORIES_DIY = array(
	'flacons-vides'        => 'flacon vide',
	'bases'                => 'base',
	'bases-avec-nicotine'  => 'base avec nicotine',
	'boosters-de-nicotine' => 'boosters de nicotine',
);
// Booster de nicotine standard (10 ml à 20 mg/ml, le maximum autorisé en France), pour le calcul des grands formats.
const YVFB_BOOSTER_ML = 10;
const YVFB_BOOSTER_MG = 20;
const YVFB_CONSERVATION = 'Flacon fermé, à l’abri de la lumière et de la chaleur, hors de portée des enfants';

/* ------------------------------------------------------------------ *
 * Outils de langue
 * ------------------------------------------------------------------ */

/** « a », « a et b », « a, b et c ». */
function yvfb_liste( array $mots, string $et = 'et' ): string {
	$mots = array_values( array_filter( array_map( 'strval', $mots ), 'strlen' ) );
	if ( count( $mots ) < 2 ) {
		return $mots[0] ?? '';
	}
	$dernier = array_pop( $mots );
	return implode( ', ', $mots ) . ' ' . $et . ' ' . $dernier;
}

function yvfb_majuscule( string $texte ): string {
	return mb_strtoupper( mb_substr( $texte, 0, 1 ) ) . mb_substr( $texte, 1 );
}

function yvfb_lien( string $texte, string $url ): string {
	$texte = html_entity_decode( $texte, ENT_QUOTES, 'UTF-8' );
	return '<a href="' . esc_url( $url ) . '">' . esc_html( $texte ) . '</a>';
}

/** Lien vers une catégorie produit par son slug ; texte seul si la catégorie n'existe pas. */
function yvfb_lien_categorie( string $slug ): string {
	$texte = YVFB_CATEGORIES_DIY[ $slug ] ?? $slug;
	$terme = get_term_by( 'slug', $slug, 'product_cat' );
	$url   = $terme ? get_term_link( $terme ) : '';
	return $url && ! is_wp_error( $url ) ? yvfb_lien( $texte, $url ) : esc_html( $texte );
}

/** « 12mg » → 12.0 ; « 19,6mg » → 19.6. */
function yvfb_nombre( string $texte ): ?float {
	return preg_match( '/(\d+(?:[.,]\d+)?)/', $texte, $m ) ? (float) str_replace( ',', '.', $m[1] ) : null;
}

/** 12.0 → « 12 » ; 19.6 → « 19,6 ». */
function yvfb_chiffre( float $n ): string {
	return rtrim( rtrim( number_format( $n, 1, ',', '' ), '0' ), ',' );
}

/** « 10ml » → « 10 ml » ; « 10ml x10 » reste tel quel (lots). */
function yvfb_ml( string $terme ): string {
	$terme = trim( html_entity_decode( $terme, ENT_QUOTES, 'UTF-8' ) );
	if ( preg_match( '/^(\d+(?:[.,]\d+)?)\s*ml$/iu', $terme, $m ) ) {
		return yvfb_chiffre( (float) str_replace( ',', '.', $m[1] ) ) . YVFB_NB . 'ml';
	}
	return $terme;
}

/** [3, 6, 12, 18] → « 3, 6, 12 ou 18 mg/ml ». */
function yvfb_taux_texte( array $taux ): string {
	return yvfb_liste( array_map( 'yvfb_chiffre', $taux ), 'ou' ) . YVFB_NB . 'mg/ml';
}

function yvfb_sans_nicotine( array $f ): bool {
	return ! empty( $f['taux'] ) && 0.0 === (float) max( $f['taux'] );
}

/** « Red Astaire 50ml » → « Red Astaire » ; « Base Mix&Go 200ml 30/70 + Nicotine » → « Base Mix&Go 30/70 ». */
function yvfb_sans_contenance( string $nom ): string {
	$nom = html_entity_decode( wp_strip_all_tags( $nom ), ENT_QUOTES, 'UTF-8' );
	$nom = preg_replace( '/\s*\+\s*(boosters?|nicotine)\s*$/iu', '', $nom );
	return trim( preg_replace( '/\s+/u', ' ', preg_replace( '/\s*\d+\s*ml\b/iu', ' ', $nom ) ) );
}

/** Nom sans la marque : « Fraise de Kiwi Vapor 10ml » → « Fraise » ; « Red Astaire T-Juice 10ml » → « Red Astaire ». */
/** Le H1 commence par « E-liquide » : utile dans Google, de trop dans une phrase ou un tableau. */
function yvfb_sans_prefixe( string $nom ): string {
	return trim( preg_replace( '/^e-?\s?liquides?\s+/iu', '', $nom ) );
}

function yvfb_nom_court( string $nom, string $marque = '' ): string {
	$nom    = yvfb_sans_prefixe( yvfb_sans_contenance( $nom ) );
	$marque = trim( html_entity_decode( $marque, ENT_QUOTES, 'UTF-8' ) );
	if ( '' === $marque ) {
		return $nom;
	}
	$sans = trim( preg_replace( '/\s+/u', ' ', preg_replace( '/(^|\s)(?:(?:de|par|by)\s+)?' . preg_quote( $marque, '/' ) . '(?=\s|$)/iu', ' ', $nom ) ) );
	return '' === $sans ? $nom : $sans; // un produit qui ne porte que le nom de la marque le garde
}

/** Nom de la recette, sans format ni marque : « Concentré Red Astaire 30ml » → « Red Astaire » ; « Strawberry Ice Salt » → « Strawberry Ice ». */
function yvfb_recette_affiche( string $nom, string $marque = '' ): string {
	$n = yvfb_nom_court( $nom, $marque );
	$n = preg_replace( '/(^|\s)(concentr[ée]s?|ar[ôo]mes?|e-?liquides?)(?=\s|$)/iu', ' ', $n );
	$n = preg_replace( '/(^|\s)(nic(otine)? ?salts?|sels? de nicotine|nicotine plus)(?=\s|$)/iu', ' ', $n );
	$n = preg_replace( '/\s+salts?\s*$/iu', ' ', $n );
	$n = trim( preg_replace( '/\s+/u', ' ', $n ) );
	return '' === $n ? yvfb_nom_court( $nom, $marque ) : $n;
}

/**
 * Un nom PUIS sa marque, reliés par « de » (« Red Astaire de T-Juice », « Fraise de Kiwi Vapor ») :
 * la boutique vend des dizaines de recettes au nom générique, la marque les distingue.
 */
function yvfb_avec_marque( string $nom, string $marque = '' ): string {
	$marque = trim( html_entity_decode( $marque, ENT_QUOTES, 'UTF-8' ) );
	if ( '' === $marque || 0 === strcasecmp( $nom, $marque ) ) {
		return $nom;
	}
	$de = preg_match( '/^[aeiouyhâàéèêîôû]/iu', $marque ) ? 'd’' : 'de ';
	return $nom . ' ' . $de . $marque;
}

function yvfb_nom_affiche( string $nom, string $marque = '' ): string {
	return yvfb_avec_marque( yvfb_nom_court( $nom, $marque ), $marque );
}

/** Nom commun aux formats d'une recette : « Concentré Red Astaire 30ml » → « red astaire ». */
function yvfb_nom_recette( string $nom, array $marques = array() ): string {
	$n = mb_strtolower( html_entity_decode( wp_strip_all_tags( $nom ), ENT_QUOTES, 'UTF-8' ) );
	foreach ( $marques as $m ) {
		// « Shigeri Fighter Fuel 100ml », une fois le H1 appliqué, reste de la recette « shigeri ».
		$n = preg_replace( '/(^|\s)(?:(?:de|par|by)\s+)?' . preg_quote( mb_strtolower( html_entity_decode( $m, ENT_QUOTES, 'UTF-8' ) ), '/' ) . '(?=\s|$)/u', ' ', $n );
	}
	$n = preg_replace( '/(^|\s)(concentr[ée]s?|ar[ôo]mes?|e-?liquides?)(?=\s|$)/u', ' ', $n );
	$n = preg_replace( '/(^|\s)(nic(otine)? ?salts?|sels? de nicotine|nicotine plus)(?=\s|$)/u', ' ', $n );
	$n = preg_replace( '/\+? ?boosters?/u', ' ', $n );
	$n = preg_replace( '/(^|\s)\d+ ?ml(?=\s|$)/u', ' ', $n );
	// « Strawberry Ice Salt » : Salt = le format sel de nicotine, comme dans le module.
	$n = preg_replace( '/\s+salts?\s*$/u', ' ', $n );
	$n = trim( preg_replace( '/\s+/u', ' ', $n ) );
	return YVFB_ALIAS_RECETTES[ $n ] ?? $n;
}

/* ------------------------------------------------------------------ *
 * Concentrés : dosage et rendement
 * ------------------------------------------------------------------ */

/** Volume d'e-liquide qu'un flacon de concentré permet de préparer au dosage conseillé (30 ml à 15 % → 200). */
function yvfb_rendement( array $d ): ?int {
	$ml = yvfb_nombre( (string) $d['contenance'] );
	return $ml && $d['dosage'] ? (int) floor( $ml * 100 / $d['dosage'] + 1e-9 ) : null;
}

/** Volume d'exemple pour les étapes : le plus grand de 100, 50, 30, 20, 10 ml que le flacon permet de préparer. */
function yvfb_volume_exemple( array $d ): int {
	$ml = (float) yvfb_nombre( (string) $d['contenance'] );
	foreach ( array( 100, 50, 30, 20, 10 ) as $v ) {
		if ( $v * $d['dosage'] / 100 <= $ml + 1e-9 ) {
			return $v;
		}
	}
	return 10;
}

/** Temps de repos : « 2 à 3 jours », « sans temps de repos » (instantané) ou ''. */
function yvfb_maturation_texte( string $maturation ): string {
	return preg_match( '/instantan/iu', $maturation ) ? '' : esc_html( $maturation );
}

/* ------------------------------------------------------------------ *
 * Règles de vape, reprises de la FAQ PG/VG du site
 * ------------------------------------------------------------------ */

function yvfb_profil( array $d ): ?array {
	if ( in_array( $d['format'], array( '', 'concentre', 'booster' ), true ) ) {
		return null;
	}
	// Un sel en 50/50 va dans la plupart du matériel, comme un autre 50/50 (choix du 09/11/2026).
	if ( 'sel' === $d['format'] ) {
		return array( 'cle' => null !== $d['vg'] && $d['vg'] > 40 && $d['vg'] < 65 ? 'polyvalent' : 'sel' );
	}
	if ( null !== $d['vg'] && $d['vg'] <= 40 ) {
		return array( 'cle' => 'mtl' );
	}
	if ( null === $d['vg'] ) {
		return null;
	}
	return array( 'cle' => $d['vg'] < 65 ? 'polyvalent' : 'dl' );
}

/** « Résistance de 0,5 à 1,8 Ω » ; null pour un concentré, un booster ou un ratio inconnu. */
function yvfb_materiel( array $d ): ?string {
	$profil = yvfb_profil( $d );
	// Un 50/50 va dans la plupart du matériel : une plage de résistance serait fausse (choix du 09/11/2026).
	if ( $profil && 'polyvalent' === $profil['cle'] ) {
		return 'Compatible avec la plupart du matériel';
	}
	return $profil && isset( YVFB_MATERIEL[ $profil['cle'] ] ) ? 'Résistance ' . YVFB_MATERIEL[ $profil['cle'] ] : null;
}

/* ------------------------------------------------------------------ *
 * Données de la fiche (WooCommerce)
 * ------------------------------------------------------------------ */

function yvfb_produit( $produit ): ?WC_Product {
	$p = $produit instanceof WC_Product ? $produit : wc_get_product( $produit );
	return $p instanceof WC_Product ? $p : null;
}

function yvfb_termes( WC_Product $p, string $tax, string $champ = 'names' ): array {
	$termes = wc_get_product_terms( $p->get_id(), $tax, array( 'fields' => $champ ) );
	return is_wp_error( $termes ) ? array() : $termes;
}

function yvfb_premier( WC_Product $p, string $tax ): string {
	return (string) current( yvfb_termes( $p, $tax ) );
}

function yvfb_format( WC_Product $p ): string {
	foreach ( yvfb_termes( $p, 'product_cat', 'slugs' ) as $slug ) {
		if ( isset( YVFB_FORMATS[ $slug ] ) ) {
			return YVFB_FORMATS[ $slug ];
		}
	}
	return '';
}

function yvfb_taux( WC_Product $p ): array {
	$taux = array_filter( array_map( 'yvfb_nombre', yvfb_termes( $p, 'pa_taux-de-nicotine' ) ), 'is_float' );
	$taux = array_values( array_unique( $taux, SORT_REGULAR ) );
	sort( $taux, SORT_NUMERIC );
	return $taux;
}

function yvfb_sel( WC_Product $p ): bool {
	return 'sel' === yvfb_format( $p ) || 'oui' === mb_strtolower( yvfb_premier( $p, 'pa_sels-de-nicotine' ) );
}

/** Marque principale (terme racine de Perfect Brands). */
function yvfb_marque( WC_Product $p ): ?WP_Term {
	$termes = wc_get_product_terms( $p->get_id(), YVFB_TAX_MARQUE, array( 'fields' => 'all' ) );
	if ( is_wp_error( $termes ) || ! $termes ) {
		return null;
	}
	$terme = $termes[0];
	while ( $terme->parent ) {
		$parent = get_term( $terme->parent, YVFB_TAX_MARQUE );
		if ( ! $parent instanceof WP_Term ) {
			break;
		}
		$terme = $parent;
	}
	return $terme;
}

/** Gamme de la fiche (terme Perfect Brands qui a un parent), ou null. */
function yvfb_gamme( WC_Product $p ): ?WP_Term {
	$termes = wc_get_product_terms( $p->get_id(), YVFB_TAX_MARQUE, array( 'fields' => 'all' ) );
	foreach ( is_wp_error( $termes ) ? array() : $termes as $t ) {
		if ( $t->parent ) {
			return $t;
		}
	}
	return null;
}

/** Gammes de la marque qui ont des produits publiés, les plus fournies d'abord : [nom, url]. */
function yvfb_gammes_marque( WP_Term $marque ): array {
	$termes = get_terms( array( 'taxonomy' => YVFB_TAX_MARQUE, 'parent' => $marque->term_id, 'hide_empty' => true, 'orderby' => 'count', 'order' => 'DESC' ) );
	$out    = array();
	foreach ( is_wp_error( $termes ) ? array() : $termes as $t ) {
		$url = get_term_link( $t );
		if ( ! is_wp_error( $url ) && yvfb_terme_indexable( $t ) ) {
			$out[] = array( html_entity_decode( $t->name, ENT_QUOTES, 'UTF-8' ), $url );
		}
	}
	return $out;
}

/** Nom à citer avec la recette : la gamme si la fiche en a une (« Fighter Fuel »), sinon la marque (« T-Juice »). */
function yvfb_nom_marque( WC_Product $p ): string {
	$termes = wc_get_product_terms( $p->get_id(), YVFB_TAX_MARQUE, array( 'fields' => 'all' ) );
	if ( is_wp_error( $termes ) || ! $termes ) {
		return '';
	}
	foreach ( $termes as $t ) {
		if ( $t->parent ) {
			return html_entity_decode( $t->name, ENT_QUOTES, 'UTF-8' );
		}
	}
	return html_entity_decode( $termes[0]->name, ENT_QUOTES, 'UTF-8' );
}

/** Nom du produit sans la marque mère : la sous-marque seule est citée (« Shigeri Fighter Fuel Maison Fuel » → « Shigeri Fighter Fuel »). */
function yvfb_nom_sans_marque_mere( WC_Product $p ): string {
	$nom    = html_entity_decode( wp_strip_all_tags( $p->get_name() ), ENT_QUOTES, 'UTF-8' );
	$marque = yvfb_marque( $p );
	$nm     = yvfb_nom_marque( $p );
	if ( ! $marque ) {
		return $nom;
	}
	$mere = html_entity_decode( $marque->name, ENT_QUOTES, 'UTF-8' );
	if ( 0 === strcasecmp( $mere, $nm ) ) {
		return $nom;
	}
	$sans = trim( preg_replace( '/(^|\s)(?:(?:de|par|by)\s+)?' . preg_quote( $mere, '/' ) . '(?=\s|$)/iu', ' ', $nom ) );
	return '' === $sans ? $nom : $sans;
}

function yvfb_donnees_format( WC_Product $f ): array {
	return array(
		'format'     => yvfb_format( $f ),
		'nom'        => yvfb_sans_prefixe( $f->get_name() ),
		'url'        => $f->get_permalink(),
		'contenance' => yvfb_premier( $f, 'pa_contenance-e-liquide' ),
		'taux'       => yvfb_taux( $f ),
		'sel'        => yvfb_sel( $f ),
		'dosage'     => yvfb_nombre( yvfb_premier( $f, 'pa_dosage-arome' ) ),
		'maturation' => yvfb_premier( $f, 'pa_temps-de-maturation' ),
	);
}

/** Numéro du cache : il change dès qu'une fiche apparaît, disparaît ou change de nom, ce qui périme toutes les listes. */
function yvfb_version(): int {
	return (int) get_option( 'yvfb_version', 1 );
}

function yvfb_invalider(): void {
	update_option( 'yvfb_version', yvfb_version() + 1, true );
}

/** Charge d'un coup les fiches d'une liste : sans cela, une requête par fiche. */
function yvfb_amorcer( array $ids ): void {
	if ( $ids && function_exists( '_prime_post_caches' ) ) {
		_prime_post_caches( array_map( 'intval', $ids ), true, true );
	}
}

/** Autres formats de la recette : terme yv_recette s'il existe, sinon même marque et même nom. */
function yvfb_autres_formats( WC_Product $p ): array {
	$cle = 'yvfb_formats_' . yvfb_version() . '_' . $p->get_id();
	$ids = get_transient( $cle );
	if ( false === $ids ) {
		$ids     = array();
		$args    = array(
			'post_type'      => 'product',
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'no_found_rows'  => true,
			'post__not_in'   => array( $p->get_id() ),
		);
		$recette = yvfb_termes( $p, YVFB_TAX_RECETTE, 'ids' );
		$marque  = yvfb_marque( $p );
		if ( $recette ) {
			$args['tax_query'] = array( array( 'taxonomy' => YVFB_TAX_RECETTE, 'terms' => $recette ) );
			$ids               = get_posts( $args );
		} elseif ( $marque ) {
			$args['tax_query'] = array( array( 'taxonomy' => YVFB_TAX_MARQUE, 'terms' => $marque->term_id ) );
			$noms_marque       = array_filter( array( yvfb_nom_marque( $p ), $marque->name ) );
			$nom               = yvfb_nom_recette( $p->get_name(), $noms_marque );
			$candidats = get_posts( $args );
			if ( function_exists( '_prime_post_caches' ) ) {
				_prime_post_caches( $candidats, false, false );
			}
			foreach ( $candidats as $id ) {
				if ( yvfb_nom_recette( get_post_field( 'post_title', $id ), $noms_marque ) === $nom ) {
					$ids[] = $id;
				}
			}
		}
		set_transient( $cle, $ids, YVFB_CACHE );
	}
	yvfb_amorcer( $ids );
	$formats = array();
	foreach ( $ids as $id ) {
		$f = wc_get_product( $id );
		if ( $f && $f->is_visible() && yvfb_format( $f ) && yvfb_produit_indexable( $f ) ) {
			$formats[] = yvfb_donnees_format( $f );
		}
	}
	usort( $formats, fn( $a, $b ) => YVFB_ORDRE_FORMATS[ $a['format'] ] <=> YVFB_ORDRE_FORMATS[ $b['format'] ] );
	return $formats;
}

/**
 * Formats vendus en déclinaison d'une page qui regroupe tous les goûts : puffs (« Puff JNR Falcon Crest 58K »)
 * et flacon sans nicotine (« JNR Sans Nicotine 10ml »). On cherche par le NOM du goût : son slug peut être mal
 * saisi (blueberry-rasperry-cherry), et « lady-shigeri » n'est pas « shigeri ». Même marque racine. Une rupture
 * ne retire rien (le stock revient) ; seule la dépublication retire le lien. Le lien pré-sélectionne le goût.
 */
function yvfb_declinaisons( WC_Product $p ): array {
	$marque  = yvfb_marque( $p );
	$recette = yvfb_recette_affiche( yvfb_nom_sans_marque_mere( $p ), yvfb_nom_marque( $p ) );
	if ( '' === $recette ) {
		return array();
	}
	$cle  = 'yvfb_declinaisons_' . yvfb_version() . '_' . $p->get_id();
	$vars = get_transient( $cle );
	if ( false === $vars ) {
		// Le nom de la fiche, et les autres noms de la même recette (Luv 66 et Love 66).
		$retenu = yvfb_nom_recette( $recette );
		$noms   = array_unique( array_merge( array( $recette, $retenu ), array_keys( YVFB_ALIAS_RECETTES, $retenu, true ) ) );
		$slugs  = get_terms( array( 'taxonomy' => 'pa_gout', 'name' => $noms, 'hide_empty' => false, 'fields' => 'slugs' ) );
		$slugs  = array_values( array_unique( array_merge( is_array( $slugs ) ? $slugs : array(), array_map( 'sanitize_title', $noms ) ) ) );
		$vars  = get_posts( array(
			'post_type'      => 'product_variation',
			'post_status'    => 'publish',
			'posts_per_page' => 100,
			'fields'         => 'ids',
			'no_found_rows'  => true,
			'meta_query'     => array( array( 'key' => 'attribute_pa_gout', 'value' => $slugs, 'compare' => 'IN' ) ),
		) );
		set_transient( $cle, $vars, YVFB_CACHE );
	}
	yvfb_amorcer( $vars );
	yvfb_amorcer( array_filter( array_map( 'wp_get_post_parent_id', $vars ) ) );
	$formats = array();
	$vus     = array();
	foreach ( $vars as $id ) {
		$v = wc_get_product( $id );
		$f = $v ? wc_get_product( $v->get_parent_id() ) : null;
		// Relu à chaque affichage malgré le cache : une saveur dépubliée perd son lien tout de suite. Une rupture ne retire rien.
		if ( ! $f || isset( $vus[ $f->get_id() ] ) || 'publish' !== $v->get_status() || ! $f->is_visible() || ! yvfb_produit_indexable( $f ) ) {
			continue;
		}
		$cats = yvfb_termes( $f, 'product_cat', 'slugs' );
		$puff = in_array( 'puffs', $cats, true );
		$cart = in_array( 'cartouches-pre-remplies', $cats, true );
		if ( ! $puff && ! $cart && ! in_array( 'eliquides-10ml', $cats, true ) ) {
			continue;
		}
		$m = yvfb_marque( $f );
		if ( $marque && ( ! $m || $m->term_id !== $marque->term_id ) ) {
			continue;
		}
		$vus[ $f->get_id() ] = true;
		$formats[] = array(
			'format'     => $puff ? 'puff' : ( $cart ? 'cartouche' : 'flacon' ),
			'nom'        => yvfb_sans_prefixe( trim( preg_replace( '/\s+/u', ' ', preg_replace( '/\b(\d+\s*mg|sans nicotine|v\d+)\b/iu', ' ', $f->get_name() ) ) ) ),
			// L'adresse avec ?attribute_pa_gout= est en noindex : le lien vise la page indexable,
			// le goût passe après le # (ignoré par Google), lu par le script ci-dessous.
			'url'        => $f->get_permalink() . '#gout=' . rawurlencode( (string) get_post_meta( $id, 'attribute_pa_gout', true ) ),
			'contenance' => ( $puff || $cart ) ? '' : yvfb_premier( $f, 'pa_contenance-e-liquide' ),
			'reservoir'  => yvfb_premier( $f, 'pa_contenance-reservoir' ),
			'taux'       => yvfb_taux( $f ),
			'sel'        => yvfb_sel( $f ),
			'dosage'     => null,
			'maturation' => '',
			// Nom complet pour le tableau : deux puffs ne diffèrent parfois que par ce qu'on retire de « nom ».
			'nom_reel'   => yvfb_sans_prefixe( $f->get_name() ),
			'en_stock'   => $v->is_in_stock(),
			'ventes'     => (int) $f->get_total_sales(),
		);
	}
	return $formats;
}

/** Une page en noindex ne reçoit pas de lien : il ne servirait à rien pour le SEO (réglage Yoast, décision du 09/11/2026). */
function yvfb_produit_indexable( WC_Product $f ): bool {
	return '1' !== (string) get_post_meta( $f->get_id(), '_yoast_wpseo_meta-robots-noindex', true );
}

function yvfb_terme_indexable( WP_Term $t ): bool {
	if ( ! class_exists( 'WPSEO_Taxonomy_Meta' ) ) {
		return true;
	}
	$reglage = (string) WPSEO_Taxonomy_Meta::get_term_meta( $t, $t->taxonomy, 'noindex' );
	if ( 'noindex' === $reglage || 'index' === $reglage ) {
		return 'index' === $reglage;
	}
	return ! ( class_exists( 'WPSEO_Options' ) && WPSEO_Options::get( 'noindex-tax-' . $t->taxonomy ) );
}

/**
 * Pages d'étiquette de la marque auxquelles la fiche appartient (« E-liquides JNR ») : au moins 2 produits,
 * les plus fournies d'abord, 3 au plus. Lues à chaque affichage : une page vidée perd son lien.
 */
function yvfb_pages_marque( WC_Product $p ): array {
	$noms   = array_filter( array( yvfb_nom_marque( $p ), yvfb_marque( $p )->name ?? '' ) );
	$termes = get_the_terms( $p->get_id(), 'product_tag' );
	if ( ! $noms || ! is_array( $termes ) ) {
		return array();
	}
	$termes = array_filter( $termes, function ( $t ) use ( $noms ) {
		foreach ( $noms as $n ) {
			if ( $t->count >= 2 && false !== mb_stripos( $t->name, $n ) && yvfb_terme_indexable( $t ) ) {
				return true;
			}
		}
		return false;
	} );
	usort( $termes, fn( $a, $b ) => $b->count <=> $a->count );
	$pages = array();
	foreach ( array_slice( $termes, 0, 3 ) as $t ) {
		$url = get_term_link( $t );
		if ( ! is_wp_error( $url ) ) {
			$pages[] = array( $t->name, $url );
		}
	}
	return $pages;
}

/** Nom d'une page à plusieurs goûts dans les phrases : « E-liquide JNR Sans Nicotine 10ml » → « JNR Sans Nicotine ». */
function yvfb_nom_multi( WC_Product $p ): string {
	return yvfb_sans_prefixe( yvfb_sans_contenance( $p->get_name() ) );
}

/** Page qui regroupe tous les goûts d'un e-liquide (« JNR Sans Nicotine 10ml ») : ce n'est pas une recette. */
function yvfb_est_multi( WC_Product $p ): bool {
	if ( ! $p->is_type( 'variable' ) || ! in_array( yvfb_format( $p ), array( 'flacon', 'grand', 'sel', 'concentre' ), true ) ) {
		return false;
	}
	$attr = $p->get_attributes()['pa_gout'] ?? null;
	return $attr && $attr->get_variation() && count( $attr->get_options() ) >= 2;
}

/** Fiches de la marque par recette et par format : sert à relier chaque goût d'une page à plusieurs goûts. */
function yvfb_fiches_marque( WC_Product $p, array $noms ): array {
	$marque = yvfb_marque( $p );
	if ( ! $marque ) {
		return array();
	}
	$cle = 'yvfb_fiches_marque_' . yvfb_version() . '_' . $marque->term_id;
	$ids = get_transient( $cle );
	if ( false === $ids ) {
		$ids = get_posts( array(
			'post_type'      => 'product',
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'no_found_rows'  => true,
			'tax_query'      => array( array( 'taxonomy' => YVFB_TAX_MARQUE, 'terms' => $marque->term_id ) ),
		) );
		set_transient( $cle, $ids, YVFB_CACHE );
	}
	yvfb_amorcer( $ids );
	$fiches = array();
	foreach ( $ids as $id ) {
		$f = wc_get_product( $id );
		if ( $f && $f->get_id() !== $p->get_id() && $f->is_visible() && yvfb_produit_indexable( $f ) && in_array( yvfb_format( $f ), array( 'sel', 'grand' ), true ) ) {
			$fiches[ yvfb_nom_recette( $f->get_name(), $noms ) ][ yvfb_format( $f ) ] = $f;
		}
	}
	return $fiches;
}

/** Noms de tous les goûts vendus sur la page (déclinaisons publiées), triés. */
function yvfb_noms_gouts( WC_Product $p ): array {
	yvfb_amorcer( $p->get_children() );
	$noms = array();
	foreach ( $p->get_children() as $id ) {
		$v = wc_get_product( $id );
		if ( $v && 'publish' === $v->get_status() && '' !== (string) $v->get_attribute( 'pa_gout' ) ) {
			$noms[] = (string) $v->get_attribute( 'pa_gout' );
		}
	}
	$noms = array_values( array_unique( $noms ) );
	sort( $noms );
	return $noms;
}

/**
 * Lignes du tableau des goûts : uniquement ceux qui ont une fiche à lier, un seul lien par goût.
 * Le grand format d'abord, sinon le sel de nicotine. Une ligne sans lien n'apporte rien (choix du 09/11/2026).
 */
function yvfb_gouts( WC_Product $p ): array {
	$noms   = array_filter( array( yvfb_nom_marque( $p ), yvfb_marque( $p )->name ?? '' ) );
	$fiches = yvfb_fiches_marque( $p, $noms );
	$lignes = array();
	foreach ( yvfb_noms_gouts( $p ) as $gout ) {
		$liees = $fiches[ yvfb_nom_recette( $gout, $noms ) ] ?? array();
		$cible = $liees['grand'] ?? $liees['sel'] ?? null;
		if ( ! $cible ) {
			continue;
		}
		$source = $liees['sel'] ?? $cible;
		$aromes = array();
		foreach ( YVFB_AROMES as $tax ) {
			foreach ( yvfb_termes( $source, $tax, 'all' ) as $t ) {
				if ( ( YVFB_FRAIS[ $tax ] ?? '' ) !== $t->slug ) {
					$aromes[] = mb_strtolower( $t->name );
				}
			}
		}
		$lignes[] = array( 'gout' => $gout, 'aromes' => array_values( array_unique( $aromes ) ), 'url' => $cible->get_permalink() );
	}
	return $lignes;
}

function yvfb_tableau_gouts( array $d ): string {
	$lignes = '';
	foreach ( $d['gouts'] as $g ) {
		$lignes .= '<tr><td>' . yvfb_lien( $g['gout'], $g['url'] ) . '</td><td>' . ( $g['aromes'] ? esc_html( yvfb_majuscule( yvfb_liste( $g['aromes'] ) ) ) : '—' ) . '</td></tr>';
	}
	return '<h3 class="yv-autres-formats">Goûts de ' . esc_html( $d['nom'] ) . ' aussi vendus dans un autre format</h3>'
		. '<div class="yv-formats-defile" style="overflow-x:auto"><table class="yv-formats"><thead><tr><th scope="col">Goût</th><th scope="col">Arômes</th></tr></thead><tbody>'
		. $lignes . '</tbody></table></div>';
}

function yvfb_tous_les_formats( WC_Product $p ): array {
	$formats = array_merge( yvfb_autres_formats( $p ), yvfb_declinaisons( $p ) );
	// Dans un même format, le lien mis en avant est un choix : ce qui est en stock, puis ce qui se vend le plus.
	usort( $formats, fn( $a, $b ) => array( YVFB_ORDRE_FORMATS[ $a['format'] ], ! ( $a['en_stock'] ?? true ), -( $a['ventes'] ?? 0 ) )
		<=> array( YVFB_ORDRE_FORMATS[ $b['format'] ], ! ( $b['en_stock'] ?? true ), -( $b['ventes'] ?? 0 ) ) );
	return $formats;
}

/** Bloc « La marque » d'une fiche rangée dans une sous-marque : le texte de la sous-marque, puis sa marque mère. */
function yvfb_bloc_marque( WC_Product $p ): ?array {
	$gamme  = yvfb_gamme( $p );
	$marque = yvfb_marque( $p );
	if ( ! $gamme || ! $marque || $gamme->term_id === $marque->term_id ) {
		return null;
	}
	$lien = get_term_link( $marque );
	if ( is_wp_error( $lien ) ) {
		return null;
	}
	$nom = html_entity_decode( $gamme->name, ENT_QUOTES, 'UTF-8' );
	return array(
		'nom'    => $nom,
		'texte'  => (string) get_term_meta( $gamme->term_id, YVFB_META_MARQUE, true ),
		'mere'   => array( html_entity_decode( $marque->name, ENT_QUOTES, 'UTF-8' ), $lien ),
		'soeurs' => array_values( array_filter( yvfb_gammes_marque( $marque ), fn( $g ) => $g[0] !== $nom ) ),
	);
}

function yvfb_donnees( WC_Product $p ): array {
	$aromes = array();
	foreach ( YVFB_AROMES as $tax ) {
		foreach ( yvfb_termes( $p, $tax, 'all' ) as $t ) {
			if ( ( YVFB_FRAIS[ $tax ] ?? '' ) !== $t->slug ) {
				$aromes[] = mb_strtolower( $t->name );
			}
		}
	}
	$frais = false;
	foreach ( YVFB_FRAIS as $tax => $slug ) {
		$frais = $frais || in_array( $slug, yvfb_termes( $p, $tax, 'slugs' ), true );
	}
	$ratio = yvfb_premier( $p, 'pa_ratio-pg-vg' );
	$pgvg  = preg_match( '/(\d+)\s*\/\s*(\d+)/', $ratio, $m ) ? array( (int) $m[1], (int) $m[2] ) : array( null, null );

	$attributs = array();
	foreach ( $p->get_attributes() as $attr ) {
		if ( $attr->get_visible() && 'pa_colories' !== $attr->get_name() ) {
			$valeurs     = $attr->is_taxonomy() ? yvfb_termes( $p, $attr->get_name() ) : $attr->get_options();
			$attributs[] = array( wc_attribute_label( $attr->get_name(), $p ), yvfb_liste( $valeurs ) );
		}
	}

	$marque  = yvfb_marque( $p );
	$recette = (int) current( yvfb_termes( $p, YVFB_TAX_RECETTE, 'ids' ) );
	$lien    = $marque ? get_term_link( $marque ) : '';
	$nm      = yvfb_nom_marque( $p );
	$base    = yvfb_nom_sans_marque_mere( $p );
	$multi   = yvfb_est_multi( $p );
	$seul    = yvfb_nom_multi( $p );
	return array(
		// recette : « Red Astaire » · nom : la recette et sa marque, pour les phrases sur la recette
		// (autres formats, questions) · nom_complet : le produit avec son format (« Red Astaire Nic Salt
		// de T-Juice ») · nom_produit : idem, contenance comprise pour un grand format, pour qu'il ne
		// reprenne pas au 10 ml le nom seul de la recette (« Red Astaire 50 ml de T-Juice »).
		// Page à plusieurs goûts : son nom tel quel (« JNR Sans Nicotine »), ce n'est pas une recette.
		'recette'      => $multi ? $seul : yvfb_recette_affiche( $base, $nm ),
		'nom'          => $multi ? $seul : yvfb_avec_marque( yvfb_recette_affiche( $base, $nm ), $nm ),
		'nom_complet'  => $multi ? $seul : yvfb_nom_affiche( $base, $nm ),
		'nom_produit'  => $multi ? $seul : yvfb_avec_marque(
			yvfb_nom_court( $base, $nm )
				. ( 'grand' === yvfb_format( $p ) && yvfb_premier( $p, 'pa_contenance-e-liquide' ) ? ' ' . yvfb_ml( yvfb_premier( $p, 'pa_contenance-e-liquide' ) ) : '' ),
			$nm
		),
		'sujet'        => 'concentre' === yvfb_format( $p )
			? 'le concentré ' . yvfb_avec_marque( yvfb_recette_affiche( $base, $nm ), $nm )
			: '',
		'description_h2' => (bool) preg_match( '/<h2/i', $p->get_description() ),
		'format'       => yvfb_format( $p ),
		'contenance'   => yvfb_premier( $p, 'pa_contenance-e-liquide' ),
		'taux'         => yvfb_taux( $p ),
		'sel'          => yvfb_sel( $p ),
		'pg'           => $pgvg[0],
		'vg'           => $pgvg[1],
		'aromes'       => array_values( array_unique( $aromes ) ),
		'frais'        => $frais,
		'origine'      => yvfb_premier( $p, 'pa_origine' ),
		'dosage'       => yvfb_nombre( yvfb_premier( $p, 'pa_dosage-arome' ) ),
		'maturation'   => yvfb_premier( $p, 'pa_temps-de-maturation' ),
		'attributs'    => $attributs,
		'marque'       => $marque ? array(
			'nom'   => $marque->name,
			'url'   => is_wp_error( $lien ) ? '' : $lien,
			'texte' => (string) get_term_meta( $marque->term_id, YVFB_META_MARQUE, true ),
			// Toujours à jour : lues dans la taxonomie, jamais écrites dans le texte de marque.
			'gammes' => yvfb_gammes_marque( $marque ),
		) : null,
		'bloc_marque'  => yvfb_bloc_marque( $p ),
		'gamme'        => ( $g = yvfb_gamme( $p ) ) && ! is_wp_error( get_term_link( $g ) )
			? array( 'nom' => html_entity_decode( $g->name, ENT_QUOTES, 'UTF-8' ), 'url' => get_term_link( $g ) )
			: null,
		'composition'  => $recette ? (string) get_term_meta( $recette, YVFB_META_COMPOSITION, true ) : '',
		'presentation' => (string) apply_filters( 'woocommerce_short_description', $p->get_short_description() ),
		'formats'      => $multi ? array() : yvfb_tous_les_formats( $p ),
		'gouts'        => $multi ? yvfb_gouts( $p ) : array(),
		'gouts_noms'   => $multi ? yvfb_noms_gouts( $p ) : array(),
		'pages_marque' => yvfb_pages_marque( $p ),
	);
}

function yvfb_donnees_cache( WC_Product $p ): array {
	static $cache = array();
	return $cache[ $p->get_id() ] ??= yvfb_donnees( $p );
}

function yvfb_injection_active( WC_Product $p ): bool {
	$mots = preg_split( '/\s+/u', trim( wp_strip_all_tags( $p->get_description() ) ), -1, PREG_SPLIT_NO_EMPTY );
	return (bool) apply_filters( 'yvfb_injection_active', count( $mots ) < YVFB_SEUIL_MOTS, $p );
}

/* ------------------------------------------------------------------ *
 * Rendu (n'utilise que le tableau de données)
 * ------------------------------------------------------------------ */

/** Tableau « Les Points Clés » : une seule liste de lignes, sans intertitre. */
function yvfb_rendu_points_cles( array $d ): string {
	$lignes = array();
	if ( $d['format'] ) {
		if ( $d['aromes'] ) {
			$lignes[] = array( 'Arômes', esc_html( yvfb_majuscule( yvfb_liste( $d['aromes'] ) ) ) );
		}
		if ( ! empty( $d['gouts_noms'] ) ) {
			$lignes[] = array( 'Goûts', count( $d['gouts_noms'] ) . ' au choix' );
		}
		if ( $d['frais'] ) {
			// « Frais » ne dit rien de la menthe : elle a son propre attribut, et figure alors dans les arômes.
			$lignes[] = array( 'Note fraîche', 'Oui' );
		}
		if ( $d['contenance'] ) {
			$lignes[] = array( 'Contenance', esc_html( yvfb_ml( $d['contenance'] ) ) );
		}
		if ( 'concentre' === $d['format'] ) {
			if ( $d['dosage'] ) {
				$lignes[] = array( 'Dosage conseillé', yvfb_chiffre( $d['dosage'] ) . YVFB_NB . '%' );
			}
			if ( $d['maturation'] ) {
				$lignes[] = array( 'Maturation', esc_html( $d['maturation'] ) );
			}
			// À la place du matériel, qui ne concerne pas un concentré : comment il s'utilise et ce qu'il donne.
			$lignes[] = array( 'Utilisation', 'À diluer dans une base, ne se vapote pas pur' );
			$rendement = yvfb_rendement( $d );
			if ( $rendement ) {
				$lignes[] = array( 'Rendement', 'Jusqu’à ' . $rendement . YVFB_NB . 'ml d’e-liquide au dosage conseillé' );
			}
		} elseif ( yvfb_sans_nicotine( $d ) ) {
			$lignes[] = array( 'Nicotine', 'grand' === $d['format'] ? 'Sans nicotine, à booster' : 'Sans nicotine' );
		} elseif ( $d['taux'] ) {
			$lignes[] = array( 'Nicotine', yvfb_taux_texte( $d['taux'] ) . ( $d['sel'] ? ', en sel de nicotine' : '' ) );
		}
		if ( null !== $d['pg'] ) {
			$lignes[] = array( 'PG/VG', $d['pg'] . '/' . $d['vg'] );
		}
		$materiel = yvfb_materiel( $d );
		if ( $materiel ) {
			$lignes[] = array( 'Matériel recommandé', esc_html( $materiel ) );
		}
		$lignes[] = array( 'Conservation', esc_html( YVFB_CONSERVATION ) );
	} else {
		foreach ( $d['attributs'] as list( $label, $valeur ) ) {
			$lignes[] = array( html_entity_decode( $label, ENT_QUOTES, 'UTF-8' ), esc_html( $valeur ) );
		}
	}
	if ( $d['marque'] ) {
		$lignes[] = array( 'Marque', $d['marque']['url'] ? yvfb_lien( $d['marque']['nom'], $d['marque']['url'] ) : esc_html( $d['marque']['nom'] ) );
	}
	if ( ! empty( $d['gamme'] ) ) {
		$lignes[] = array( 'Gamme', yvfb_lien( $d['gamme']['nom'], $d['gamme']['url'] ) );
	}
	if ( $d['format'] && $d['origine'] ) {
		$lignes[] = array( 'Origine', esc_html( $d['origine'] ) );
	}
	if ( ! $lignes ) {
		return '';
	}
	$html = '<table class="yv-points-cles"><tbody>';
	foreach ( $lignes as list( $label, $valeur ) ) {
		$html .= '<tr><th scope="row">' . esc_html( trim( $label ) ) . '</th><td>' . $valeur . '</td></tr>';
	}
	return $html . '</tbody></table>';
}

/** « en puff avec nicotine ou sans nicotine » (deux liens), « en puff » ou '' ; jamais de taux. */
function yvfb_texte_puff( array $formats ): string {
	$avec = $sans = null;
	foreach ( $formats as $f ) {
		if ( 'puff' !== $f['format'] ) {
			continue;
		}
		if ( yvfb_sans_nicotine( $f ) ) {
			$sans = $sans ?? $f;
		} else {
			$avec = $avec ?? $f;
		}
	}
	if ( $avec && $sans ) {
		return 'en ' . yvfb_lien( 'puff avec nicotine', $avec['url'] ) . ' ou ' . yvfb_lien( 'sans nicotine', $sans['url'] );
	}
	$f = $avec ?? $sans;
	return $f ? 'en ' . yvfb_lien( 'puff', $f['url'] ) . ( $sans ? ' sans nicotine' : '' ) : '';
}

/** Catégorie affichée, et son lien la première fois seulement (si la page est indexable). */
const YVFB_CATEGORIES = array(
	'flacon'    => array( 'E-liquide 10 ml', 'eliquides-10ml' ),
	'base'      => array( 'Base', '' ),
	'grand'     => array( 'E-liquide grand format', 'eliquides-grands-formats' ),
	'sel'       => array( 'E-liquide sel de nicotine', 'eliquides-sels-de-nicotine' ),
	'concentre' => array( 'Concentré', '' ),
	'booster'   => array( 'Booster', 'boosters-de-nicotine' ),
	'puff'      => array( 'Puff', 'puffs' ),
	'cartouche' => array( 'Cartouche pré-remplie', 'cartouches-pre-remplies' ),
);

function yvfb_cellule_categorie( string $format, array &$vues ): string {
	list( $texte, $slug ) = YVFB_CATEGORIES[ $format ] ?? array( '', '' );
	if ( '' === $slug || isset( $vues[ $format ] ) ) {
		return esc_html( $texte );
	}
	$vues[ $format ] = true;
	$terme = get_term_by( 'slug', $slug, 'product_cat' );
	$url   = $terme instanceof WP_Term && yvfb_terme_indexable( $terme ) ? get_term_link( $terme ) : '';
	return $url && ! is_wp_error( $url ) ? yvfb_lien( $texte, $url ) : esc_html( $texte );
}

/** Dès 3 produits, un tableau : une suite de liens dans une phrase devient illisible. Jamais de taux de nicotine. */
function yvfb_tableau_formats( array $d ): string {
	$lignes = '';
	$vues   = array();
	foreach ( $d['formats'] as $f ) {
		$contenance = $f['contenance'] ?: ( $f['reservoir'] ?? '' );
		if ( 'concentre' === $f['format'] ) {
			$nic = '—';
		} elseif ( 'sel' === $f['format'] || ! empty( $f['sel'] ) ) {
			$nic = 'Sel de nicotine';
		} elseif ( yvfb_sans_nicotine( $f ) ) {
			$nic = 'grand' === $f['format'] ? 'Sans nicotine, à booster' : 'Sans nicotine';
		} else {
			$nic = 'Avec nicotine';
		}
		$lignes .= '<tr><td>' . yvfb_lien( $f['nom_reel'] ?? $f['nom'], $f['url'] ) . '</td><td>' . yvfb_cellule_categorie( $f['format'], $vues ) . '</td><td>'
			. ( $contenance ? esc_html( yvfb_ml( $contenance ) ) : '—' ) . '</td><td>' . $nic . '</td></tr>';
	}
	return '<h3 class="yv-autres-formats">Autres produits au goût ' . esc_html( $d['recette'] ) . '</h3>'
		. '<div class="yv-formats-defile" style="overflow-x:auto"><table class="yv-formats"><thead><tr><th scope="col" style="padding-right:8px">Nom</th><th scope="col" style="padding-right:8px">Catégorie</th><th scope="col" style="padding-right:8px">Contenance</th><th scope="col">Nicotine</th></tr></thead><tbody>'
		. $lignes . '</tbody></table></div>';
}

function yvfb_rendu_autres_formats( array $d ): string {
	if ( ! empty( $d['gouts'] ) ) {
		return yvfb_tableau_gouts( $d );
	}
	if ( count( $d['formats'] ) >= 3 ) {
		return yvfb_tableau_formats( $d );
	}
	$items = array();
	foreach ( $d['formats'] as $f ) {
		$ml   = $f['contenance'] ? yvfb_ml( $f['contenance'] ) : '';
		// Aucun taux de nicotine dans les phrases : un taux retiré du catalogue y resterait affiché
		// (choix du 06/11/2026). Le tableau des Points clés, lu sur les attributs, les donne.
		$taux = '';
		switch ( $f['format'] ) {
			case 'flacon':
			case 'base':
				$items[] = 'en ' . yvfb_lien( $ml ? 'flacon de ' . $ml : 'flacon', $f['url'] ) . ( yvfb_sans_nicotine( $f ) ? ' (sans nicotine)' : $taux );
				break;
			case 'grand':
				$items[] = 'en ' . yvfb_lien( $ml ? 'flacon de ' . $ml : 'grand format', $f['url'] ) . ( yvfb_sans_nicotine( $f ) ? ' (sans nicotine, à booster)' : $taux );
				break;
			case 'sel':
				$items[] = 'en ' . yvfb_lien( 'sel de nicotine', $f['url'] ) . $taux;
				break;
			case 'concentre':
				$items[] = 'en ' . yvfb_lien( $ml ? 'concentré de ' . $ml : 'concentré', $f['url'] ) . ' pour le DIY';
				break;
			case 'booster':
				$items[] = 'en ' . yvfb_lien( $ml ? 'booster de ' . $ml : 'booster', $f['url'] ) . $taux;
				break;
		}
	}
	$puff = yvfb_texte_puff( $d['formats'] );
	if ( $puff ) {
		$items[] = $puff;
	}
	foreach ( $d['formats'] as $f ) {
		if ( 'cartouche' === $f['format'] ) {
			$items[] = 'en ' . yvfb_lien( 'cartouche pré-remplie', $f['url'] );
			break;
		}
	}
	return $items ? '<p class="yv-autres-formats">' . esc_html( $d['nom'] ) . ' est aussi vendu ' . yvfb_liste( $items ) . '.</p>' : '';
}

/** H2 « E-liquide Red Astaire de T-Juice 10 ml », sauf si la description longue a déjà le sien (fiches pas encore réécrites). */
function yvfb_rendu_titre( array $d ): string {
	$prefixe = YVFB_PREFIXE_TITRE[ $d['format'] ] ?? '';
	if ( ! $prefixe || $d['description_h2'] ) {
		return '';
	}
	$titre = $d['nom_complet'];
	if ( 0 !== mb_stripos( $titre, mb_substr( $prefixe, 0, 7 ) ) ) {
		$titre = $prefixe . ' ' . $titre;
	}
	if ( $d['contenance'] ) {
		$titre .= ' ' . yvfb_ml( $d['contenance'] );
	}
	return '<h2 class="yv-titre-description">' . esc_html( $titre ) . '</h2>';
}

/** Haut de « La Description du Produit » : titre, présentation (description courte), puis les autres formats. */
function yvfb_rendu_presentation( array $d ): string {
	$html = trim( $d['presentation'] ) ? '<div class="yv-presentation">' . $d['presentation'] . '</div>' : '';
	return yvfb_rendu_titre( $d ) . $html . yvfb_rendu_autres_formats( $d );
}

/** Conditions d'utilisation : dosage pour un concentré, calcul pour un booster, ratio PG/VG sinon. Aucune marque de matériel. */
function yvfb_phrase_utilisation( array $d ): string {
	if ( 'concentre' === $d['format'] ) {
		if ( ! $d['dosage'] ) {
			return '';
		}
		$texte = 'Ce concentré se mélange à une base, à ' . yvfb_chiffre( $d['dosage'] ) . YVFB_NB . '% du volume final';
		if ( '' === $d['maturation'] ) {
			return $texte . '.';
		}
		return $texte . ( preg_match( '/instantan/iu', $d['maturation'] ) ? ', sans temps de repos.' : ', puis le mélange repose ' . esc_html( $d['maturation'] ) . ' avant utilisation.' );
	}
	if ( 'booster' === $d['format'] ) {
		$ml = yvfb_nombre( $d['contenance'] );
		if ( 1 !== count( $d['taux'] ) || ! $ml ) {
			return '';
		}
		$t = $d['taux'][0];
		return 'Ajouté à ' . yvfb_chiffre( 4 * $ml ) . YVFB_NB . 'ml d’e-liquide sans nicotine, un flacon de ' . yvfb_chiffre( $ml ) . YVFB_NB . 'ml à '
			. yvfb_chiffre( $t ) . YVFB_NB . 'mg/ml donne ' . yvfb_chiffre( 5 * $ml ) . YVFB_NB . 'ml à ' . yvfb_chiffre( $t / 5 ) . YVFB_NB . 'mg/ml.';
	}
	$profil = yvfb_profil( $d );
	if ( ! $profil ) {
		return '';
	}
	$sujet = 'base' === $d['format'] ? 'un liquide préparé avec cette base' : esc_html( $d['nom_produit'] );
	$pg    = $d['pg'] . YVFB_NB . '% de PG';
	$vg    = $d['vg'] . YVFB_NB . '% de VG';
	if ( 'sel' === $profil['cle'] ) {
		$texte = "En sel de nicotine, $sujet s’utilise en inhalation indirecte (MTL), avec un tirage serré et une faible puissance, entre 10 et 20" . YVFB_NB . 'watts.';
	} elseif ( 'mtl' === $profil['cle'] ) {
		$texte = "Avec $pg, $sujet s’utilise en inhalation indirecte (MTL), avec un tirage serré et une faible puissance, entre 10 et 20" . YVFB_NB . 'watts.';
	} elseif ( 'polyvalent' === $profil['cle'] ) {
		$texte = "Avec $pg et $vg, $sujet s’utilise dans une cigarette électronique ou une puff rechargeable : cette composition le rend compatible avec la plupart du matériel.";
		if ( array_filter( $d['taux'], fn( $t ) => $t >= 12 ) ) {
			$texte .= ' À fort taux de nicotine, l’inhalation indirecte est recommandée.';
		}
		return $texte;
	} else {
		$texte = "Avec $vg, $sujet s’utilise en inhalation directe (DL), avec un tirage aérien, à partir de 50" . YVFB_NB . 'watts. À ces puissances, le taux de nicotine recommandé est de 6' . YVFB_NB . 'mg/ml ou moins.';
	}
	$materiel = yvfb_materiel( $d );
	if ( $materiel ) {
		$texte .= ' Matériel recommandé' . YVFB_NB . ': ' . esc_html( mb_strtolower( mb_substr( $materiel, 0, 1 ) ) . mb_substr( $materiel, 1 ) ) . '.';
	}
	return $texte;
}

/** Étapes de préparation d'un e-liquide avec un concentré (dosage, base, maturation, rendement). */
function yvfb_rendu_diy( array $d ): string {
	if ( 'concentre' !== $d['format'] || ! $d['dosage'] ) {
		return '';
	}
	$v      = yvfb_volume_exemple( $d );
	$arome  = $v * $d['dosage'] / 100;
	$base   = $v - $arome;
	$repos  = yvfb_maturation_texte( (string) $d['maturation'] );
	$etapes = array(
		'Prendre un ' . yvfb_lien_categorie( 'flacons-vides' ) . ' de la contenance voulue, par exemple ' . $v . YVFB_NB . 'ml.',
		'Verser le concentré à ' . yvfb_chiffre( $d['dosage'] ) . YVFB_NB . '% du volume final, soit ' . yvfb_chiffre( $arome ) . YVFB_NB . 'ml pour ' . $v . YVFB_NB . 'ml.',
		'Compléter avec une ' . yvfb_lien_categorie( 'bases' ) . ', soit ' . yvfb_chiffre( $base ) . YVFB_NB . 'ml pour ' . $v . YVFB_NB . 'ml. Pour un e-liquide avec nicotine, prendre une '
			. yvfb_lien_categorie( 'bases-avec-nicotine' ) . ' ou ajouter des ' . yvfb_lien_categorie( 'boosters-de-nicotine' ) . ' à la place d’une partie de la base.',
		'Fermer le flacon et l’agiter pour mélanger.',
		$repos
			? 'Laisser reposer le mélange ' . $repos . ' (maturation), à l’abri de la lumière et de la chaleur, avant de l’utiliser.'
			: 'Le mélange s’utilise sans temps de repos.',
	);
	$html = '<h3>Comment réaliser son e-liquide avec ' . esc_html( $d['sujet'] ?: $d['nom'] ) . YVFB_NB . '?</h3><ol class="yv-etapes-diy">';
	foreach ( $etapes as $e ) {
		$html .= '<li>' . $e . '</li>';
	}
	$html     .= '</ol>';
	$rendement = yvfb_rendement( $d );
	$html     .= '<p>' . ( $rendement ? 'Un flacon de ' . esc_html( yvfb_ml( $d['contenance'] ) ) . ' permet de préparer jusqu’à ' . $rendement . YVFB_NB . 'ml d’e-liquide à ce dosage. ' : '' )
		. 'Le concentré ne se vapote pas pur.</p>';
	return $html;
}

/** Grand format vendu sans nicotine : ajout de boosters, et taux obtenu avec 1 ou 2 boosters. */
function yvfb_rendu_boosters( array $d ): string {
	$ml = yvfb_nombre( (string) $d['contenance'] );
	if ( 'grand' !== $d['format'] || ! yvfb_sans_nicotine( $d ) || ! $ml ) {
		return '';
	}
	$html = '<h3>Comment ajouter de la nicotine à ' . esc_html( $d['nom_produit'] ) . YVFB_NB . '?</h3><ol class="yv-etapes-boosters">'
		. '<li>Retirer l’embout du flacon.</li>'
		. '<li>Verser un ou deux ' . yvfb_lien_categorie( 'boosters-de-nicotine' ) . ', dans la limite de la place laissée dans le flacon.</li>'
		. '<li>Refermer le flacon et l’agiter pour mélanger.</li></ol>';
	$cas = array();
	foreach ( array( 1, 2 ) as $n ) {
		$v     = $ml + $n * YVFB_BOOSTER_ML;
		$cas[] = $n . ' booster' . ( $n > 1 ? 's' : '' ) . ' donne' . ( $n > 1 ? 'nt' : '' ) . ' ' . yvfb_chiffre( $v ) . YVFB_NB . 'ml à '
			. yvfb_chiffre( round( YVFB_BOOSTER_MG * $n * YVFB_BOOSTER_ML / $v, 1 ) ) . YVFB_NB . 'mg/ml';
	}
	return $html . '<p>Avec des boosters de ' . YVFB_BOOSTER_ML . YVFB_NB . 'ml à ' . YVFB_BOOSTER_MG . YVFB_NB . 'mg/ml' . YVFB_NB . ': ' . yvfb_liste( $cas ) . '. Sans booster, il s’utilise tel quel, sans nicotine.</p>';
}

function yvfb_rendu_injection( array $d ): string {
	$html = '';
	// Concentré : sa description longue (« Ingrédients de … ») dit déjà ce que contient le flacon,
	// c'est-à-dire ses arômes. Le bloc de la recette ferait doublon (choix du 06/11/2026).
	if ( $d['composition'] && 'concentre' !== $d['format'] ) {
		$html .= '<h3>Composition aromatique de ' . esc_html( $d['recette'] ) . '</h3>' . wpautop( wp_kses_post( $d['composition'] ) );
	}
	$diy         = yvfb_rendu_diy( $d );
	$utilisation = $diy ? '' : yvfb_phrase_utilisation( $d );
	$html       .= $diy;
	if ( $utilisation ) {
		$html .= yvfb_rendu_boosters( $d );
		$html .= '<h3>Comment utiliser ' . esc_html( $d['sujet'] ?: $d['nom_produit'] ) . YVFB_NB . '?</h3><p>' . $utilisation . '</p>';
	}
	// Sous-marque d'abord : le bloc décrit Fighter Fuel, puis dit dans quelle marque elle s'inscrit.
	$bloc = $d['bloc_marque'] ?? null;
	if ( $bloc ) {
		$html .= '<h3>La marque ' . esc_html( $bloc['nom'] ) . '</h3>' . wpautop( wp_kses_post( $bloc['texte'] ) );
		$soeurs = array_map( fn( $g ) => yvfb_lien( $g[0], $g[1] ), array_slice( $bloc['soeurs'], 0, 2 ) );
		$html  .= '<p class="yv-gammes">' . esc_html( $bloc['nom'] ) . ' fait partie de ' . yvfb_lien( $bloc['mere'][0], $bloc['mere'][1] );
		if ( $soeurs ) {
			$html .= ', qui regroupe aussi ' . ( count( $bloc['soeurs'] ) > 2 ? implode( ', ', $soeurs ) . ' et d’autres marques' : yvfb_liste( $soeurs ) );
		}
		$html .= '.</p>';
	} elseif ( $d['marque'] ) {
		// L'intertitre n'apparaît que s'il a quelque chose à introduire.
		$contenu = wpautop( wp_kses_post( $d['marque']['texte'] ) );
		$gammes  = $d['marque']['gammes'] ?? array();
		if ( count( $gammes ) > 1 ) {
			$liens    = array_map( fn( $g ) => yvfb_lien( $g[0], $g[1] ), $gammes );
			$contenu .= count( $liens ) >= 3
				? '<p class="yv-gammes">' . esc_html( $d['marque']['nom'] ) . ' regroupe les gammes' . YVFB_NB . ':</p><ul class="yv-gammes"><li>' . implode( '</li><li>', $liens ) . '</li></ul>'
				: '<p class="yv-gammes">' . esc_html( $d['marque']['nom'] ) . ' regroupe les gammes ' . yvfb_liste( $liens ) . '.</p>';
		}
		if ( trim( $contenu ) ) {
			$html .= '<h3>La marque ' . esc_html( $d['marque']['nom'] ) . '</h3>' . $contenu;
		}
	}
	if ( ! empty( $d['pages_marque'] ) ) {
		$liens = array_map( fn( $g ) => yvfb_lien( $g[0], $g[1] ), $d['pages_marque'] );
		$html .= '<p class="yv-pages-marque">Voir aussi' . YVFB_NB . ': ' . yvfb_liste( $liens ) . '.</p>';
	}
	return $html ? '<div class="yv-injection">' . $html . '</div>' : '';
}

/** Questions de la recette, au format des éléments de faq.twig : title (texte) et content (HTML). */
function yvfb_rendu_questions( array $d ): array {
	$nom = esc_html( $d['nom'] );
	// Page à plusieurs goûts : pas d'autres formats de la recette, ses questions à elle.
	if ( ! empty( $d['gouts_noms'] ) ) {
		$q = array();
		if ( yvfb_sans_nicotine( $d ) ) {
			$q[] = array( 'title' => "$nom contient-il de la nicotine" . YVFB_NB . '?', 'content' => '<p>Non, ce liquide est sans nicotine.</p>' );
		}
		$q[] = array(
			'title'   => "Quels goûts propose $nom" . YVFB_NB . '?',
			'content' => '<p>' . count( $d['gouts_noms'] ) . ' goûts au choix' . YVFB_NB . ': ' . esc_html( yvfb_liste( $d['gouts_noms'] ) ) . '.</p>',
		);
		$usage = yvfb_phrase_utilisation( $d );
		if ( $usage ) {
			$q[] = array( 'title' => "Avec quel matériel utiliser $nom" . YVFB_NB . '?', 'content' => '<p>' . $usage . '</p>' );
		}
		if ( $d['gouts'] ) {
			$q[] = array(
				'title'   => "Les goûts de $nom existent-ils dans d’autres formats" . YVFB_NB . '?',
				'content' => '<p>Oui, ' . count( $d['gouts'] ) . ' d’entre eux, en sel de nicotine ou en grand format' . YVFB_NB . ': ils sont listés dans la description.</p>',
			);
		}
		return $q;
	}
	$par = array();
	foreach ( $d['formats'] as $f ) {
		$par[ $f['format'] ] = $par[ $f['format'] ] ?? $f;
	}
	$q = array();
	$sans_nic = array();
	foreach ( array( 'flacon', 'grand' ) as $type ) {
		if ( isset( $par[ $type ] ) && yvfb_sans_nicotine( $par[ $type ] ) ) {
			$sans_nic[] = 'en ' . yvfb_lien( $par[ $type ]['contenance'] ? 'flacon de ' . yvfb_ml( $par[ $type ]['contenance'] ) : 'grand format', $par[ $type ]['url'] );
		}
	}
	if ( $d['taux'] && ! yvfb_sans_nicotine( $d ) && $sans_nic ) {
		$q[] = array(
			'title'   => "$nom existe-t-il sans nicotine" . YVFB_NB . '?',
			// Seul un grand format a la place d'un booster : un flacon de 10 ml est plein.
			'content' => '<p>Oui, ' . yvfb_liste( $sans_nic ) . '.' . ( isset( $par['grand'] ) && yvfb_sans_nicotine( $par['grand'] ) ? ' Dans le grand format, de la nicotine peut être ajoutée avec des boosters.' : '' ) . '</p>',
		);
	}
	if ( yvfb_sans_nicotine( $d ) && isset( $par['flacon'] ) && $par['flacon']['taux'] && ! yvfb_sans_nicotine( $par['flacon'] ) ) {
		$f   = $par['flacon'];
		$q[] = array(
			'title'   => "$nom existe-t-il avec nicotine" . YVFB_NB . '?',
			'content' => '<p>Oui, en ' . yvfb_lien( $f['contenance'] ? 'flacon de ' . yvfb_ml( $f['contenance'] ) : 'flacon', $f['url'] ) . ', avec plusieurs taux de nicotine au choix.</p>',
		);
	}
	if ( 'sel' !== $d['format'] && isset( $par['sel'] ) ) {
		$f   = $par['sel'];
		$q[] = array(
			'title'   => "$nom existe-t-il en sel de nicotine" . YVFB_NB . '?',
			'content' => '<p>Oui' . YVFB_NB . ': ' . yvfb_lien( $f['nom'], $f['url'] ) . ' est proposé'
				. ( $f['contenance'] ? ' en flacon de ' . esc_html( yvfb_ml( $f['contenance'] ) ) : '' )
				. '.</p>',
		);
	}
		// Un modèle par ligne : ses versions avec et sans nicotine ne font qu'un (« Puff Fighter X 32K »).
	$modeles = array();
	foreach ( $d['formats'] as $f ) {
		if ( 'puff' === $f['format'] ) {
			$modeles[ $f['nom'] ][ yvfb_sans_nicotine( $f ) ? 'sans' : 'avec' ] = $f['url'];
		}
	}
	$puffs = array();
	foreach ( $modeles as $modele => $v ) {
		$puffs[] = yvfb_lien( $modele, $v['avec'] ?? $v['sans'] )
			. ( isset( $v['avec'], $v['sans'] ) ? ' (avec ou sans nicotine)' : ( isset( $v['sans'] ) ? ' (sans nicotine)' : '' ) );
	}
	if ( $puffs ) {
		// Réponse courte : le balisage FAQ de Google ignore les tableaux, et le tableau complet est dans la description.
		$reste = count( $puffs ) - 2;
		$q[]   = array(
			'title'   => "$nom existe-t-il en puff" . YVFB_NB . '?',
			'content' => '<p>Oui, au goût ' . esc_html( $d['recette'] ) . YVFB_NB . ': '
				. ( $reste > 0
					? implode( ', ', array_slice( $puffs, 0, 2 ) ) . ' et ' . $reste . ( $reste > 1 ? ' autres modèles, listés' : ' autre modèle, listé' ) . ' dans la description'
					: yvfb_liste( $puffs ) ) . '.</p>',
		);
	}
	if ( 'concentre' === $d['format'] && $d['dosage'] ) {
		$v     = yvfb_volume_exemple( $d );
		$repos = yvfb_maturation_texte( (string) $d['maturation'] );
		$q[]   = array(
			'title'   => 'Quel dosage pour ' . esc_html( $d['sujet'] ?: $d['nom'] ) . YVFB_NB . '?',
			'content' => '<p>' . yvfb_chiffre( $d['dosage'] ) . YVFB_NB . '% du volume final, soit ' . yvfb_chiffre( $v * $d['dosage'] / 100 ) . YVFB_NB . 'ml de concentré pour '
				. $v . YVFB_NB . 'ml d’e-liquide' . ( $repos ? ', puis ' . $repos . ' de maturation avant utilisation.' : ', sans temps de repos.' ) . '</p>',
		);
		$rendement = yvfb_rendement( $d );
		if ( $rendement && $d['contenance'] ) {
			$q[] = array(
				'title'   => 'Combien d’e-liquide peut-on préparer avec un flacon de ' . esc_html( yvfb_ml( $d['contenance'] ) ) . YVFB_NB . '?',
				'content' => '<p>Jusqu’à ' . $rendement . YVFB_NB . 'ml, au dosage conseillé de ' . yvfb_chiffre( $d['dosage'] ) . YVFB_NB . '%.</p>',
			);
		}
	}
	if ( 'concentre' !== $d['format'] && isset( $par['concentre'] ) ) {
		$f = $par['concentre'];
		$r = 'Oui, avec le ' . yvfb_lien( 'concentré ' . $d['recette'] . ( $f['contenance'] ? ' ' . yvfb_ml( $f['contenance'] ) : '' ), $f['url'] ) . '.';
		if ( $f['dosage'] ) {
			$r .= ' Il se dose à ' . yvfb_chiffre( $f['dosage'] ) . YVFB_NB . '% dans une base';
			if ( '' === $f['maturation'] ) {
				$r .= '.';
			} elseif ( preg_match( '/instantan/iu', $f['maturation'] ) ) {
				$r .= ', sans temps de repos.';
			} else {
				$r .= ', puis le mélange doit reposer ' . esc_html( $f['maturation'] ) . ' avant utilisation.';
			}
		}
		$q[] = array( 'title' => "Peut-on préparer $nom soi-même" . YVFB_NB . '?', 'content' => '<p>' . $r . '</p>' );
	}
	return $q;
}

/* ------------------------------------------------------------------ *
 * Fonctions appelées par les gabarits Twig (fn('…', post.id))
 * ------------------------------------------------------------------ */

function yvfb_points_cles_html( $produit ): string {
	$p = yvfb_produit( $produit );
	return $p ? yvfb_rendu_points_cles( yvfb_donnees_cache( $p ) ) : '';
}

function yvfb_avant_description_html( $produit ): string {
	$p = yvfb_produit( $produit );
	return $p ? yvfb_rendu_presentation( yvfb_donnees_cache( $p ) ) : '';
}

function yvfb_apres_description_html( $produit ): string {
	$p = yvfb_produit( $produit );
	return $p && yvfb_injection_active( $p ) ? yvfb_rendu_injection( yvfb_donnees_cache( $p ) ) : '';
}

function yvfb_questions( $produit ): array {
	$p = yvfb_produit( $produit );
	return $p && yvfb_injection_active( $p ) ? yvfb_rendu_questions( yvfb_donnees_cache( $p ) ) : array();
}

/* ------------------------------------------------------------------ *
 * Recettes et textes saisis une fois
 * ------------------------------------------------------------------ */

// Le cache des listes ne se périme que sur ce qui les change : pas à chaque mise à jour de stock.
add_action( 'transition_post_status', function ( $nouveau, $ancien, $post ) {
	if ( $nouveau !== $ancien && in_array( $post->post_type, array( 'product', 'product_variation' ), true ) ) {
		yvfb_invalider();
	}
}, 10, 3 );
add_action( 'post_updated', function ( $id, $apres, $avant ) {
	if ( 'product' === $apres->post_type && $apres->post_title !== $avant->post_title ) {
		yvfb_invalider();
	}
}, 10, 3 );
add_action( 'deleted_post', function ( $id, $post = null ) {
	if ( $post && in_array( $post->post_type, array( 'product', 'product_variation' ), true ) ) {
		yvfb_invalider();
	}
}, 10, 2 );
add_action( 'set_object_terms', function ( $id, $termes, $apres, $tax, $ajout, $avant ) {
	// WordPress donne les nouveaux identifiants en chaînes et les anciens en entiers.
	$apres = array_map( 'intval', (array) $apres );
	$avant = array_map( 'intval', (array) $avant );
	sort( $apres );
	sort( $avant );
	if ( in_array( $tax, array( YVFB_TAX_RECETTE, YVFB_TAX_MARQUE, 'product_cat', 'pa_gout' ), true ) && $apres !== $avant ) {
		yvfb_invalider();
	}
}, 10, 6 );
add_action( 'edited_term', function ( $id, $tt, $tax ) {
	if ( in_array( $tax, array( YVFB_TAX_RECETTE, YVFB_TAX_MARQUE, 'product_cat', 'pa_gout' ), true ) ) {
		yvfb_invalider();
	}
}, 10, 3 );
foreach ( array( 'added_post_meta', 'updated_post_meta' ) as $yvfb_action ) {
	add_action( $yvfb_action, function ( $meta, $id, $cle ) {
		if ( 'attribute_pa_gout' === $cle ) {
			yvfb_invalider();
		}
	}, 10, 3 );
}

// Arrivée depuis un lien « #gout=… » : le goût est présélectionné sans passer par une adresse en noindex.
add_action( 'wp_footer', function () {
	if ( ! function_exists( 'is_product' ) || ! is_product() ) {
		return;
	}
	?>
	<script>
	(function ($) {
		var m = location.hash.match(/^#gout=([\w%-]+)$/);
		if (!m || !$) { return; }
		var v = decodeURIComponent(m[1]);
		function appliquer() {
			var s = $('select[name="attribute_pa_gout"]');
			if (s.length && s.val() !== v && s.find('option').filter(function () { return this.value === v; }).length) {
				s.val(v).trigger('change');
			}
		}
		// Selon le chargement différé des scripts, le formulaire peut être prêt avant ou après celui-ci.
		$(appliquer);
		$(document).on('wc_variation_form', '.variations_form', appliquer);
	})(window.jQuery);
	</script>
	<?php
}, 100 ); // Après l'impression des scripts du pied de page (priorité 20) : jQuery y est peut-être.

add_action( 'init', function () {
	register_taxonomy( YVFB_TAX_RECETTE, 'product', array(
		'label'             => 'Recettes',
		'public'            => false,
		'show_ui'           => true,
		'show_admin_column' => true,
		'hierarchical'      => false,
		'rewrite'           => false,
	) );
} );

foreach ( array(
	YVFB_TAX_RECETTE => array( YVFB_META_COMPOSITION, 'Composition aromatique (20 à 60 mots, arômes et additifs seulement, sans adjectif ni ressenti)' ),
	YVFB_TAX_MARQUE  => array( YVFB_META_MARQUE, 'Texte de la marque (30 à 60 mots, faits seulement : pays, activité, gammes)' ),
) as $yvfb_tax => list( $yvfb_cle, $yvfb_label ) ) {
	add_action( "{$yvfb_tax}_edit_form_fields", function ( $term ) use ( $yvfb_cle, $yvfb_label ) {
		printf(
			'<tr class="form-field"><th scope="row"><label for="%1$s">%2$s</label></th><td><textarea name="%1$s" id="%1$s" rows="6">%3$s</textarea></td></tr>',
			esc_attr( $yvfb_cle ),
			esc_html( $yvfb_label ),
			esc_textarea( (string) get_term_meta( $term->term_id, $yvfb_cle, true ) )
		);
	} );
	add_action( "edited_{$yvfb_tax}", function ( $term_id ) use ( $yvfb_cle ) {
		if ( isset( $_POST[ $yvfb_cle ] ) && current_user_can( 'edit_term', $term_id ) ) {
			update_term_meta( $term_id, $yvfb_cle, wp_kses_post( wp_unslash( $_POST[ $yvfb_cle ] ) ) );
		}
	} );
}
