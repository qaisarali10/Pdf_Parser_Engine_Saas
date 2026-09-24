function money(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function distributorKey(sale) {
  return sale.distributor?.id || sale.distributorId || String(sale.distributor || "");
}

function companyIdForSale(sale) {
  return sale.distributor?.company?.legacyId || sale.distributor?.company?.id || sale.distributor?.companyId || null;
}

function companyNameForSale(sale) {
  return sale.distributor?.company?.cname || sale.company?.cname || "";
}

function distributorNameForSale(sale) {
  return sale.distributor?.dname || "";
}

function distributorAreaForSale(sale) {
  return sale.distributor?.area || "";
}

function summarizeProblematic(sales, expectedCompanyLegacyId) {
  const grouped = new Map();

  for (const sale of sales) {
    if (Number(companyIdForSale(sale)) !== Number(expectedCompanyLegacyId)) continue;
    const key = distributorKey(sale);
    if (!grouped.has(key)) {
      grouped.set(key, {
        company: companyNameForSale(sale),
        area: distributorAreaForSale(sale),
        distributor: distributorNameForSale(sale),
        total_clvalue: 0,
        total_segvalue: 0
      });
    }

    const item = grouped.get(key);
    item.total_clvalue += Number(sale.clvalue || 0);
    item.total_segvalue += Number((Number(sale.seg_bsunit || 0) + Number(sale.seg_bnunit || 0)) * Number(sale.sprice || 0));
  }

  return [...grouped.values()]
    .map((item) => ({
      ...item,
      total_clvalue: money(item.total_clvalue),
      total_segvalue: money(item.total_segvalue),
      difference: money(Math.abs(item.total_clvalue - item.total_segvalue))
    }))
    .filter((item) => item.difference > 5000)
    .sort((a, b) => b.difference - a.difference);
}

export function buildMonthlySummary({ sales, month, year }) {
  const distributorIds = new Set(sales.map(distributorKey).filter(Boolean));
  const sizaDistributorIds = new Set(
    sales.filter((sale) => Number(companyIdForSale(sale)) === 1).map(distributorKey).filter(Boolean)
  );
  const razeeDistributorIds = new Set(
    sales.filter((sale) => Number(companyIdForSale(sale)) === 2).map(distributorKey).filter(Boolean)
  );

  const sizaProblematic = summarizeProblematic(sales, 1);
  const razeeProblematic = summarizeProblematic(sales, 2);
  const sizaQuality = Math.max(sizaDistributorIds.size - sizaProblematic.length, 0);
  const razeeQuality = Math.max(razeeDistributorIds.size - razeeProblematic.length, 0);

  return {
    date: new Date().toISOString(),
    month,
    year,
    row_count: sales.length,
    ssr: distributorIds.size,
    totalDistributors: distributorIds.size,
    siza: sizaDistributorIds.size,
    razee: razeeDistributorIds.size,
    quality_assured: sizaQuality,
    quality_raazee: razeeQuality,
    quality_raze: razeeQuality,
    siza_problematic: sizaProblematic.length,
    raazee_problematic: razeeProblematic.length,
    siza_problamatic: sizaProblematic.length,
    raze_problamatic: razeeProblematic.length,
    siza_problematic_distributors: sizaProblematic,
    raazee_problematic_distributors: razeeProblematic,
    Siza_problematic_distributors: sizaProblematic,
    Raze_problematic_distributors: razeeProblematic
  };
}
