/**
 * Ranks are set as a percent of the best possible score for a night, so they
 * scale when content is added and work the same way on every night.
 */

export function sortRanks(ranks) {
  return [...ranks].sort((a, b) => a.minPercent - b.minPercent);
}

export function rankFor(xp, maxXp, ranks) {
  const percent = maxXp > 0 ? (xp / maxXp) * 100 : 0;
  const sorted = sortRanks(ranks);
  let rank = sorted[0].name;
  for (const r of sorted) if (percent >= r.minPercent) rank = r.name;
  return rank;
}
