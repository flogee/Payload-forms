export function verifyPublicConfig(internal) {
  const rates = internal?.ratelimits
  if (internal?.vars?.PUBLIC_GUARD_ENABLED !== '1' || !Array.isArray(rates) || rates.length !== 2 || new Set(rates.map(rate => rate.namespace_id)).size !== 2 ||
      !rates.some(rate => rate.name === 'PUBLIC_IP_RATE' && /^[1-9]\d*$/.test(rate.namespace_id) && rate.simple?.limit === 300 && rate.simple?.period === 60) ||
      !rates.some(rate => rate.name === 'PUBLIC_TOTAL_RATE' && /^[1-9]\d*$/.test(rate.namespace_id) && rate.simple?.limit === 1000 && rate.simple?.period === 60)) {
    throw new Error('Öffentliche Teilnahme benötigt die geprüften Budget- und Ratenbegrenzungen.')
  }
}
