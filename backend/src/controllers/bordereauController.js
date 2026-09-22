/**
 * Bordereaux de dépôt — l'app « Bordereau », dans le groupe Prépa de commande.
 *
 * Le bordereau est le papier que le chauffeur signe en emportant les colis :
 * il liste les numéros de suivi déposés. Il était produit dans BMS ; l'app doit
 * savoir le produire pour les étiquettes qu'elle émet elle-même depuis le
 * lot 2.
 *
 * Trois règles commandent ce fichier, toutes tranchées avec Pierre le
 * 21-22/09/2026 :
 *
 *   - **Une date de départ, comme BMS.** Pas « tout ce qui n'est pas déposé » :
 *     les colis antérieurs à la bascule ont été déposés via BMS sans que notre
 *     base le sache, les reprendre ferait un bordereau de rattrapage absurde.
 *   - **On prend tout ce qui est affiché.** Pas de sélection colis par colis :
 *     ce qui est dans la liste part sur le bordereau.
 *   - **Au-delà de la limite du transporteur, plusieurs bordereaux**, annoncés
 *     avant d'agir (« 62 colis → 2 bordereaux »), chacun avec son numéro.
 *
 * Et une leçon du 11/09/2026, qui ne se négocie pas : **un refus d'identifiants
 * arrête TOUT**. Le compte Colissimo est partagé avec BMS ; quelques tentatives
 * de plus le bloquent 30 minutes pour toute l'entreprise.
 */

const pool = require('../config/database');
const bordereauModel = require('../models/bordereauModel');
const { getAdapter, listCarrierCodes } = require('../services/carriers');
const { getAccount } = require('../services/carriers/accounts');
const { depositSlipFileName, supportsDepositSlip } = require('../services/carriers/contract');
const { buildUserMessage } = require('../services/carriers/errors');

const LOG_TAG = 'Bordereau';

/**
 * Verrou de génération, partagé par tous les backends sur la même base.
 *
 * Deux postes qui cliquent en même temps enverraient deux fois les mêmes colis
 * à Colissimo : deux bordereaux pour un seul dépôt, et le chauffeur qui signe
 * un papier qui ne correspond à rien. Le verrou est posé pour toute la durée de
 * la génération, appels API compris — c'est court (quelques secondes) et c'est
 * le seul moment où il compte.
 *
 * Clé arbitraire, propre aux bordereaux : `pg_advisory_lock` partage un espace
 * de noms global, il ne faut pas tomber sur celle d'un autre traitement.
 */
const VERROU_GENERATION = 4210001;

/**
 * Découpe une liste de colis en lots de `max`.
 *
 * Exporté pour le banc : c'est ce découpage qui décide du nombre de bordereaux
 * annoncé à l'écran, et une erreur ici se verrait au comptoir, pas aux tests.
 *
 * @param {Array} items
 * @param {number} max
 * @returns {Array[]}
 */
const decouperEnLots = (items, max) => {
  const taille = Math.max(1, Number(max) || 1);
  const lots = [];
  for (let i = 0; i < items.length; i += taille) lots.push(items.slice(i, i + taille));
  return lots;
};

/** Les transporteurs branchés qui savent produire un bordereau. */
const carriersWithDepositSlip = () =>
  listCarrierCodes()
    .map(code => getAdapter(code))
    .filter(supportsDepositSlip);

/**
 * Date de départ par défaut : aujourd'hui, en heure de Paris.
 *
 * Le serveur tourne en UTC : `toISOString()` donnerait la veille chaque soir
 * après 22 h l'été, et l'écran s'ouvrirait sur une liste trop large sans que
 * personne le remarque.
 */
const aujourdhuiParis = () =>
  new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());

const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;

const lireDate = (brut) => {
  const valeur = String(brut || '').trim();
  if (!valeur) return aujourdhuiParis();
  if (!FORMAT_DATE.test(valeur)) {
    const err = new Error(`Date de départ invalide : « ${valeur} » (attendu AAAA-MM-JJ)`);
    err.statusCode = 400;
    throw err;
  }
  return valeur;
};

/**
 * Les colis à déposer, groupés par transporteur et par contrat.
 *
 * GET /api/bordereaux/pending?since=AAAA-MM-JJ
 */
