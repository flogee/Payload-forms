// Payload 3.90.2 counts only the first row's keys when batching D1 INSERTs.
// Sparse rows can have more keys later (upstream issue payloadcms/payload#16964).
// Budget against the union, leaving room for conflict-update parameters.
export function safeBatches<T extends Record<string, unknown>>(rows: T[], budget = 80): T[][] {
  if (!rows.length) return []
  const width = new Set(rows.flatMap(row => Object.keys(row))).size
  if (width > budget) throw new Error('D1-Zeile überschreitet das Parameterbudget.')
  const size = Math.max(1, Math.floor(budget / Math.max(width, 1)))
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))
}
