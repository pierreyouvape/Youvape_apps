<?php
/**
 * Plugin Name: YouVape – rédaction des fiches produits
 * Description: Encadré « Module création fiche produit » sur la fiche produit : propose title et méta Yoast, H1, composition aromatique (par recette) et texte de marque. Rien n'est appliqué sans clic, rien n'est publié.
 * Version:     0.1.0
 *
 * À placer dans wp-content/mu-plugins/. Deux réglages dans wp-config.php :
 *   define( 'YV_FICHE_REDACTION_URL', 'https://…' );   // adresse de l'application YouVape
 *   define( 'YV_FICHE_REDACTION_SECRET', '…' );        // secret fourni par YouVape
 * Sans eux, l'encadré s'affiche avec un message et le bouton est désactivé.
 *
 * « Composition aromatique » et « La marque » sont lus par l'extension yv-fiche-blocs
 * (taxonomie yv_recette, métas yv_composition et yv_texte_marque). Sans elle, ces deux
 * champs restent affichés mais ne peuvent pas être appliqués.
 */

defined( 'ABSPATH' ) || exit;

const YVFR_META_JOB   = '_yvfr_job';
const YVFR_TAX_RECIPE = 'yv_recette';
const YVFR_TAX_BRAND  = 'pwb-brand';
const YVFR_META_COMPO = 'yv_composition';
const YVFR_META_BRAND = 'yv_texte_marque';

function yvfr_config(): ?array {
	if ( ! defined( 'YV_FICHE_REDACTION_URL' ) || ! defined( 'YV_FICHE_REDACTION_SECRET' ) || ! YV_FICHE_REDACTION_SECRET ) {
		return null;
	}
	return array( 'url' => untrailingslashit( YV_FICHE_REDACTION_URL ), 'secret' => YV_FICHE_REDACTION_SECRET );
}

/** Appel à l'application (serveur à serveur, le secret ne passe jamais par le navigateur). */
function yvfr_api( string $method, string $path, ?array $body = null ) {
	$cfg = yvfr_config();
	if ( ! $cfg ) {
		return new WP_Error( 'yvfr_config', 'Module non configuré (wp-config.php).' );
	}
	$res = wp_remote_request( $cfg['url'] . '/api/product-writer' . $path, array(
		'method'  => $method,
		'timeout' => 20,
		'headers' => array(
			'x-yv-writer-secret' => $cfg['secret'],
			'x-yv-site'          => (string) wp_parse_url( home_url(), PHP_URL_HOST ),
			'Content-Type'       => 'application/json',
		),
		'body'    => null === $body ? null : wp_json_encode( $body ),
	) );
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = (int) wp_remote_retrieve_response_code( $res );
	$data = json_decode( wp_remote_retrieve_body( $res ), true );
	// Un 200 qui n'est pas du JSON (page de pare-feu) n'est pas une réponse.
	if ( ! is_array( $data ) ) {
		return new WP_Error( 'yvfr_http', 'Réponse inattendue de l\'application (HTTP ' . $code . ').' );
	}
	if ( $code >= 400 ) {
		return new WP_Error( 'yvfr_http', $data['error'] ?? ( 'Erreur HTTP ' . $code ) );
	}
	return $data;
}

/* ------------------------------------------------------------------ *
 * Fiche envoyée à l'application (brouillon compris)
 * ------------------------------------------------------------------ */

function yvfr_brand_chain( int $product_id ): array {
	$terms = wc_get_product_terms( $product_id, YVFR_TAX_BRAND, array( 'fields' => 'all' ) );
	if ( is_wp_error( $terms ) || ! $terms ) {
		return array();
	}
	$term  = $terms[0];
	$chain = array( $term );
	while ( $term->parent ) {
		$parent = get_term( $term->parent, YVFR_TAX_BRAND );
		if ( ! $parent instanceof WP_Term ) {
			break;
		}
		array_unshift( $chain, $parent );
		$term = $parent;
	}
	return $chain;
}

function yvfr_term_link( WP_Term $t ): string {
	$link = get_term_link( $t );
	return is_wp_error( $link ) ? '' : $link;
}

