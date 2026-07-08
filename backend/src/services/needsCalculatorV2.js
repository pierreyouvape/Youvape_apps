/**
 * Gestion d'achat V2 — calcul des besoins avec seuil d'alerte DÉCOUPLÉ de la couverture.
 *
 * Différence avec needsCalculator.js (V1) :
 *   - V1 : un seul paramètre `coverageMonths` sert à la fois de déclencheur
 *          (« faut-il commander ? ») et de cible (« combien ? »).
 *          Conséquence : à 1 vente/jour, le stock passe sous la cible chaque jour
 *          → reco de +1 quotidienne, sans fin.
 *   - V2 : deux paramètres indépendants :
 *          * alertMonths    → SEUIL D'ALERTE : le produit ne s'affiche que si le
 *                             stock ne tient plus `leadTime + alertMonths×30` jours.
 *          * coverageMonths → CIBLE : quand on commande, on remonte le stock à
 *                             `leadTime + coverageMonths×30` jours.
 *          L'écart entre les deux est le « batch » qui espace les commandes.
 *
 * Invariant : coverageMonths >= alertMonths (sinon on propose de remonter à un
 * niveau déjà sous le seuil → re-déclenchement immédiat). On borne côté calcul.
 *
 * ⚠️ Ce fichier est une COPIE isolée. La V1 (needsCalculator.js) n'est jamais
 * modifiée — l'app "Gestion d'achat" existante reste intacte.
 */

const calculateLinearRegression = (sales) => {
  const n = sales.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += sales[i];
    sumXY += i * sales[i]; sumX2 += i * i;
  }
  const avgX = sumX / n;
  const avgY = sumY / n;
  const denominator = sumX2 - n * avgX * avgX;
  if (denominator === 0 || avgY === 0) return { coefficient: 1, rSquared: 0 };
  const slope = (sumXY - n * avgX * avgY) / denominator;
  const intercept = avgY - slope * avgX;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += Math.pow(sales[i] - (slope * i + intercept), 2);
    ssTot += Math.pow(sales[i] - avgY, 2);
  }
  const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);
  const projectedValue = avgY + slope * (n - avgX);
  let coefficient = avgY === 0 ? (projectedValue > 0 ? 2 : 1) : projectedValue / avgY;
  coefficient = Math.max(0.1, Math.min(5, coefficient));
  return { coefficient, rSquared: Math.max(0, rSquared) };
};

const calculateWeightedMovingAverage = (sales) => {
  const n = sales.length;
  if (n < 2) return 1;
  let weightedSum = 0, totalWeight = 0;
  for (let i = 0; i < n; i++) {
    const weight = i + 1;
    weightedSum += sales[i] * weight;
    totalWeight += weight;
  }
  const weightedAvg = weightedSum / totalWeight;
  const simpleAvg = sales.reduce((a, b) => a + b, 0) / n;
  if (simpleAvg === 0) return weightedAvg > 0 ? 1.5 : 1;
  return Math.max(0.1, Math.min(5, weightedAvg / simpleAvg));
};

const calculateTrendCoefficient = (sales) => {
  if (!sales || sales.length < 2) {
    return { coefficient: 1, rSquared: null, method: 'insufficient_data' };
  }
  const values = sales.map(m => parseInt(m.total_qty) || 0);
  const regressionResult = calculateLinearRegression(values);
  if (regressionResult.rSquared >= 0.7) {
    return {
      coefficient: regressionResult.coefficient,
      rSquared: Math.round(regressionResult.rSquared * 100) / 100,
      method: 'linear_regression'
    };
  }
  const wmaCoefficient = calculateWeightedMovingAverage(values);
  return {
    coefficient: wmaCoefficient,
    rSquared: Math.round(regressionResult.rSquared * 100) / 100,
    method: 'weighted_moving_average'
  };
};

/**
 * Calcule les besoins d'un produit (V2) à partir de ses données brutes.
 *
 * @param {number} alertMonths     Seuil d'alerte en mois (déclencheur d'affichage).
 * @param {number} coverageMonths  Couverture cible en mois (niveau de réassort).
 *
 * `should_reorder` : true si le stock effectif ne tient pas jusqu'au seuil d'alerte.
 * `theoretical_proposal` / `supposed_proposal` : quantité pour remonter à la couverture.
 * En V2, une proposition n'est renvoyée (> 0) QUE si `should_reorder` est vrai —
 * c'est ce qui casse la boucle « +1 chaque jour ».
 */
