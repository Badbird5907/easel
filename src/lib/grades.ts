/** 0.924 -> "92.4%". Null when the course hides grades. */
export function formatScore(score: number | null): string | null {
  return score === null ? null : `${(score * 100).toFixed(1)}%`;
}
