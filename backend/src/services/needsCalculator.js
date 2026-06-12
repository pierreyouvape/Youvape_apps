/**
 * Calculs de besoins de réapprovisionnement, portés depuis NeedsTab.jsx (frontend)
 * pour être réutilisables côté backend (ex: onglet "À réapprovisionner" du catalogue).
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
 * Calcule les besoins d'un produit à partir de ses données brutes (daily_sales, stock, incoming_qty).
 * Reprend exactement la logique de NeedsTab.jsx (computeProductNeeds).
 */
const computeProductNeeds = (product, periodDays, coverageMonths, isCustomPeriod, analysisStartDate, analysisEndDate, periodUnit) => {
  const { daily_sales = [], stock = 0, incoming_qty = 0 } = product;

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

  const targetDays = leadTimeDays + (coverageMonths * 30);

  const theoreticalNeed = dailyRate > 0 ? dailyRate * targetDays : 0;
  const theoreticalProposal = dailyRate > 0 ? Math.max(0, Math.ceil(theoreticalNeed) - effectiveStock) : 0;

  const projectedDailyRate = dailyRate * trendCoefficient;
  const supposedNeed = projectedDailyRate > 0 ? projectedDailyRate * targetDays : 0;
  const supposedProposal = projectedDailyRate > 0 ? Math.max(0, Math.ceil(supposedNeed) - effectiveStock) : 0;

  return {
    sales_in_period: salesInPeriod,
    avg_monthly_sales: Math.round(avgMonthlySales * 100) / 100,
    trend_coefficient: Math.round(trendCoefficient * 100) / 100,
    trend_direction: trendCoefficient > 1.1 ? 'up' : trendCoefficient < 0.9 ? 'down' : 'stable',
    daily_rate: Math.round(dailyRate * 1000) / 1000,
    stock_will_last: dailyRate > 0 ? Math.round(stockWillLast) : null,
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
