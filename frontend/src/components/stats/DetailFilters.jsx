// Barre de filtres des pages de détail (/brands/…, /sub-brands/…, /categories/…,
// /sub-categories/…) : même période et même périmètre que l'onglet correspondant
// de /stats, pour qu'un chiffre lu dans le tableau se retrouve tel quel sur la page.
//
//   kind = 'category' → page d'une marque : on restreint à un rayon du catalogue
//   kind = 'brand'    → page d'une catégorie : on restreint à une marque
//
// `context` (ex. { brand: 'Kiwi Vapor' }) limite le menu à ce qui existe vraiment
// dans le périmètre de la page — pas de rayon proposé où la marque n'a rien.

import { useState, useMemo } from 'react';
import PeriodFilter, { computeDateRange, dateParams, PERIOD_OPTIONS } from './PeriodFilter';
import {
  CategoryScopeSelect, BrandScopeSelect, useCatalogOptions, scopeToParams, scopeLabel,
} from './ScopeFilter';

export function useDetailFilters(kind, context) {
  const [period, setPeriod] = useState('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [scope, setScope] = useState('');
  const options = useCatalogOptions(context);

  const dateRange = useMemo(
    () => computeDateRange(period, customStart, customEnd),
    [period, customStart, customEnd],
  );
  const params = useMemo(
    () => ({ ...dateParams(dateRange), ...scopeToParams(scope) }),
    [dateRange, scope],
  );

  // Une seule dépendance à surveiller dans les useEffect des pages
  const filterKey = `${dateRange.dateFrom || ''}|${dateRange.dateTo || ''}|${scope}`;

  const periodText = period === 'custom'
    ? `du ${customStart || '…'} au ${customEnd || '…'}`
    : (PERIOD_OPTIONS.find((o) => o.value === period)?.label || '');

  const bar = (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px',
      padding: '14px 0 18px', borderBottom: '1px solid #E2E2E2', marginBottom: '20px',
    }}>
      <PeriodFilter
        period={period}
        setPeriod={setPeriod}
        customStart={customStart}
        setCustomStart={setCustomStart}
        customEnd={customEnd}
        setCustomEnd={setCustomEnd}
      />
      {kind === 'brand'
        ? <BrandScopeSelect scope={scope} setScope={setScope} options={options} />
        : <CategoryScopeSelect scope={scope} setScope={setScope} options={options} />}
      {scope && (
        <button
          onClick={() => setScope('')}
          title="Revenir à tout le catalogue"
          style={{
            padding: '7px 12px', borderRadius: '999px', border: '1px solid #cfe0ea',
            background: '#eef4f8', color: '#135E84', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {scopeLabel(scope)} ✕
        </button>
      )}
    </div>
  );

  return { params, bar, filterKey, periodText, scopeText: scopeLabel(scope) };
}

export default useDetailFilters;
