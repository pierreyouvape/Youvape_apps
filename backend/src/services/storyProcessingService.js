/**
 * Compression des stories (ffmpeg) et publication sur R2.
 *
 * Une seule compression à la fois : ffmpeg occupe tous les cœurs du VPS, et
 * deux jobs en parallèle ralentiraient aussi le reste du backend. La file vit
 * en base (status = 'uploaded') : un redémarrage ne perd rien, la compression
 * interrompue est simplement reprise (storyModel.requeueInterrupted).
 *
 * Réglages validés le 13/10/2026 sur la story AeroX 32K de Join (720×1280,
 * 58 s, 11,2 Mo) : CRF 30 → 6,3 Mo (-44 %) sans perte visible, texte de
 * l'étiquette lisible. CRF 32 restait correct, CRF 26 ne gagnait que 15 %.
 *
 * Fichiers publiés pour la version N (jamais écrasés, jamais supprimés : des
 * e-mails Probance déjà envoyés pointent sur les anciennes versions) :
 *   stories/<slug>/story.vN.mp4   vidéo diffusée (MP4 H.264, démarrage rapide)
 *   stories/<slug>/poster.vN.webp image affichée avant lecture (attribut poster)
 *   stories/<slug>/thumb.vN.webp  vignette carrée 320×320 (bulles, carrousel)
 *   stories/<slug>/email.vN.gif   GIF animé de 3 s pour les e-mails Probance
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const storyModel = require('../models/storyModel');
const r2 = require('./r2Service');

const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000;

const PROFILES = {
  // Story verticale 9:16, recadrée au centre si la source n'est pas au format.
  portrait: {
    videoFilter: 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
    poster: [720, 1280],
    crf: 30, maxrate: '1800k', bufsize: '3600k',
    gifWidth: 270,
  },
  // Vidéo produit 16:9 (anciennes vidéos YouTube) : jamais recadrée, réduite à 720p.
  landscape: {
    videoFilter: 'scale=1280:720:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    poster: [1280, 720],
    crf: 28, maxrate: '2500k', bufsize: '5000k',
    gifWidth: 400,
  },
};

/** Lance un binaire et renvoie sa sortie ; l'erreur garde la fin de stderr. */
const run = (cmd, args, { timeoutMs = FFMPEG_TIMEOUT_MS } = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  child.on('error', (err) => { clearTimeout(timer); reject(err); });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (code === 0) return resolve(stdout);
    const reason = signal ? `interrompu (${signal}, délai dépassé ?)` : `code ${code}`;
    return reject(new Error(`${cmd} ${reason} : ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
  });
});

const probe = async (file) => {
  const out = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  const data = JSON.parse(out);
  const video = (data.streams || []).find((s) => s.codec_type === 'video');
  if (!video) throw new Error("Le fichier envoyé ne contient pas de piste vidéo");
  const [num, den] = String(video.r_frame_rate || '30/1').split('/').map(Number);
  return {
    duration: parseFloat(data.format?.duration) || parseFloat(video.duration) || 0,
    fps: den ? num / den : 30,
    hasAudio: (data.streams || []).some((s) => s.codec_type === 'audio'),
  };
};

/**
 * Miniature : image affichée avant la lecture (au format de la vidéo, recadrée
 * au centre) + vignette carrée 320×320 des bulles. `input` = une vidéo (avec
 * l'instant `at`) ou une image envoyée.
 */
const renderCover = async (input, at, profile, posterOut, thumbOut) => {
  const [w, h] = profile.poster;
  const seek = at === null || at === undefined ? [] : ['-ss', String(at)];
  await run('ffmpeg', ['-v', 'error', '-y', ...seek, '-i', input, '-frames:v', '1',
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,
    '-c:v', 'libwebp', '-quality', '85', posterOut]);
  await run('ffmpeg', ['-v', 'error', '-y', ...seek, '-i', input, '-frames:v', '1',
    '-vf', 'scale=320:320:force_original_aspect_ratio=increase,crop=320:320',
    '-c:v', 'libwebp', '-quality', '82', thumbOut]);
};

/** Instant par défaut : 1 s (ou plus tôt sur un clip court), la 1re image étant souvent un fondu au noir. */
const defaultCoverAt = (duration) => Math.min(1, Math.max(0, duration * 0.1));

/** Compresse une story déjà réclamée (status = processing) et publie ses fichiers. */
const processStory = async (story) => {
  const profile = PROFILES[story.format] || PROFILES.portrait;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `story-${story.id}-`));
  const file = (name) => path.join(dir, name);
  try {
    await r2.downloadSource(story.source_key, file('source'));
    const info = await probe(file('source'));

    // Au-delà de 30 i/s, on ramène à 30 : rien ne se voit sur mobile, tout se paie en poids.
    const vf = info.fps > 30.5 ? `${profile.videoFilter},fps=30` : profile.videoFilter;
    const audioArgs = info.hasAudio
      ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '96k', '-ac', '2']
      : ['-an'];
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', file('source'),
      '-map', '0:v:0', ...audioArgs,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(profile.crf),
      '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-maxrate', profile.maxrate, '-bufsize', profile.bufsize,
      '-movflags', '+faststart',
      file('story.mp4'),
    ]);

    const out = await probe(file('story.mp4'));
    const dims = JSON.parse(await run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
      '-print_format', 'json', file('story.mp4'),
    ])).streams[0];

    const at = String(defaultCoverAt(out.duration).toFixed(2));
    // Miniature : une image ENVOYÉE est gardée telle quelle ; une image choisie à
    // un instant est refaite sur la nouvelle vidéo, au même instant ; sinon, image auto.
    const keepCover = story.cover_source === 'upload' && story.poster_key && story.thumb_key;
    if (!keepCover) {
      const coverAt = story.cover_source === 'frame' && story.cover_frame_at !== null
        ? Math.min(Number(story.cover_frame_at), Math.max(0, out.duration - 0.1))
        : Number(at);
      await renderCover(file('story.mp4'), coverAt, profile, file('poster.webp'), file('thumb.webp'));
    }

    // GIF e-mail : 3 s, 10 i/s, palette réduite → environ 0,75 Mo pour une story.
    // Outlook (Windows) n'affiche que la première image : elle doit se suffire.
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', at, '-t', '3', '-i', file('story.mp4'),
      '-filter_complex',
      `fps=10,scale=${profile.gifWidth}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      file('email.gif')]);

    const version = (story.version || 0) + 1;
    const base = `stories/${story.slug}`;
    const keys = {
      videoKey: `${base}/story.v${version}.mp4`,
      posterKey: keepCover ? story.poster_key : `${base}/poster.v${version}.webp`,
      thumbKey: keepCover ? story.thumb_key : `${base}/thumb.v${version}.webp`,
      gifKey: `${base}/email.v${version}.gif`,
    };
    // Les images d'abord, la vidéo ensuite : la base ne pointe vers la nouvelle
    // version qu'une fois TOUT publié (markReady), donc jamais de lien mort.
    if (!keepCover) {
      await r2.uploadPublic(keys.posterKey, file('poster.webp'), 'image/webp');
      await r2.uploadPublic(keys.thumbKey, file('thumb.webp'), 'image/webp');
    }
    const gifSize = await r2.uploadPublic(keys.gifKey, file('email.gif'), 'image/gif');
    const videoSize = await r2.uploadPublic(keys.videoKey, file('story.mp4'), 'video/mp4');

    return storyModel.markReady(story.id, {
      version, ...keys, videoSize, gifSize,
      duration: Math.round(out.duration * 100) / 100,
      width: dims?.width || null,
      height: dims?.height || null,
    });
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
};

