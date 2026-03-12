/**
 * Opportunity Scoring Algorithm
 * Washington State Consulting Expansion Heat Map
 *
 * SCORING PHILOSOPHY:
 * Five criteria are combined into a single 0–100 Opportunity Score.
 * Weights reflect the firm's strategic priorities:
 *
 *  1. Consulting Firm Absence   30% — Competition avoidance is the primary filter.
 *                                      Entering an oversaturated market requires
 *                                      massive CAC and yields compressed margins.
 *
 *  2. Target Business Abundance 25% — Without sufficient SMBs needing exit/turnaround
 *                                      services, even a clear market has no addressable
 *                                      revenue. Counts 5–249 employee businesses.
 *
 *  3. City Tier Classification  20% — Tier 3 mid-markets are the sweet spot: enough
 *                                      economic activity to generate quality engagements
 *                                      without the saturation of Tier 1–2 metros.
 *
 *  4. Business Maturity         15% — Exit advisory requires businesses past startup
 *                                      phase. 3–4+ year old businesses have proven
 *                                      viability and owners who've had time to plan exits.
 *
 *  5. Owner Demographics        10% — Aging owner populations create natural exit urgency.
 *                                      Baby Boomer retirement wave is the macro tailwind.
 *
 * DEFAULT WEIGHTS (user-adjustable in UI):
 *   consultingAbsence: 0.30
 *   businessAbundance: 0.25
 *   cityTier:          0.20
 *   businessMaturity:  0.15
 *   ownerDemographics: 0.10
 *
 * NORMALIZATION:
 *   All sub-scores are normalized to 0–100 relative to the WA city dataset.
 *   Min-max normalization ensures no single outlier dominates.
 *   Tier scores use a fixed lookup table (not normalized) to preserve categorical meaning.
 */

const DEFAULT_WEIGHTS = {
  consultingAbsence: 0.30,
  businessAbundance: 0.25,
  cityTier: 0.20,
  businessMaturity: 0.15,
  ownerDemographics: 0.10
};

/**
 * Tier score lookup table.
 * Translates categorical tier to 0–100 opportunity value.
 *
 * Tier 1 (5):  Seattle/Bellevue — firms saturate every niche, pricing war constant
 * Tier 2 (22): Secondary metros — competition exists and is organized; harder entry
 * Tier 3 (100): Mid-markets — THE TARGET; established SMBs, low competition, viable fees
 * Tier 4 (62): Smaller cities — real opportunity but requires broader territory coverage
 * Tier 5 (8):  Micro markets — not enough SMBs to sustain consistent pipeline
 */
const TIER_SCORES = {
  1: 5,
  2: 22,
  3: 100,
  4: 62,
  5: 8
};

/**
 * Normalize a value to 0–100 range using min-max scaling.
 * @param {number} value - The raw value to normalize
 * @param {number} min   - Minimum in the dataset
 * @param {number} max   - Maximum in the dataset
 * @param {boolean} invert - If true, lower values score higher (e.g., consulting density)
 * @returns {number} Score from 0–100
 */
function normalizeMinMax(value, min, max, invert = false) {
  if (max === min) return 50;
  const normalized = ((value - min) / (max - min)) * 100;
  return invert ? 100 - normalized : normalized;
}

/**
 * Compute the consulting absence score.
 * LOGIC: Count of management consulting firms in city.
 * Fewer firms = higher score (we want underserved markets).
 * Uses inverse min-max normalization.
 */
function computeConsultingAbsenceScore(city, stats) {
  return normalizeMinMax(
    city.consultingFirmCount,
    stats.consultingFirmCount.min,
    stats.consultingFirmCount.max,
    true // invert: fewer firms = better
  );
}

/**
 * Compute the business abundance score.
 * LOGIC: SMBs per 1,000 population (density-adjusted count).
 * This normalizes for city size — a city of 30k with 1,000 SMBs
 * is more target-rich than a city of 100k with 2,000 SMBs.
 * Uses direct min-max normalization (higher density = better).
 */
function computeBusinessAbundanceScore(city, stats) {
  const density = (city.smbCount / city.population) * 1000;
  return normalizeMinMax(density, stats.smbDensity.min, stats.smbDensity.max);
}

/**
 * Compute the city tier score.
 * LOGIC: Fixed lookup table. Tier 3 = 100, others penalized.
 * Not normalized — preserves the categorical meaning of tier classification.
 * The tier itself is determined by equal weighting of pop size, MHI, and growth.
 */
function computeTierScore(city) {
  return TIER_SCORES[city.tier] || 0;
}

/**
 * Compute the business maturity score.
 * LOGIC: % of businesses that are 3+ years old.
 * Higher percentage = more exit-ready business owners.
 * Standard industry survival benchmarks (BLS):
 *   ~65% survive 3 years, ~50% survive 5 years.
 * Cities above ~72% have notably stable, established SMB bases.
 */
function computeBusinessMaturityScore(city, stats) {
  return normalizeMinMax(
    city.businessMaturityPct,
    stats.businessMaturityPct.min,
    stats.businessMaturityPct.max
  );
}

/**
 * Compute the owner demographics score.
 * LOGIC: % of population aged 55+.
 * Used as a proxy for business owner retirement readiness.
 * National average for business owners is notably older than the general population.
 * Higher 55+ population correlates with more owners approaching exit timeline.
 */
