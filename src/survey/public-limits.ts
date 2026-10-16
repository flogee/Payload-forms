export const PUBLIC_LIMITS = { reads: 20000, submissions: 2000, bodyBytes: 100000 } as const
export type PublicMetric = 'participation' | 'submissions'