/**
 * Change la miniature d'une story prête, sans toucher à la vidéo.
 *   { kind: 'upload', buffer, mime, name } : image envoyée (JPEG, PNG, WebP, HEIC)
 *   { kind: 'frame', at }                  : image de la vidéo à l'instant `at` (s)
 *   { kind: 'video' }                      : retour à l'image automatique
 * Fichiers versionnés à part (poster.cN.webp) : jamais d'URL réécrite.
 */
const changeCover = async (story, opts) => {
  if (!story.video_key) throw new Error("La vidéo n'est pas encore prête");
  const profile = PROFILES[story.format] || PROFILES.portrait;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `cover-${story.id}-`));
  const file = (name) => path.join(dir, name);
  try {
    let input;
    let at = null;
    if (opts.kind === 'upload') {
      let buffer = opts.buffer;
      const isHeic = /image\/hei[cf]/i.test(opts.mime || '') || /\.hei[cf]$/i.test(opts.name || '');
      if (isHeic) {
        // Photos d'iPhone : ffmpeg ne lit pas le HEIC, heic-convert (WASM) si.
        const convert = require('heic-convert');
        buffer = Buffer.from(await convert({ buffer, format: 'JPEG', quality: 0.92 }));
      }
      input = file('upload');
      await fs.promises.writeFile(input, buffer);
    } else {
      // La vidéo diffusée (quelques Mo) plutôt que la source de 200 Mo.
      const res = await fetch(r2.publicUrl(story.video_key));
      if (!res.ok) throw new Error(`Vidéo introuvable sur R2 (HTTP ${res.status})`);
      input = file('video.mp4');
      await fs.promises.writeFile(input, Buffer.from(await res.arrayBuffer()));
      const duration = Number(story.duration_s) || 0;
      at = opts.kind === 'frame'
        ? Math.max(0, Math.min(Number(opts.at) || 0, Math.max(0, duration - 0.1)))
        : defaultCoverAt(duration);
    }
    try {
      await renderCover(input, at, profile, file('poster.webp'), file('thumb.webp'));
    } catch (err) {
      const e = new Error(opts.kind === 'upload' ? "Image illisible : utilisez un JPEG, PNG, WebP ou HEIC" : err.message);
      e.status = opts.kind === 'upload' ? 400 : 500;
      throw e;
    }
    const cv = (story.cover_version || 0) + 1;
    const base = `stories/${story.slug}`;
    const posterKey = `${base}/poster.c${cv}.webp`;
    const thumbKey = `${base}/thumb.c${cv}.webp`;
    await r2.uploadPublic(posterKey, file('poster.webp'), 'image/webp');
    await r2.uploadPublic(thumbKey, file('thumb.webp'), 'image/webp');
    return storyModel.setCover(story.id, {
      posterKey, thumbKey, source: opts.kind, version: cv,
      frameAt: opts.kind === 'frame' ? Math.round(at * 100) / 100 : null,
    });
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
};

