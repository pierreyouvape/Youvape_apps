/**
 * Texte d'une image (capture d'écran, photo de facture) par OCR.
 *
 * tesseract.js tourne en WebAssembly, sans binaire système à ajouter à
 * l'image Docker. Les données de langue (fra, ~1,5 Mo) se téléchargent au
 * premier appel puis restent en cache dans le conteneur. Un worker par appel :
 * l'usage est rare (dépôt manuel AliExpress) et une seconde par image suffit.
 */

const CACHE = process.env.TESSERACT_CACHE || '/tmp/tesseract-cache';

/** PNG, JPEG ou WebP, d'après les premiers octets — pas d'après le nom. */
function isImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true;
  return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

async function imageToText(buffer) {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('fra', 1, { cachePath: CACHE });
  try {
    const { data } = await worker.recognize(buffer);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}

module.exports = { isImage, imageToText };