const listPending = async (req, res) => {
  try {
    const since = lireDate(req.query.since);
    const adapters = carriersWithDepositSlip();

    const parcels = await bordereauModel.listPending({
      carrierCodes: adapters.map(a => a.code),
      since
    });

    // Une section par CONTRAT, et pas par transporteur : un bordereau ne porte
    // que les colis d'un seul contrat (Chronopost en aura deux au lot 3). Une
    // section par transporteur laisserait les colis du second contrat affichés
    // sans moyen de les déposer.
    const sections = adapters.flatMap(adapter => {
      const siens = parcels.filter(p => p.carrier_code === adapter.code);
      const contrats = [...new Set(siens.map(p => p.account_code))];
      // Aucun colis : la section s'affiche quand même, vide. « 0 colis à
      // déposer » est une information ; une section absente laisserait croire
      // à une panne.
      if (contrats.length === 0) contrats.push(adapter.accountCode);

      return contrats.map(accountCode => {
        const aDeposer = siens.filter(p => p.account_code === accountCode);
        return {
          carrierCode: adapter.code,
          carrierLabel: adapter.label,
          accountCode,
          maxParcels: adapter.depositSlip.maxParcels,
          parcels: aDeposer,
          bordereauCount: Math.ceil(aDeposer.length / adapter.depositSlip.maxParcels)
        };
      });
    });

    res.json({ since, sections });
  } catch (error) {
    console.error(`[${LOG_TAG}] Erreur listPending :`, error.message);
    res.status(error.statusCode || 500).json({
      error: 'Erreur lors du chargement des colis à déposer',
      userMessage: error.userMessage || null,
      details: error.message
    });
  }
};

/**
 * Produit le ou les bordereaux d'un transporteur.
 *
 * POST /api/bordereaux/generate  { carrierCode, accountCode?, since }
 *
 * Chaque lot est indépendant : un lot refusé par le transporteur n'annule pas
 * les précédents, qui sont déjà imprimables et dont les colis sont déjà
 * rattachés. La réponse dit exactement ce qui est passé et ce qui ne l'est pas.
 */
const generate = async (req, res) => {
  const { carrierCode } = req.body || {};
  let adapter = null;
  let verrou = null;

  try {
    const since = lireDate(req.body?.since);
    adapter = getAdapter(String(carrierCode || ''));

    if (!supportsDepositSlip(adapter)) {
      const err = new Error(`${adapter.label} ne produit pas de bordereau de dépôt`);
      err.statusCode = 400;
      err.userMessage = `${adapter.label} n'a pas de bordereau de dépôt : il n'y a rien à générer.`;
      throw err;
    }

    await bordereauModel.assertSchemaReady();

    const accountCode = String(req.body?.accountCode || adapter.accountCode);
    const account = await getAccount(adapter.code, accountCode);

    // ── Verrou : une seule génération à la fois, tous postes confondus ───────
    verrou = await pool.connect();
    const { rows: [{ pris }] } = await verrou.query(
      'SELECT pg_try_advisory_lock($1) AS pris', [VERROU_GENERATION]
    );
    if (!pris) {
      const err = new Error('Génération de bordereau déjà en cours');
      err.statusCode = 409;
      err.userMessage = 'Un bordereau est déjà en cours de génération sur un autre poste. '
        + 'Attendez quelques secondes et rechargez la page.';
      throw err;
    }

    const parcels = (await bordereauModel.listPending({ carrierCodes: [adapter.code], since }))
      .filter(p => p.account_code === accountCode);

    if (parcels.length === 0) {
      return res.json({
        since, carrierCode: adapter.code, carrierLabel: adapter.label,
        created: [], failed: [], stopped: false,
        message: 'Aucun colis à déposer : rien à générer.'
      });
    }

    const lots = decouperEnLots(parcels, adapter.depositSlip.maxParcels);
    console.log(`[${LOG_TAG}] ${adapter.label} — ${parcels.length} colis depuis le ${since} → ${lots.length} bordereau(x)`);

    const created = [];
    const failed = [];
    let stopped = false;

    for (let i = 0; i < lots.length && !stopped; i++) {
      const lot = lots[i];
      try {
        const slip = await adapter.createDepositSlip({
          account,
          trackingNumbers: lot.map(p => p.tracking_number)
        });

        // Le bordereau existe chez le transporteur : à partir d'ici, tout échec
        // d'écriture perdrait un papier déjà émis. D'où la transaction, et le
        // fait qu'on n'en sorte pas sans avoir rattaché les colis.
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const bordereau = await bordereauModel.insertBordereau(client, {
            carrierCode: adapter.code,
            accountCode,
            number: slip.number,
            publishedAt: slip.publishedAt,
            pdfBase64: slip.pdfBase64,
            labelIds: lot.map(p => p.id),
            userId: req.user?.id || null
          });
          await client.query('COMMIT');

          if (bordereau.attached !== lot.length) {
            // Un colis annulé ou rattaché entre-temps. Le papier, lui, le
            // porte : on le dit dans les logs plutôt que de le taire.
            console.warn(`[${LOG_TAG}] Bordereau ${slip.number} : ${bordereau.attached}/${lot.length} colis rattachés`);
          }

          created.push({
            id: bordereau.id,
            number: bordereau.bordereau_number,
            parcelCount: lot.length,
            publishedAt: bordereau.published_at,
            fileName: depositSlipFileName(bordereau.bordereau_number),
            orderNumbers: lot.map(p => p.order_number)
          });
          console.log(`[${LOG_TAG}] Bordereau ${slip.number} — ${lot.length} colis, id ${bordereau.id}`);
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      } catch (error) {
        const refusMetier = Boolean(error.body && error.body.code);
        console.error(`[${LOG_TAG}] Lot ${i + 1}/${lots.length} en échec :`, error.message);

        failed.push({
          index: i + 1,
          parcelCount: lot.length,
          orderNumbers: lot.map(p => p.order_number),
          message: error.userMessage || buildUserMessage(error, adapter.label) || error.message
        });

        // Un refus d'identifiants arrête tout, sans exception (11/09/2026).
        // Une panne réseau aussi, mais pour une autre raison : on ne sait pas
        // si le bordereau a été produit de leur côté, et en relancer un second
        // sur les mêmes colis ferait signer deux papiers au chauffeur.
        if (!refusMetier) {
          stopped = true;
          failed[failed.length - 1].stopsEverything = true;
        }
      }
    }

    const messages = [];
    if (created.length) {
      messages.push(created.length === 1
        ? `Bordereau ${created[0].number} généré (${created[0].parcelCount} colis).`
        : `${created.length} bordereaux générés (${created.reduce((n, c) => n + c.parcelCount, 0)} colis).`);
    }
    if (failed.length) {
      messages.push(stopped
        ? `Arrêt après l'échec du lot ${failed[failed.length - 1].index} : vérifiez chez le transporteur `
          + `si le bordereau a été produit AVANT de relancer.`
        : `${failed.length} lot(s) refusé(s) — leurs colis restent à déposer.`);
    }

    res.json({
      since,
      carrierCode: adapter.code,
      carrierLabel: adapter.label,
      created,
      failed,
      stopped,
      message: messages.join(' ')
    });

  } catch (error) {
    console.error(`[${LOG_TAG}] Erreur generate :`, error.message);
    res.status(error.statusCode || 500).json({
      error: adapter ? `Erreur génération bordereau ${adapter.label}` : 'Erreur génération bordereau',
      userMessage: error.userMessage || (adapter ? buildUserMessage(error, adapter.label) : null),
      details: error.body || error.message
    });
  } finally {
    if (verrou) {
      // Le verrou vit sur la CONNEXION, pas sur la requête : une connexion
      // rendue au pool en le tenant encore le garderait jusqu'à sa fermeture,
      // et plus personne ne pourrait générer de bordereau. Si le déverrouillage
      // échoue, on détruit la connexion plutôt que de la remettre en
      // circulation — `release(true)` la retire du pool.
      try {
        await verrou.query('SELECT pg_advisory_unlock($1)', [VERROU_GENERATION]);
        verrou.release();
      } catch (e) {
        console.error(`[${LOG_TAG}] Déverrouillage impossible, connexion détruite :`, e.message);
        verrou.release(true);
      }
    }
  }
};

