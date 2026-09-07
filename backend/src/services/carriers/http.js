/**
 * Client HTTP JSON des API transporteurs.
 *
 * Extrait de `controllers/laposteController` (lot 0). Rien de spécifique à
 * La Poste ici : toutes les API d'étiquetage parlent JSON sur HTTPS, renvoient
 * parfois du gzip sans qu'on l'ait demandé, et savent répondre du HTML quand
 * elles vont mal. Les trois cas étaient déjà traités — ils le restent, pour
 * tout le monde.
 *
 * Les erreurs remontent enrichies, car l'appelant en a besoin pour décider :
 *   - `statusCode` : le code HTTP, qui pilote le message montré au packing et
 *     l'invalidation du cache de jeton sur 401 ;
 *   - `body`       : le corps JSON d'erreur, renvoyé tel quel en `details` ;
 *   - `nonJson`    : vrai quand la réponse n'était pas du JSON du tout.
 */

const https = require('https');
const zlib = require('zlib');

/**
 * Requête HTTPS JSON avec décompression gzip/deflate et timeout de 30 s.
 *
 * @param {string} url
 * @param {{method?: string, headers?: object, body?: string}} options
 * @param {{logPrefix?: string, carrierLabel?: string, timeoutMs?: number}} [context]
 *        `logPrefix` préfixe les logs, `carrierLabel` nomme le transporteur dans
 *        le message de timeout — que `buildUserMessage` reconnaît sur le mot
 *        « Timeout », pas sur le nom.
 * @returns {Promise<object>} le corps de réponse déjà parsé
 */
const carrierHttpRequest = (url, options, context = {}) => {
  const logPrefix = context.logPrefix || '[Transporteur HTTP]';
  const carrierLabel = context.carrierLabel || 'transporteur';
  const timeoutMs = context.timeoutMs || 30000;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    console.log(`${logPrefix} ${reqOptions.method} ${url}`);

    const req = https.request(reqOptions, (res) => {
      const encoding = res.headers['content-encoding'];
      console.log(`${logPrefix} Status: ${res.statusCode}, Content-Encoding: ${encoding || 'none'}, Content-Type: ${res.headers['content-type'] || 'unknown'}`);

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        let buffer = Buffer.concat(chunks);

        const processBody = (bodyBuffer) => {
          const bodyStr = bodyBuffer.toString('utf8');
          try {
            const parsed = JSON.parse(bodyStr);
            if (res.statusCode >= 400) {
              console.error(`${logPrefix} Erreur ${res.statusCode}:`, JSON.stringify(parsed).substring(0, 500));
              const err = new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`);
              err.statusCode = res.statusCode;
              err.body = parsed;
              reject(err);
            } else {
              console.log(`${logPrefix} Réponse OK, taille: ${bodyStr.length} chars`);
              resolve(parsed);
            }
          } catch (e) {
            console.error(`${logPrefix} Parse JSON échoué, taille buffer: ${bodyBuffer.length}, début: ${bodyStr.substring(0, 100)}`);
            const err = new Error(`Réponse non-JSON (HTTP ${res.statusCode}): ${bodyStr.substring(0, 200)}`);
            err.statusCode = res.statusCode;
            err.nonJson = true;
            reject(err);
          }
        };

        if (encoding === 'gzip') {
          zlib.gunzip(buffer, (err, decoded) => {
            if (err) {
              console.error(`${logPrefix} Erreur décompression gzip:`, err.message);
              reject(new Error('Erreur décompression gzip'));
            } else {
              processBody(decoded);
            }
          });
        } else if (encoding === 'deflate') {
          zlib.inflate(buffer, (err, decoded) => {
            if (err) {
              console.error(`${logPrefix} Erreur décompression deflate:`, err.message);
              reject(new Error('Erreur décompression deflate'));
            } else {
              processBody(decoded);
            }
          });
        } else {
          processBody(buffer);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`${logPrefix} Erreur réseau:`, err.message);
      reject(err);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout ${carrierLabel} API`));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
};

module.exports = { carrierHttpRequest };