/** Goûts vendus en déclinaison sur cette page (« JNR Sans Nicotine 10ml ») : le module la traite alors sans recette. */
function yvfr_gouts( WC_Product $p ): array {
	if ( ! $p->is_type( 'variable' ) ) {
		return array();
	}
	$attr = $p->get_attributes()['pa_gout'] ?? null;
	if ( ! $attr || ! $attr->get_variation() ) {
		return array();
	}
	$noms = wc_get_product_terms( $p->get_id(), 'pa_gout', array( 'fields' => 'names' ) );
	return is_wp_error( $noms ) ? array() : array_values( array_map( 'strval', $noms ) );
}

function yvfr_payload( WC_Product $p ): array {
	$attributes = array();
	foreach ( $p->get_attributes() as $attr ) {
		$values = $attr->is_taxonomy()
			? wc_get_product_terms( $p->get_id(), $attr->get_name(), array( 'fields' => 'names' ) )
			: $attr->get_options();
		if ( ! is_wp_error( $values ) && $values ) {
			$attributes[ wc_attribute_label( $attr->get_name(), $p ) ] = array_values( array_map( 'strval', $values ) );
		}
	}
	$chain = yvfr_brand_chain( $p->get_id() );
	$brand = null;
	if ( $chain ) {
		$root  = $chain[0];
		$last  = end( $chain );
		$brand = array(
			'id'          => $root->term_id,
			'name'        => $root->name,
			'link'        => yvfr_term_link( $root ),
			'description' => wp_strip_all_tags( term_description( $root->term_id, YVFR_TAX_BRAND ) ),
			'range'       => $last->term_id !== $root->term_id ? array( 'id' => $last->term_id, 'name' => $last->name, 'link' => yvfr_term_link( $last ) ) : null,
		);
	}
	$recipe = null;
	if ( taxonomy_exists( YVFR_TAX_RECIPE ) ) {
		$names  = wc_get_product_terms( $p->get_id(), YVFR_TAX_RECIPE, array( 'fields' => 'names' ) );
		$recipe = ! is_wp_error( $names ) && $names ? $names[0] : null;
	}
	$cats = wc_get_product_terms( $p->get_id(), 'product_cat', array( 'fields' => 'slugs' ) );
	return array(
		'id'                => $p->get_id(),
		'name'              => $p->get_name(),
		'permalink'         => 'publish' === $p->get_status() ? get_permalink( $p->get_id() ) : null,
		'status'            => $p->get_status(),
		'categories'        => is_wp_error( $cats ) ? array() : array_values( $cats ),
		'attributes'        => $attributes,
		'short_description' => $p->get_short_description(),
		'description'       => $p->get_description(),
		'brand'             => $brand,
		'recette'           => $recipe,
		'gouts'             => yvfr_gouts( $p ),
	);
}

/* ------------------------------------------------------------------ *
 * Encadré de la fiche produit
 * ------------------------------------------------------------------ */

add_action( 'add_meta_boxes_product', function () {
	add_meta_box( 'yvfr', 'Module création fiche produit', 'yvfr_render_box', 'product', 'normal', 'high' );
} );