const computeProductNeeds = (product, periodDays, coverageMonths, isCustomPeriod, analysisStartDate, analysisEndDate, periodUnit, alertMonths) => {
  const { daily_sales = [], stock = 0, incoming_qty = 0 } = product;

  // Garde-fou : la couverture ne peut pas être inférieure au seuil d'alerte.
  // Sinon on proposerait de remonter à un niveau déjà sous l'alerte → boucle.
  const safeAlertMonths = alertMonths != null ? alertMonths : coverageMonths;
  const effectiveCoverageMonths = Math.max(coverageMonths, safeAlertMonths);

  let salesData;
  let actualDays = periodDays;

  if (isCustomPeriod && analysisStartDate && analysisEndDate) {
    const start = new Date(analysisStartDate + 'T00:00:00');
    const end = new Date(analysisEndDate + 'T23:59:59');
    salesData = daily_sales.filter(m => {
      const d = new Date(m.date);
      return d >= start && d <= end;
    });
    actualDays = Math.max(Math.ceil((end - start) / (1000 * 60 * 60 * 24)), 1);
  } else if (periodUnit === 'months') {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const startInclusive = new Date(now.getFullYear(), now.getMonth() - Math.round(periodDays / 30), 1);
    salesData = daily_sales.filter(m => {
      const d = new Date(m.date);
      return d >= startInclusive && d < tomorrow;
    });
    actualDays = Math.max(Math.ceil((tomorrow - startInclusive) / (1000 * 60 * 60 * 24)), 1);
  } else {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const startInclusive = new Date(now.getFullYear(), now.getMonth(), now.getDate() - periodDays);
    salesData = daily_sales.filter(m => {
      const d = new Date(m.date);
      return d >= startInclusive && d < tomorrow;
    });
    actualDays = periodDays;
  }

  const salesInPeriod = salesData.reduce((sum, m) => sum + (parseInt(m.total_qty) || 0), 0);

  // Tendance : agréger par semaine pour avoir des points exploitables
  const weeklyMap = new Map();
  for (const d of salesData) {
    const date = new Date(d.date);
    const dayOfWeek = (date.getDay() + 6) % 7;
    const monday = new Date(date);
    monday.setDate(date.getDate() - dayOfWeek);
    const key = monday.toISOString().slice(0, 10);
    weeklyMap.set(key, (weeklyMap.get(key) || 0) + (parseInt(d.total_qty) || 0));
  }
  const weeklySales = [...weeklyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, qty]) => ({ total_qty: qty }));
  const trendResult = calculateTrendCoefficient(weeklySales);
  const trendCoefficient = trendResult.coefficient;

  // Formule ATUM : besoin basé sur le rythme journalier vs couverture cible
  const leadTimeDays = product.supplier_lead_time_days || 2;
  const dailyRate = actualDays > 0 ? salesInPeriod / actualDays : 0;
  const avgMonthlySales = dailyRate * 30;
  const effectiveStock = stock + incoming_qty;

  const stockWillLast = dailyRate > 0 ? effectiveStock / dailyRate : Infinity;

  // --- V2 : découplage alerte / couverture ---
  // Seuil d'alerte (déclencheur) : le stock doit tenir au moins ce nombre de jours.
  const alertDays = leadTimeDays + (safeAlertMonths * 30);
  // Cible de réassort (quantité) : niveau auquel on remonte le stock.
  const targetDays = leadTimeDays + (effectiveCoverageMonths * 30);

  // Déclencheur : commande-t-on ? Oui si le stock ne tient pas jusqu'au seuil d'alerte.
  const shouldReorder = dailyRate > 0 && stockWillLast < alertDays;

  const theoreticalNeed = dailyRate > 0 ? dailyRate * targetDays : 0;
  const supposedNeed = (dailyRate * trendCoefficient) > 0 ? (dailyRate * trendCoefficient) * targetDays : 0;

  // La proposition n'est renvoyée que si on a franchi le seuil d'alerte.
  // C'est ce qui casse la boucle « 1 vente/jour = reco +1 chaque jour » :
  // tant que le stock tient au-delà de l'alerte, proposal = 0 → produit invisible.
  const theoreticalProposal = shouldReorder ? Math.max(0, Math.ceil(theoreticalNeed) - effectiveStock) : 0;
  const supposedProposal = shouldReorder ? Math.max(0, Math.ceil(supposedNeed) - effectiveStock) : 0;

  return {
    sales_in_period: salesInPeriod,
    avg_monthly_sales: Math.round(avgMonthlySales * 100) / 100,
    trend_coefficient: Math.round(trendCoefficient * 100) / 100,
    trend_direction: trendCoefficient > 1.1 ? 'up' : trendCoefficient < 0.9 ? 'down' : 'stable',
    daily_rate: Math.round(dailyRate * 1000) / 1000,
    stock_will_last: dailyRate > 0 ? Math.round(stockWillLast) : null,
    alert_days: Math.round(alertDays),
    target_days: Math.round(targetDays),
    should_reorder: shouldReorder,
    theoretical_need: Math.ceil(theoreticalNeed),
    supposed_need: Math.ceil(supposedNeed),
    theoretical_proposal: theoreticalProposal,
    supposed_proposal: supposedProposal
  };
};

module.exports = {
  calculateLinearRegression,
  calculateWeightedMovingAverage,
  calculateTrendCoefficient,
  computeProductNeeds
};
