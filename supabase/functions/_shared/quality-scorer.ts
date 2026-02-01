/**
 * Quality Scoring Algorithm for Competitor Discovery
 * 
 * Assigns a 0-30 point quality score based on:
 * - Distance (0-10 pts): Closer = higher
 * - Rating (0-10 pts): 4.5+ = 10 pts
 * - Reviews (0-5 pts): 100+ = 5 pts
 * - Domain TLD (0-5 pts): .co.uk = 5 pts
 * 
 * Priority Tiers:
 * - High (25-30 pts): Scrape 15 pages
 * - Medium (15-24 pts): Scrape 5 pages  
 * - Low (0-14 pts): Scrape 2 pages
 */

export interface CompetitorForScoring {
  distance_miles?: number | null;
  rating?: number | null;
  reviews_count?: number | null;
  domain?: string | null;
}

export interface QualityResult {
  quality_score: number;
  priority_tier: 'high' | 'medium' | 'low';
  score_breakdown: {
    distance: number;
    rating: number;
    reviews: number;
    domain: number;
  };
}

/**
 * Calculate quality score for a competitor
 */
export function calculateQualityScore(competitor: CompetitorForScoring): QualityResult {
  let distanceScore = 0;
  let ratingScore = 0;
  let reviewsScore = 0;
  let domainScore = 0;

  // =========================================
  // DISTANCE: 0-10 points (closer = better)
  // =========================================
  if (competitor.distance_miles !== null && competitor.distance_miles !== undefined) {
    const dist = competitor.distance_miles;
    if (dist <= 5) {
      distanceScore = 10;
    } else if (dist <= 10) {
      distanceScore = 8;
    } else if (dist <= 15) {
      distanceScore = 6;
    } else if (dist <= 20) {
      distanceScore = 5;
    } else if (dist <= 30) {
      distanceScore = 3;
    } else if (dist <= 50) {
      distanceScore = 1;
    }
    // Beyond 50 miles = 0 points
  }

  // =========================================
  // GOOGLE RATING: 0-10 points
  // =========================================
  const rating = competitor.rating ?? 0;
  if (rating >= 4.8) {
    ratingScore = 10;
  } else if (rating >= 4.5) {
    ratingScore = 9;
  } else if (rating >= 4.2) {
    ratingScore = 7;
  } else if (rating >= 4.0) {
    ratingScore = 5;
  } else if (rating >= 3.5) {
    ratingScore = 3;
  } else if (rating >= 3.0) {
    ratingScore = 1;
  }
  // Below 3.0 = 0 points

  // =========================================
  // REVIEW COUNT: 0-5 points
  // =========================================
  const reviews = competitor.reviews_count ?? 0;
  if (reviews >= 200) {
    reviewsScore = 5;
  } else if (reviews >= 100) {
    reviewsScore = 4;
  } else if (reviews >= 50) {
    reviewsScore = 3;
  } else if (reviews >= 20) {
    reviewsScore = 2;
  } else if (reviews >= 5) {
    reviewsScore = 1;
  }
  // Fewer than 5 reviews = 0 points

  // =========================================
  // DOMAIN TLD: 0-5 points (UK domains preferred)
  // =========================================
  const domain = competitor.domain?.toLowerCase() ?? '';
  if (domain.endsWith('.co.uk')) {
    domainScore = 5;
  } else if (domain.endsWith('.uk')) {
    domainScore = 4;
  } else if (domain.endsWith('.com')) {
    domainScore = 2;
  } else if (domain.endsWith('.org') || domain.endsWith('.net')) {
    domainScore = 1;
  }
  // Other TLDs = 0 points

  // =========================================
  // TOTAL SCORE
  // =========================================
  const totalScore = distanceScore + ratingScore + reviewsScore + domainScore;

  // =========================================
  // PRIORITY TIER
  // =========================================
  let priorityTier: 'high' | 'medium' | 'low';
  if (totalScore >= 25) {
    priorityTier = 'high';
  } else if (totalScore >= 15) {
    priorityTier = 'medium';
  } else {
    priorityTier = 'low';
  }

  return {
    quality_score: totalScore,
    priority_tier: priorityTier,
    score_breakdown: {
      distance: distanceScore,
      rating: ratingScore,
      reviews: reviewsScore,
      domain: domainScore,
    },
  };
}

/**
 * Get scrape depth for a priority tier
 */
export function getScrapeDepthForTier(tier: 'high' | 'medium' | 'low'): number {
  switch (tier) {
    case 'high':
      return 15; // Scrape up to 15 pages
    case 'medium':
      return 5;  // Scrape up to 5 pages
    case 'low':
      return 2;  // Just homepage + one service page
    default:
      return 5;
  }
}

/**
 * Batch calculate scores for multiple competitors
 */
export function scoreCompetitors(competitors: CompetitorForScoring[]): QualityResult[] {
  return competitors.map(calculateQualityScore);
}

/**
 * Sort competitors by quality score (highest first)
 */
export function sortByQuality<T extends CompetitorForScoring>(
  competitors: T[]
): (T & QualityResult)[] {
  return competitors
    .map(comp => ({
      ...comp,
      ...calculateQualityScore(comp),
    }))
    .sort((a, b) => b.quality_score - a.quality_score);
}