function yvfr_render_box( WP_Post $post ): void {
	if ( 'auto-draft' === $post->post_status ) {
		echo '<p>Enregistrez d\'abord le brouillon (nom, marque, catégorie, attributs), puis revenez ici.</p>';
		return;
	}
	$configured = (bool) yvfr_config();
	$brand_ok   = taxonomy_exists( YVFR_TAX_BRAND );
	$recipe_ok  = taxonomy_exists( YVFR_TAX_RECIPE );
	$data       = array(
		'ajax'      => admin_url( 'admin-ajax.php' ),
		'nonce'     => wp_create_nonce( 'yvfr_' . $post->ID ),
		'post'      => $post->ID,
		'job'       => (int) get_post_meta( $post->ID, YVFR_META_JOB, true ),
		'canRecipe' => $recipe_ok && current_user_can( 'manage_product_terms' ),
		'canBrand'  => $brand_ok && current_user_can( 'manage_product_terms' ),
	);
	?>
	<div id="yvfr-root">
		<p class="yvfr-intro">
			Propose le title et la méta Yoast, le H1, la composition aromatique et le texte de la marque, à partir du nom, de la marque,
			des attributs, de la Search Console, de Google Ads et des fiches concurrentes. Rien n'est appliqué sans clic sur « Appliquer ».
			Comptez 2 à 3 minutes.
		</p>
		<?php if ( ! $configured ) : ?>
			<p class="yvfr-warn">Module non configuré : réglages YV_FICHE_REDACTION_URL et YV_FICHE_REDACTION_SECRET absents de wp-config.php.</p>
		<?php endif; ?>
		<p><button type="button" class="button button-primary" id="yvfr-start" <?php disabled( ! $configured ); ?>>Générer le contenu</button>
			<span id="yvfr-status" class="yvfr-status"></span></p>
		<div id="yvfr-result"></div>
	</div>
	<style>
		#yvfr-root .yvfr-intro{color:#50575e;max-width:900px}
		#yvfr-root .yvfr-warn{color:#b32d2e;font-weight:600}
		#yvfr-root .yvfr-status{margin-left:8px;color:#50575e}
		#yvfr-root .yvfr-field{border:1px solid #dcdcde;border-radius:4px;padding:10px 12px;margin:10px 0;max-width:900px}
		#yvfr-root .yvfr-field h4{margin:0 0 6px;display:flex;justify-content:space-between;gap:8px}
		#yvfr-root .yvfr-field h4 small{font-weight:400;color:#646970}
		#yvfr-root .yvfr-field textarea{width:100%;font-size:13px}
		#yvfr-root .yvfr-cur{color:#646970;font-size:12px;margin:4px 0}
		#yvfr-root .yvfr-row{display:flex;gap:8px;align-items:center;margin-top:6px}
		#yvfr-root .yvfr-done{color:#00a32a}
		#yvfr-root .yvfr-err{color:#b32d2e}
		#yvfr-root details{margin:10px 0;max-width:900px}
		#yvfr-root ul{margin:4px 0 4px 18px;list-style:disc}
		#yvfr-root .yvfr-bad{color:#b32d2e}
		#yvfr-root .yvfr-ok{color:#008a20}
		#yvfr-root .yvfr-links li{margin-bottom:8px}
		#yvfr-root code{user-select:all}
		#yvfr-root .yvfr-tag{display:inline-block;background:#f0f0f1;border-radius:3px;padding:1px 6px;margin:2px 4px 2px 0}
	</style>
	<script>
	(function () {
		const D = <?php echo wp_json_encode( $data ); ?>;
		const $ = (id) => document.getElementById(id);
		const STEPS = { dossier: 'lecture de la fiche et des autres formats', 'search console': 'Search Console', 'google ads': 'Google Ads', concurrents: 'fiches concurrentes', 'rédaction': 'rédaction', 'contrôles': 'contrôles', maillage: 'maillage interne' };
		let timer = null;

		const el = (tag, attrs, ...children) => {
			const n = document.createElement(tag);
			Object.entries(attrs || {}).forEach(([k, v]) => { if (v == null) return; if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); });
			children.flat().forEach((c) => n.append(c && c.nodeType ? c : document.createTextNode(c == null ? '' : String(c))));
			return n;
		};
		const post = async (action, extra) => {
			const body = new URLSearchParams({ action, nonce: D.nonce, post: D.post, ...(extra || {}) });
			const r = await fetch(D.ajax, { method: 'POST', credentials: 'same-origin', body });
			const j = await r.json().catch(() => null);
			if (!j || !j.success) throw new Error((j && j.data) || 'Erreur ' + r.status);
			return j.data;
		};
		const setStatus = (t, cls) => { const s = $('yvfr-status'); s.textContent = t; s.className = 'yvfr-status ' + (cls || ''); };

		const poll = async () => {
			clearTimeout(timer);
			try {
				const job = await post('yvfr_status');
				if (!job) return;
				if (job.status === 'queued') { setStatus('En attente' + (job.ahead ? ' (' + job.ahead + ' fiche(s) avant)' : '') + '…'); timer = setTimeout(poll, 4000); return; }
				if (job.status === 'running') { setStatus('En cours : ' + (STEPS[job.step] || job.step || '…')); timer = setTimeout(poll, 4000); return; }
				$('yvfr-start').disabled = false;
				if (job.status === 'error') { setStatus('Échec : ' + job.error, 'yvfr-err'); return; }
				setStatus('Proposition du ' + new Date(job.finished_at).toLocaleString('fr-FR') + (job.cost_usd != null ? ' · coût ' + job.cost_usd.toFixed(2) + ' $' : ''));
				$('yvfr-start').textContent = 'Relancer';
				render(job);
			} catch (e) { setStatus(e.message, 'yvfr-err'); $('yvfr-start').disabled = false; }
		};

		const counter = (ta, unit) => {
			const c = el('small');
			const upd = () => { c.textContent = unit === 'mots' ? ta.value.trim().split(/\s+/).filter(Boolean).length + ' mots' : ta.value.length + ' caractères'; };
			ta.addEventListener('input', upd); upd();
			return c;
		};

		const field = (key, label, value, opts) => {
			const ta = el('textarea', { rows: opts.rows || 2 });
			ta.value = value || '';
			const out = el('span');
			const btn = el('button', { type: 'button', class: 'button', onclick: async () => {
				if (opts.confirm && !window.confirm(opts.confirm)) return;
				btn.disabled = true; out.textContent = 'Application…'; out.className = '';
				try {
					const r = await post('yvfr_apply', { field: key, value: ta.value });
					out.textContent = r.message; out.className = 'yvfr-done';
					if (r.reload) { out.textContent += ' Rechargement…'; setTimeout(() => location.reload(), 900); }
				} catch (e) { out.textContent = e.message; out.className = 'yvfr-err'; btn.disabled = false; }
			} }, 'Appliquer');
			if (opts.disabled) { btn.disabled = true; out.textContent = opts.disabled; }
			return el('div', { class: 'yvfr-field' },
				el('h4', {}, label, counter(ta, opts.unit)),
				opts.help ? el('div', { class: 'yvfr-cur' }, opts.help) : '',
				ta,
				el('div', { class: 'yvfr-row' }, btn, out));
		};

		const list = (items, fmt) => el('ul', {}, (items || []).map((i) => el('li', {}, fmt ? fmt(i) : i)));

		const render = (job) => {
			const d = job.draft || {};
			const root = $('yvfr-result');
			root.textContent = '';
			const unsaved = 'Les modifications non enregistrées de la fiche seront perdues au rechargement. Continuer ?';
			const formats = (job.formats || []).map((f) => f.name).join(', ');
			root.append(
				el('p', {}, el('strong', {}, 'Requête principale : '), d.requete_principale || '—'),
				el('p', {}, el('strong', {}, 'Secondaires : '), (d.requetes_secondaires || []).map((q) => el('span', { class: 'yvfr-tag' }, q))),
				field('title', 'Title Yoast', d.title, { help: 'Remplace le title Yoast de cette fiche.', confirm: unsaved }),
				field('meta', 'Méta-description Yoast', d.meta, { rows: 3, help: 'Remplace la méta-description Yoast de cette fiche.', confirm: unsaved }),
				field('h1', 'H1 (nom du produit)', d.h1, { help: 'Remplace le nom du produit. Sur le site, le thème ajoute « Eliquide » devant et la marque derrière. L\'adresse de la fiche ne change pas.', confirm: 'Le nom du produit va changer. ' + unsaved }),
				field('presentation', 'Description courte (présentation)', d.presentation, { rows: 5, unit: 'mots', help: 'Remplace la description courte : premier texte de « La Description du Produit ».', confirm: unsaved }),
				field('description', 'Description longue (ingrédients)', d.description, { rows: 3, unit: 'mots', help: 'Remplace la description longue. Au-delà de 150 mots, les blocs automatiques ne s\'affichent plus.', confirm: unsaved }),
				job.multi_gouts ? el('p', { class: 'yvfr-cur' }, 'Page à plusieurs goûts : pas de composition à saisir, le site affiche le tableau des goûts.') : field('composition', 'Composition aromatique (toute la recette « ' + (job.recipe || '') + ' »)', d.composition_aromatique, {
					rows: 3, unit: 'mots',
					help: 'Saisie une fois pour la recette, affichée sur chaque format' + (formats ? ' : cette fiche et ' + formats : '') + '.',
					disabled: D.canRecipe ? '' : 'Extension yv-fiche-blocs absente ou droits insuffisants.',
					confirm: 'La composition sera enregistrée sur la recette et la recette attachée à cette fiche' + (formats ? ' et à : ' + formats : '') + '. Continuer ?',
				}),
				field('marque', 'La marque ' + (job.brand || ''), d.texte_marque, {
					rows: 3, unit: 'mots',
					help: 'Saisi une fois pour la marque, affiché sur toutes ses fiches.',
					disabled: D.canBrand ? '' : 'Marque absente ou droits insuffisants.',
					confirm: 'Ce texte remplacera celui de la marque ' + (job.brand || '') + ' sur toutes ses fiches. Continuer ?',
				}),
			);
			const bad = (job.facts || []).filter((f) => f.statut !== 'sourcé');
			if ((job.checks || []).length || bad.length) {
				root.append(el('div', { class: 'yvfr-field' }, el('h4', {}, 'Contrôles à regarder'),
					list(job.checks, (c) => el('span', { class: 'yvfr-bad' }, c.champ + ' : ' + c.message + ' (' + c.gravite + ')')),
					list(bad, (f) => el('span', { class: 'yvfr-bad' }, f.champ + ' : « ' + f.affirmation + ' » — ' + f.statut + ' (' + f.source + ')'))));
			}
			const lk = job.links;
			if (lk && (lk.liens || []).length) {
				const ETAT = {
					a_faire: ['À faire', 'yvfr-bad'],
					autre_ancre: ['Lien présent, autre texte', ''],
					fait: ['Fait', 'yvfr-ok'],
					non_verifie: ['Page illisible, à vérifier', ''],
					apres_publication: ['Après publication', ''],
				};
				const todo = lk.liens.filter((l) => l.etat !== 'fait').length;
				root.append(el('details', { open: todo ? '' : null },
					el('summary', {}, 'Maillage interne (' + todo + ' lien(s) à poser)'),
					lk.liens.length ? el('p', {}, 'Ajouter dans le texte de chaque page un lien vers cette fiche, avec le texte « ', el('strong', {}, lk.ancre), ' » :',
						lk.html ? el('br') : '', lk.html ? el('code', {}, lk.html) : '') : el('p', {}, 'Aucun lien à poser à la main.'),
					el('ul', { class: 'yvfr-links' }, lk.liens.filter((l) => /^\/(?!\/)/.test(l.chemin || '')).map((l) => {
						const [txt, cls] = ETAT[l.etat] || [l.etat, ''];
						return el('li', {},
							el('span', { class: cls }, '[' + txt + '] '),
							el('strong', {}, l.type + ' ' + l.titre), ' — ',
							el('a', { href: l.chemin + '/', target: '_blank', rel: 'noopener' }, l.chemin),
							' · à poser dans : ' + l.ou,
							/^\/wp-admin\//.test(l.modifier || '') ? el('span', {}, ' · ', el('a', { href: l.modifier, target: '_blank', rel: 'noopener' }, 'modifier')) : '',
														(l.ancres_existantes || []).length ? el('div', { class: 'yvfr-cur' }, 'Liens existants : ' + l.ancres_existantes.join(', ')) : '');
					})),
					(lk.deja_lies || []).length ? el('p', { class: 'yvfr-cur' }, 'Déjà listée dans la grille de : ' + lk.deja_lies.join(', ') + '.') : '',
					(lk.automatique || []).length ? el('p', { class: 'yvfr-cur' }, 'Les autres formats (' + lk.automatique.length + ') sont reliés automatiquement : le lien disparaît si la saveur est dépubliée.') : ''));
			}
			root.append(
				el('details', { open: '' }, el('summary', {}, 'Points à vérifier (' + (d.points_a_verifier || []).length + ')'), list(d.points_a_verifier)),
				el('details', {}, el('summary', {}, 'Analyse des mots-clés'), el('p', {}, d.analyse || ''),
					el('p', {}, el('strong', {}, 'Laissées à d\'autres pages')), list(d.requetes_laissees, (q) => q.requete + ' → ' + q.page + ' : ' + q.raison),
					el('p', {}, el('strong', {}, 'Écartées')), list(d.requetes_ecartees, (q) => q.requete + ' : ' + q.raison)),
				el('details', {}, el('summary', {}, 'Fiches concurrentes lues'), list(job.competitors, (c) => c.site + ' — ' + c.title)),
			);
		};

		$('yvfr-start').addEventListener('click', async () => {
			$('yvfr-start').disabled = true;
			setStatus('Envoi…');
			try { await post('yvfr_start'); poll(); } catch (e) { setStatus(e.message, 'yvfr-err'); $('yvfr-start').disabled = false; }
		});
		if (D.job) { $('yvfr-start').disabled = true; poll(); }
	})();
	</script>
	<?php
}

