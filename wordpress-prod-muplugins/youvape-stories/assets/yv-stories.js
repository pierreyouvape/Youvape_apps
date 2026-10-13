/*!
 * YouVape Stories — lecteur de stories du site (remplace le widget Join Stories).
 *
 * Aucune dépendance. Le HTML des bulles / cartes est rendu par le mu-plugin
 * côté serveur (pas de décalage de mise en page) ; ce script ne fait que
 * brancher les clics et ouvrir le lecteur plein écran. Il sait aussi rendre
 * lui-même un widget à partir de son JSON (page d'aperçu, montage dynamique).
 *
 * Données : fichiers publiés par l'app /stories sur R2
 *   stories/index.json           { stories, widgets, products, pages }
 *   stories/widgets/<slug>.json  { slug, title, layout, stories: [...] }
 *
 * Événements : chaque action émet `yvstories:event` sur window
 * ({ type, widget, story, ... }) — impression, open, view, progress,
 * cta_click, close. L'envoi aux statistiques se branche dessus.
 */
(function () {
  'use strict';

  var PROGRESS_MARKS = [25, 50, 75, 100];
  var LONG_PRESS_MS = 220;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'class') node.className = attrs[k];
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function emit(type, detail) {
    try {
      window.dispatchEvent(new CustomEvent('yvstories:event', { detail: Object.assign({ type: type, at: Date.now() }, detail) }));
    } catch (e) { /* navigateurs très anciens : pas de statistiques, rien de grave */ }
  }

  /** Lien du bouton d'action : lien saisi, sinon la fiche produit. */
  function ctaHref(cta, siteUrl) {
    if (!cta) return null;
    if (cta.url) return cta.url;
    if (cta.product_id) return (siteUrl || '') + '/?post_type=product&p=' + cta.product_id;
    return null;
  }

  /* ───────────────────────── Rendu des widgets ───────────────────────── */

  function renderBubbles(widget) {
    var list = el('div', { class: 'yvs-bubbles', role: 'list' });
    widget.stories.forEach(function (s, i) {
      list.appendChild(el('button', {
        class: 'yvs-bubble', type: 'button', role: 'listitem',
        'data-yvs-index': i, 'aria-label': 'Voir la vidéo : ' + s.title,
      }, [
        el('span', { class: 'yvs-bubble__ring' }, [
          el('img', { class: 'yvs-bubble__img', src: s.thumb, alt: '', loading: 'lazy', width: 160, height: 160 }),
        ]),
        el('span', { class: 'yvs-bubble__label', text: s.title }),
      ]));
    });
    return list;
  }

  function renderCards(widget) {
    var track = el('div', { class: 'yvs-cards__track', role: 'list' });
    widget.stories.forEach(function (s, i) {
      track.appendChild(el('button', {
        class: 'yvs-card', type: 'button', role: 'listitem',
        'data-yvs-index': i, 'aria-label': 'Voir la vidéo : ' + s.title,
      }, [
        el('img', { class: 'yvs-card__img', src: s.poster || s.thumb, alt: '', loading: 'lazy' }),
        el('span', { class: 'yvs-card__play', 'aria-hidden': 'true' }),
        el('span', { class: 'yvs-card__label', text: s.title }),
      ]));
    });
    var prev = el('button', { class: 'yvs-cards__nav yvs-cards__nav--prev', type: 'button', 'aria-label': 'Précédent' });
    var next = el('button', { class: 'yvs-cards__nav yvs-cards__nav--next', type: 'button', 'aria-label': 'Suivant' });
    var step = function (dir) {
      var card = track.querySelector('.yvs-card');
      var w = card ? card.getBoundingClientRect().width + 12 : 200;
      track.scrollBy({ left: dir * w * 2, behavior: 'smooth' });
    };
    prev.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    return el('div', { class: 'yvs-cards' }, [prev, track, next]);
  }

  /** Monte un widget dans `container` à partir de son JSON déplié. */
  function mount(container, widget, options) {
    if (!container || !widget || !widget.stories || !widget.stories.length) return;
    container.innerHTML = '';
    container.classList.add('yvs-widget', 'yvs-widget--' + (widget.layout === 'cards' ? 'cards' : 'bubbles'));
    container.appendChild(widget.layout === 'cards' ? renderCards(widget) : renderBubbles(widget));
    bind(container, widget, options);
  }

  /** Branche les clics d'un widget déjà présent dans la page (HTML rendu par le serveur). */
  function bind(container, widget, options) {
    if (container.__yvsBound) return;
    container.__yvsBound = true;
    container.addEventListener('click', function (e) {
      var item = e.target.closest('[data-yvs-index]');
      if (!item || !container.contains(item)) return;
      e.preventDefault();
      open(widget, parseInt(item.getAttribute('data-yvs-index'), 10) || 0, options);
    });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (en) { return en.isIntersecting; })) {
          emit('impression', { widget: widget.slug });
          io.disconnect();
        }
      }, { threshold: 0.5 });
      io.observe(container);
    }
  }

  /* ───────────────────────── Lecteur plein écran ───────────────────────── */

  var player = null; // un seul lecteur par page

  function buildPlayer() {
    var dialog = el('dialog', { class: 'yvs-player', 'aria-label': 'Lecteur de vidéos' });
    var bars = el('div', { class: 'yvs-player__bars' });
    var video = el('video', { class: 'yvs-player__video', playsinline: '', 'webkit-playsinline': '', preload: 'auto' });
    var close = el('button', { class: 'yvs-player__btn yvs-player__close', type: 'button', 'aria-label': 'Fermer' });
    var mute = el('button', { class: 'yvs-player__btn yvs-player__mute', type: 'button', 'aria-label': 'Couper le son' });
    // Icônes en SVG : son actif / coupé, l'une ou l'autre affichée selon .is-muted.
    mute.innerHTML = '<svg class="yvs-ico yvs-ico--on" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="#fff"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
      + '<svg class="yvs-ico yvs-ico--off" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="#fff"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
    var title = el('div', { class: 'yvs-player__title' });
    var paused = el('div', { class: 'yvs-player__paused', 'aria-hidden': 'true' });
    var cta = el('a', { class: 'yvs-player__cta' });
    var prevZone = el('button', { class: 'yvs-player__zone yvs-player__zone--prev', type: 'button', 'aria-label': 'Vidéo précédente' });
    var nextZone = el('button', { class: 'yvs-player__zone yvs-player__zone--next', type: 'button', 'aria-label': 'Vidéo suivante' });
    // Lecteur caché qui télécharge la vidéo suivante (un <link rel=preload as=video>
    // est ignoré par la plupart des navigateurs).
    var preload = el('video', { class: 'yvs-player__preload', preload: 'auto', muted: '', playsinline: '', 'aria-hidden': 'true' });
    var frame = el('div', { class: 'yvs-player__frame' }, [video, prevZone, nextZone, bars, title, close, mute, paused, cta, preload]);
    dialog.appendChild(frame);
    document.body.appendChild(dialog);

    var p = {
      dialog: dialog, frame: frame, video: video, bars: bars, title: title, cta: cta,
      mute: mute, paused: paused, preload: preload,
      widget: null, index: 0, options: {}, marks: {}, raf: 0, pressTimer: 0, longPress: false, touchY: null,
    };

    close.addEventListener('click', function () { closePlayer('button'); });
    mute.addEventListener('click', function () {
      video.muted = !video.muted;
      frame.classList.toggle('is-muted', video.muted);
      mute.setAttribute('aria-label', video.muted ? 'Activer le son' : 'Couper le son');
    });
    // Appui long = pause (comme Instagram) ; appui court = précédente / suivante.
    [prevZone, nextZone].forEach(function (zone, z) {
      zone.addEventListener('pointerdown', function () {
        p.longPress = false;
        p.pressTimer = setTimeout(function () { p.longPress = true; video.pause(); frame.classList.add('is-paused'); }, LONG_PRESS_MS);
      });
      var release = function () {
        clearTimeout(p.pressTimer);
        if (p.longPress) { video.play().catch(function () {}); frame.classList.remove('is-paused'); }
      };
      zone.addEventListener('pointerup', release);
      zone.addEventListener('pointerleave', release);
      zone.addEventListener('click', function (e) {
        e.preventDefault();
        if (p.longPress) { p.longPress = false; return; }
        go(z === 0 ? -1 : 1);
      });
    });
    cta.addEventListener('click', function () {
      var s = current();
      emit('cta_click', { widget: p.widget.slug, story: s.slug, href: cta.getAttribute('href') });
    });
    video.addEventListener('ended', function () { go(1); });
    video.addEventListener('waiting', function () { frame.classList.add('is-loading'); });
    video.addEventListener('playing', function () { frame.classList.remove('is-loading'); });
    // Glisser vers le bas = fermer.
    frame.addEventListener('touchstart', function (e) { p.touchY = e.touches[0].clientY; }, { passive: true });
    frame.addEventListener('touchend', function (e) {
      if (p.touchY !== null && e.changedTouches[0].clientY - p.touchY > 90) closePlayer('swipe');
      p.touchY = null;
    });
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); closePlayer('escape'); });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === ' ') { e.preventDefault(); if (video.paused) video.play(); else video.pause(); }
    });
    return p;
  }

  function current() { return player.widget.stories[player.index]; }

  function renderBars() {
    player.bars.innerHTML = '';
    player.widget.stories.forEach(function (_, i) {
      var fill = el('span', { class: 'yvs-player__fill' });
      fill.style.transform = 'scaleX(' + (i < player.index ? 1 : 0) + ')';
      player.bars.appendChild(el('span', { class: 'yvs-player__bar' }, [fill]));
    });
  }

  function tick() {
    var v = player.video;
    var fill = player.bars.children[player.index] && player.bars.children[player.index].firstChild;
    if (fill && v.duration) {
      var ratio = Math.min(1, v.currentTime / v.duration);
      fill.style.transform = 'scaleX(' + ratio + ')';
      var pct = ratio * 100;
      PROGRESS_MARKS.forEach(function (m) {
        if (pct >= m - 0.5 && !player.marks[m]) {
          player.marks[m] = true;
          emit('progress', { widget: player.widget.slug, story: current().slug, percent: m });
        }
      });
    }
    player.raf = requestAnimationFrame(tick);
  }

  function show(index) {
    var p = player;
    var s = p.widget.stories[index];
    p.index = index;
    p.marks = {};
    renderBars();
    p.frame.classList.toggle('is-landscape', s.format === 'landscape');
    p.title.textContent = s.title;
    p.video.poster = s.poster || '';
    p.video.src = s.video;
    p.video.currentTime = 0;
    var href = ctaHref(s.cta, p.options.siteUrl);
    if (href) {
      p.cta.textContent = (s.cta && s.cta.label) || 'DÉCOUVRIR';
      p.cta.setAttribute('href', href);
      p.cta.hidden = false;
    } else {
      p.cta.hidden = true;
      p.cta.removeAttribute('href');
    }
    // Précharge la suivante pendant que celle-ci joue : l'enchaînement est immédiat.
    var nextStory = p.widget.stories[index + 1];
    if (nextStory && p.preload.getAttribute('src') !== nextStory.video) p.preload.src = nextStory.video;
    var play = p.video.play();
    if (play && play.catch) {
      // Lecture avec le son refusée (rare, le clic l'autorise) : on relance en muet.
      play.catch(function () {
        p.video.muted = true;
        p.frame.classList.add('is-muted');
        p.video.play().catch(function () {});
      });
    }
    try { history.replaceState(null, '', '#story=' + encodeURIComponent(s.slug)); } catch (e) { /* page en file:// */ }
    emit('view', { widget: p.widget.slug, story: s.slug, index: index });
  }

  function go(delta) {
    var i = player.index + delta;
    if (i < 0) { player.video.currentTime = 0; return; }
    if (i >= player.widget.stories.length) { closePlayer('end'); return; }
    show(i);
  }

  function open(widget, index, options) {
    if (!player) player = buildPlayer();
    player.widget = widget;
    player.options = options || {};
    player.openedAt = Date.now();
    document.documentElement.classList.add('yvs-lock');
    if (!player.dialog.open) {
      if (player.dialog.showModal) player.dialog.showModal(); else player.dialog.setAttribute('open', '');
    }
    emit('open', { widget: widget.slug, story: widget.stories[index].slug });
    show(index);
  }

  function closePlayer(reason) {
    if (!player || !player.dialog.open) return;
    cancelAnimationFrame(player.raf);
    player.video.pause();
    player.video.removeAttribute('src');
    player.video.load();
    if (player.dialog.close) player.dialog.close(); else player.dialog.removeAttribute('open');
    document.documentElement.classList.remove('yvs-lock');
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* idem */ }
    emit('close', { widget: player.widget.slug, story: current().slug, reason: reason, seconds: Math.round((Date.now() - player.openedAt) / 1000) });
  }

  // La boucle de progression ne tourne que lecteur ouvert.
  document.addEventListener('play', function (e) {
    if (player && e.target === player.video) { cancelAnimationFrame(player.raf); player.raf = requestAnimationFrame(tick); }
  }, true);

  /** Ouvre directement une story (#story=<slug> dans l'adresse, lien d'e-mail). */
  function openFromHash(widgets, options) {
    var m = /[#&]story=([^&]+)/.exec(location.hash);
    if (!m) return false;
    var slug = decodeURIComponent(m[1]);
    for (var i = 0; i < widgets.length; i += 1) {
      var idx = widgets[i].stories.findIndex(function (s) { return s.slug === slug; });
      if (idx >= 0) { open(widgets[i], idx, options); return true; }
    }
    return false;
  }

  /** Déplie un widget de l'index (slugs → stories complètes). */
  function expand(index, slug) {
    var w = index.widgets && index.widgets[slug];
    if (!w) return null;
    return {
      slug: slug, title: w.title, layout: w.layout,
      stories: w.stories.map(function (s) { return index.stories[s]; }).filter(Boolean),
    };
  }

  window.YVStories = { mount: mount, bind: bind, open: open, close: closePlayer, openFromHash: openFromHash, expand: expand };
}());
