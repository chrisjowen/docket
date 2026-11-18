/** Reciprocal rank fusion's constant: how far down a list a rank still counts. */
export const RRF_K = 60

/**
 * Several rankings of the same kind of item as one, by reciprocal rank
 * fusion: each item scores the sum of 1 / (RRF_K + its rank) over the lists
 * it is in, so one found high in either list, or fairly high in both, comes
 * first. Each item keeps what its first list said of it, with the fused
 * score; ties go by id. At most `limit` come back.
 */
export const fuseRankings = <T extends { id: string; score: number }>(lists: readonly (readonly T[])[], limit: number): T[] => {
  const fused = new Map<string, T>()
  for (const list of lists) {
    list.forEach((item, rank) => {
      const known = fused.get(item.id)
      const score = 1 / (RRF_K + rank + 1)
      fused.set(item.id, known ? { ...known, score: known.score + score } : { ...item, score })
    })
  }
  return [...fused.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit)
}