/* ------------------------------------------------------------------ *
 * Actions AJAX (admin connecté, nonce par fiche)
 * ------------------------------------------------------------------ */

function yvfr_check(): int {
	$post_id = isset( $_POST['post'] ) ? absint( $_POST['post'] ) : 0;
	if ( ! $post_id || ! check_ajax_referer( 'yvfr_' . $post_id, 'nonce', false ) ) {
		wp_send_json_error( 'Session expirée, rechargez la page.', 403 );
	}
	if ( ! current_user_can( 'edit_post', $post_id ) || 'product' !== get_post_type( $post_id ) ) {
		wp_send_json_error( 'Droits insuffisants.', 403 );
	}
	return $post_id;
}

add_action( 'wp_ajax_yvfr_start', function () {
	$post_id = yvfr_check();
	$product = wc_get_product( $post_id );
	if ( ! $product ) {
		wp_send_json_error( 'Produit introuvable.' );
	}
	$res = yvfr_api( 'POST', '/jobs', array(
		'product'      => yvfr_payload( $product ),
		'requested_by' => wp_get_current_user()->user_login,
	) );
	if ( is_wp_error( $res ) ) {
		wp_send_json_error( $res->get_error_message() );
	}
	update_post_meta( $post_id, YVFR_META_JOB, (int) $res['id'] );
	wp_send_json_success( array( 'id' => (int) $res['id'] ) );
} );

