// Dépose la page d'aperçu des stories sur R2 (bucket public).
//
// Lancement (depuis la racine du dépôt, clés R2 lues sur le VPS, jamais affichées) :
//   docker run --rm --env-file <(ssh youvape 'grep "^R2_" /home/ubuntu/Youvape_apps/.env') \
//     -v "$PWD/wordpress-prod-muplugins/youvape-stories":/src:ro node:20-alpine sh -c \
//     'mkdir /w && cd /w && npm init -y >/dev/null && npm i @aws-sdk/client-s3@3.1150.0 >/dev/null 2>&1 \
//      && NODE_PATH=/w/node_modules node /src/tools/upload-preview.js'
//
// La zone Cloudflare youvape.fr impose aux navigateurs un cache de 6 mois sur
// les .js / .css (max-age=16070400, quel que soit l'en-tête envoyé) : le
// lecteur et sa feuille de style sont donc publiés sous un nom qui contient
// l'empreinte de leur contenu, et index.html (cache 60 s respecté) pointe
// vers ces noms. Une modification = un nouveau nom = rechargement garanti.
const fs = require('fs');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const c = new S3Client({
  region: 'auto', endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
});
const put = (key, body, type, cache) => c.send(new PutObjectCommand({
  Bucket: process.env.R2_BUCKET_PUBLIC, Key: key, Body: body, ContentType: type, CacheControl: cache,
}));
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

(async () => {
  const js = fs.readFileSync('/src/assets/yv-stories.js');
  const css = fs.readFileSync('/src/assets/yv-stories.css');
  const jsName = `yv-stories.${hash(js)}.js`;
  const cssName = `yv-stories.${hash(css)}.css`;
  await put(`stories/preview/${jsName}`, js, 'application/javascript; charset=utf-8', 'public, max-age=31536000, immutable');
  await put(`stories/preview/${cssName}`, css, 'text/css; charset=utf-8', 'public, max-age=31536000, immutable');
  const html = fs.readFileSync('/src/preview/index.html', 'utf8')
    .replace('href="yv-stories.css"', `href="${cssName}"`)
    .replace('src="yv-stories.js"', `src="${jsName}"`);
  if (!html.includes(jsName) || !html.includes(cssName)) throw new Error('références du lecteur introuvables dans index.html');
  await put('stories/preview/index.html', html, 'text/html; charset=utf-8', 'no-cache');
  console.log('déposé', jsName, cssName, 'index.html');
})().catch((e) => { console.error('ECHEC', e.message); process.exit(1); });