let running = false;

/** Vide la file, une story après l'autre. Sans effet si elle tourne déjà. */
const kick = async () => {
  if (running) return;
  if (r2.missingConfig().length) return;
  running = true;
  try {
    for (;;) {
      const story = await storyModel.claimNext();
      if (!story) break;
      const started = Date.now();
      try {
        const done = await processStory(story);
        console.log(`[stories] #${story.id} ${story.slug} v${done.version} : `
          + `${Math.round(story.source_size / 1e5) / 10} Mo → ${Math.round(done.video_size / 1e5) / 10} Mo `
          + `en ${Math.round((Date.now() - started) / 1000)} s`);
      } catch (err) {
        console.error(`[stories] #${story.id} ${story.slug} : échec de la compression`, err.message);
        await storyModel.markError(story.id, err.message);
      }
    }
  } catch (err) {
    console.error('[stories] file de compression :', err.message);
  } finally {
    running = false;
  }
};

/** Au démarrage du backend : reprend les compressions interrompues, puis veille. */
const start = async () => {
  try {
    const requeued = await storyModel.requeueInterrupted();
    if (requeued) console.log(`[stories] ${requeued} compression(s) interrompue(s) remise(s) en file`);
  } catch (err) {
    // Table absente tant que la migration n'est pas passée : on ne bloque pas le démarrage.
    console.error('[stories] reprise de la file impossible :', err.message);
    return;
  }
  kick();
  // Filet de sécurité : la file est relancée à chaque envoi, ce passage ne sert
  // qu'au cas improbable d'un kick perdu.
  setInterval(kick, 60 * 1000).unref();
};

module.exports = { kick, start, processStory, changeCover };
