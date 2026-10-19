// Conservative local-pilot limits, not a provider allowance or billing cap.
// A deliberate reviewed release is required to change them; no env override.
export const QA_MACHINE_LIMITS = Object.freeze({
  client: Object.freeze({ requests: 500, reports: 50 }),
  installation: Object.freeze({ requests: 2000, reports: 200 }),
})