/**
 * Historique : les bordereaux déjà émis, pour réimprimer celui que le chauffeur
 * redemande.
 *
 * GET /api/bordereaux/history?limit=50
 */
const listHistory = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const rows = await bordereauModel.listHistory({ limit });
    res.json(rows.map(r => ({ ...r, fileName: depositSlipFileName(r.bordereau_number) })));
  } catch (error) {
    console.error(`[${LOG_TAG}] Erreur listHistory :`, error.message);
    res.status(error.statusCode || 500).json({
      error: "Erreur lors du chargement de l'historique",
      userMessage: error.userMessage || null,
      details: error.message
    });
  }
};

/** GET /api/bordereaux/:id/labels — les colis portés par un bordereau. */
const listLabels = async (req, res) => {
  try {
    res.json(await bordereauModel.listLabelsForBordereau(req.params.id));
  } catch (error) {
    console.error(`[${LOG_TAG}] Erreur listLabels :`, error.message);
    res.status(error.statusCode || 500).json({
      error: 'Erreur lors du chargement des colis du bordereau',
      details: error.message
    });
  }
};

/** GET /api/bordereaux/:id/pdf — réimpression. */
const getPdf = async (req, res) => {
  try {
    const bordereau = await bordereauModel.findPdfById(req.params.id);
    if (!bordereau) return res.status(404).json({ error: 'Bordereau introuvable' });
    if (!bordereau.pdf_data) {
      return res.status(404).json({
        error: 'PDF absent',
        userMessage: "Ce bordereau n'a pas de PDF enregistré : le transporteur ne sait pas le reproduire."
      });
    }

    res.json({
      id: bordereau.id,
      number: bordereau.bordereau_number,
      parcelCount: bordereau.parcel_count,
      pdfBase64: bordereau.pdf_data,
      fileName: depositSlipFileName(bordereau.bordereau_number)
    });
  } catch (error) {
    console.error(`[${LOG_TAG}] Erreur getPdf :`, error.message);
    res.status(error.statusCode || 500).json({
      error: 'Erreur lors de la récupération du bordereau',
      details: error.message
    });
  }
};

module.exports = { listPending, generate, listHistory, listLabels, getPdf, decouperEnLots };