add_action( 'wp_ajax_yvfr_status', function () {
	$post_id = yvfr_check();
	$job_id  = (int) get_post_meta( $post_id, YVFR_META_JOB, true );
	if ( ! $job_id ) {
		wp_send_json_success( null );
	}
	$res = yvfr_api( 'GET', '/jobs/' . $job_id );
	if ( is_wp_error( $res ) ) {
		wp_send_json_error( $res->get_error_message() );
	}
	// La demande doit porter sur cette fiche (le numéro vient de la méta, jamais du navigateur).
	if ( (int) ( $res['product_id'] ?? 0 ) !== $post_id ) {
		wp_send_json_error( 'Demande sans rapport avec cette fiche.' );
	}
	wp_send_json_success( $res );
} );

add_action( 'wp_ajax_yvfr_apply', function () {
	$post_id = yvfr_check();
	$field   = isset( $_POST['field'] ) ? sanitize_key( wp_unslash( $_POST['field'] ) ) : '';
	$raw     = isset( $_POST['value'] ) ? (string) wp_unslash( $_POST['value'] ) : '';
	$text    = trim( sanitize_text_field( $raw ) );
	if ( '' === $text ) {
		wp_send_json_error( 'Texte vide.' );
	}

	switch ( $field ) {
		case 'title':
			update_post_meta( $post_id, '_yoast_wpseo_title', $text );
			wp_send_json_success( array( 'message' => 'Title Yoast enregistré.', 'reload' => true ) );
			break;

		case 'meta':
			update_post_meta( $post_id, '_yoast_wpseo_metadesc', $text );
			wp_send_json_success( array( 'message' => 'Méta-description enregistrée.', 'reload' => true ) );
			break;

		case 'h1':
			$r = wp_update_post( array( 'ID' => $post_id, 'post_title' => $text ), true );
			if ( is_wp_error( $r ) ) {
				wp_send_json_error( $r->get_error_message() );
			}
			wp_send_json_success( array( 'message' => 'Nom du produit enregistré.', 'reload' => true ) );
			break;

		case 'presentation':
		case 'description':
			// Paragraphes conservés (sanitize_text_field les écrase). Le texte remplacé est gardé
			// dans une méta : les produits n'ont pas de révisions.
			$colonne = 'presentation' === $field ? 'post_excerpt' : 'post_content';
			$html    = wpautop( esc_html( trim( sanitize_textarea_field( $raw ) ) ) );
			if ( 'description' === $field ) {
				// Intertitre comme les blocs suivants (« Composition aromatique de … ») : nom de la recette
				// donné par yv-fiche-blocs, sinon le nom du produit.
				$produit = function_exists( 'yvfb_produit' ) ? yvfb_produit( $post_id ) : null;
				if ( $produit && function_exists( 'yvfb_est_multi' ) && yvfb_est_multi( $produit ) ) {
					$recette = yvfb_nom_multi( $produit );
				} else {
					$recette = $produit && function_exists( 'yvfb_nom_sans_marque_mere' )
						? yvfb_recette_affiche( yvfb_nom_sans_marque_mere( $produit ), yvfb_nom_marque( $produit ) )
						: get_the_title( $post_id );
				}
				$html = '<h3>Ingrédients de ' . esc_html( $recette ) . '</h3>' . $html;
			}
			update_post_meta( $post_id, '_yvfr_avant_' . $field, get_post_field( $colonne, $post_id, 'raw' ) );
			$r = wp_update_post( array( 'ID' => $post_id, $colonne => $html ), true );
			if ( is_wp_error( $r ) ) {
				wp_send_json_error( $r->get_error_message() );
			}
			wp_send_json_success( array( 'message' => ( 'presentation' === $field ? 'Description courte' : 'Description longue' ) . ' enregistrée (l\'ancienne est gardée).', 'reload' => true ) );
			break;

		case 'composition':
			if ( ! taxonomy_exists( YVFR_TAX_RECIPE ) || ! current_user_can( 'manage_product_terms' ) ) {
				wp_send_json_error( 'Extension yv-fiche-blocs absente ou droits insuffisants.' );
			}
			$job = yvfr_api( 'GET', '/jobs/' . (int) get_post_meta( $post_id, YVFR_META_JOB, true ) );
			if ( is_wp_error( $job ) || (int) ( $job['product_id'] ?? 0 ) !== $post_id || empty( $job['recipe'] ) ) {
				wp_send_json_error( 'Recette introuvable : relancez la génération.' );
			}
			if ( ! empty( $job['multi_gouts'] ) ) {
				wp_send_json_error( 'Page à plusieurs goûts : elle n\'a pas de recette.' );
			}
			// Terme existant de la fiche, sinon celui qui porte le nom de la recette, sinon création.
			$ids     = wp_get_object_terms( $post_id, YVFR_TAX_RECIPE, array( 'fields' => 'ids' ) );
			$term_id = ! is_wp_error( $ids ) && $ids ? (int) $ids[0] : 0;
			if ( ! $term_id ) {
				$name     = mb_convert_case( $job['recipe'], MB_CASE_TITLE, 'UTF-8' );
				$existing = get_term_by( 'name', $name, YVFR_TAX_RECIPE );
				if ( $existing ) {
					$term_id = (int) $existing->term_id;
				} else {
					$new = wp_insert_term( $name, YVFR_TAX_RECIPE );
					if ( is_wp_error( $new ) ) {
						wp_send_json_error( $new->get_error_message() );
					}
					$term_id = (int) $new['term_id'];
				}
			}
			update_term_meta( $term_id, YVFR_META_COMPO, wp_kses_post( $raw ) );
			// Même terme sur tous les formats, sinon leurs « autres formats » se vident.
			$attached = array();
			$skipped  = array();
			foreach ( array_merge( array( array( 'id' => $post_id ) ), $job['formats'] ?? array() ) as $f ) {
				$fid = (int) ( $f['id'] ?? 0 );
				if ( ! $fid || 'product' !== get_post_type( $fid ) ) {
					continue;
				}
				$cur = wp_get_object_terms( $fid, YVFR_TAX_RECIPE, array( 'fields' => 'ids' ) );
				if ( ! is_wp_error( $cur ) && $cur && ! in_array( $term_id, array_map( 'intval', $cur ), true ) ) {
					$skipped[] = get_the_title( $fid );
					continue;
				}
				wp_set_object_terms( $fid, $term_id, YVFR_TAX_RECIPE, true );
				$attached[] = $fid;
			}
			$msg = 'Composition enregistrée sur la recette, attachée à ' . count( $attached ) . ' fiche(s).';
			if ( $skipped ) {
				$msg .= ' Déjà dans une autre recette, non modifiées : ' . implode( ', ', $skipped ) . '.';
			}
			wp_send_json_success( array( 'message' => $msg ) );
			break;

		case 'marque':
			if ( ! current_user_can( 'manage_product_terms' ) ) {
				wp_send_json_error( 'Droits insuffisants.' );
			}
			$chain = yvfr_brand_chain( $post_id );
			if ( ! $chain ) {
				wp_send_json_error( 'Aucune marque sur cette fiche.' );
			}
			// La sous-marque si la fiche en a une : c'est elle que le bloc « La marque » décrit.
			$cible = end( $chain );
			update_term_meta( $cible->term_id, YVFR_META_BRAND, wp_kses_post( $raw ) );
			wp_send_json_success( array( 'message' => 'Texte de la marque ' . $cible->name . ' enregistré.' ) );
			break;

		default:
			wp_send_json_error( 'Champ inconnu.' );
	}
} );