function computeOwnerDemographicsScore(city, stats) {
  return normalizeMinMax(
    city.ownerAge55PlusPct,
    stats.ownerAge55PlusPct.min,
    stats.ownerAge55PlusPct.max
  );
}

/**
 * Pre-compute dataset statistics needed for normalization.
 * Run once over the full city dataset.
 * @param {Array} cities - Full CITY_DATA array
 * @returns {Object} Min/max for each normalizable metric
 */
function computeDatasetStats(cities) {
  const smbDensities = cities.map(c => (c.smbCount / c.population) * 1000);

  return {
    consultingFirmCount: {
      min: Math.min(...cities.map(c => c.consultingFirmCount)),
      max: Math.max(...cities.map(c => c.consultingFirmCount))
    },
    smbDensity: {
      min: Math.min(...smbDensities),
      max: Math.max(...smbDensities)
    },
    businessMaturityPct: {
      min: Math.min(...cities.map(c => c.businessMaturityPct)),
      max: Math.max(...cities.map(c => c.businessMaturityPct))
    },
    ownerAge55PlusPct: {
      min: Math.min(...cities.map(c => c.ownerAge55PlusPct)),
      max: Math.max(...cities.map(c => c.ownerAge55PlusPct))
    }
  };
}

/**
 * Score a single city across all five criteria.
 * @param {Object} city    - City data object from CITY_DATA
 * @param {Object} stats   - Pre-computed dataset statistics
 * @param {Object} weights - Weight configuration (defaults to DEFAULT_WEIGHTS)
 * @returns {Object} Scored city with component scores and final opportunity score
 */
function scoreCity(city, stats, weights = DEFAULT_WEIGHTS) {
  const scores = {
    consultingAbsence: computeConsultingAbsenceScore(city, stats),
    businessAbundance: computeBusinessAbundanceScore(city, stats),
    cityTier: computeTierScore(city),
    businessMaturity: computeBusinessMaturityScore(city, stats),
    ownerDemographics: computeOwnerDemographicsScore(city, stats)
  };

  // Weighted composite score
  const opportunityScore =
    scores.consultingAbsence * weights.consultingAbsence +
    scores.businessAbundance * weights.businessAbundance +
    scores.cityTier        * weights.cityTier +
    scores.businessMaturity * weights.businessMaturity +
    scores.ownerDemographics * weights.ownerDemographics;

  // SMB density for display
  const smbDensity = parseFloat(((city.smbCount / city.population) * 1000).toFixed(1));

  return {
    ...city,
    scores,
    opportunityScore: parseFloat(opportunityScore.toFixed(1)),
    smbDensity,
    rank: null // filled in after sorting
  };
}

/**
 * Score all cities and return sorted results.
 * @param {Array}  cities  - Full CITY_DATA array
 * @param {Object} weights - Optional custom weights
 * @returns {Array} Cities sorted by opportunityScore descending, with ranks assigned
 */
function scoreAllCities(cities, weights = DEFAULT_WEIGHTS) {
  const stats = computeDatasetStats(cities);
  const scored = cities.map(city => scoreCity(city, stats, weights));

  // Sort descending by opportunity score
  scored.sort((a, b) => b.opportunityScore - a.opportunityScore);

  // Assign rank
  scored.forEach((city, i) => {
    city.rank = i + 1;
  });

  return scored;
}

/**
 * Get score color for map visualization.
 * Uses a green→yellow→orange→red gradient.
 * @param {number} score - 0 to 100
 * @returns {string} Hex color code
 */
function getScoreColor(score) {
  if (score >= 80) return "#10b981"; // emerald
  if (score >= 68) return "#34d399"; // lighter emerald
  if (score >= 55) return "#84cc16"; // lime
  if (score >= 44) return "#eab308"; // yellow
  if (score >= 32) return "#f97316"; // orange
  return "#ef4444";                  // red
}

/**
 * Get tier label for display.
 */
function getTierLabel(tier) {
  const labels = {
    1: "Tier 1 — Saturated Market",
    2: "Tier 2 — High Competition",
    3: "Tier 3 — Prime Opportunity",
    4: "Tier 4 — Emerging Market",
    5: "Tier 5 — Micro Market"
  };
  return labels[tier] || "Unknown";
}

/**
 * Get tier color for badge display.
 */
function getTierColor(tier) {
  const colors = {
    1: "#ef4444",
    2: "#f97316",
    3: "#10b981",
    4: "#eab308",
    5: "#94a3b8"
  };
  return colors[tier] || "#94a3b8";
}

/**
 * Get opportunity level label from score.
 */
function getOpportunityLabel(score) {
  if (score >= 75) return "Priority Target";
  if (score >= 60) return "Strong Candidate";
  if (score >= 45) return "Viable Secondary";
  if (score >= 30) return "Monitor";
  return "Pass";
}

/**
 * Validate that weights sum to 1.0 (with 0.01 tolerance).
 */
function validateWeights(weights) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1.0) < 0.01;
}

// Export for module use (also works as global in browser)
if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_WEIGHTS,
    TIER_SCORES,
    scoreAllCities,
    scoreCity,
    computeDatasetStats,
    getScoreColor,
    getTierLabel,
    getTierColor,
    getOpportunityLabel,
    validateWeights
  };
}
