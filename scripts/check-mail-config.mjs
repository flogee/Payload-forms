import { configuredHostnames } from './public-access.mjs'

export const realAddress = address => typeof address === 'string' && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(address) &&
  !/(?:@|\.)(?:invalid|test|example|local|localhost|example\.(?:com|org|net))$/i.test(address)

export function verifyMailConfig(internal) {
  const vars = internal?.vars || {}
  const hosts = configuredHostnames(internal)
  if (vars.MAIL_ENABLED !== '1' || vars.MAIL_LOCAL_TEST !== '0' ||
    !hosts.some(host => vars.MAIL_ORIGIN === `https://${host}`) || !realAddress(vars.MAIL_FROM) ||
    !/^\d+$/.test(vars.MAIL_MONTHLY_LIMIT || '') || Number(vars.MAIL_MONTHLY_LIMIT) < 50 || Number(vars.MAIL_MONTHLY_LIMIT) > 500 ||
    internal.triggers?.crons?.length !== 1 || internal.triggers.crons[0] !== '*/5 * * * *') {
    throw new Error('Release mail requires an installer-owned sender, configured HTTPS origin, five-minute cron and 50–500 monthly attempts; warnings must stay enabled.')
  }
  if (!realAddress(vars.OPS_ALERT_RECIPIENT)) throw new Error('Kontingent-Warnversand benötigt eine gültige eigene Betriebsadresse.')
  const allowed = vars.MAIL_ALLOWED_RECIPIENTS?.split(',').map(value => value.trim().toLowerCase()) || []
  const binding = internal.send_email?.[0]
  if (!allowed.includes(vars.OPS_ALERT_RECIPIENT) || !allowed.length || allowed.length > 10 || new Set(allowed).size !== allowed.length ||
    allowed.some(address => !realAddress(address)) ||
    internal.send_email?.length !== 1 || binding?.name !== 'EMAIL' || binding.destination_address !== undefined ||
    binding.allowed_sender_addresses?.length !== 1 || binding.allowed_sender_addresses[0] !== vars.MAIL_FROM ||
    binding.allowed_destination_addresses?.length !== allowed.length ||
    !allowed.every(address => binding.allowed_destination_addresses.includes(address))) {
    throw new Error('Versand benötigt eine begrenzte EMAIL-Bindung mit genau den registrierten, von Cloudflare verifizierten Empfängern.')
  }
}

// Read-only preflight. A provider acceptance is not a delivery confirmation.
export async function verifyMailDestinations(internal, env, request = fetch) {
  const response = await request(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/email/routing/addresses?per_page=100`, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, redirect: 'manual', signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`Unable to verify mail destinations (HTTP ${response.status}).`)
  const data = await response.json()
  if (!data.success || !Array.isArray(data.result) || data.result_info?.total_pages > 1 ||
    !internal.vars.MAIL_ALLOWED_RECIPIENTS.split(',').every(address => data.result.some(destination =>
      destination.email?.toLowerCase() === address.trim().toLowerCase() && typeof destination.verified === 'string' && Number.isFinite(Date.parse(destination.verified))))) {
    throw new Error('Every configured mail destination must be verified in the selected Cloudflare account; incomplete inventories fail closed.')
  }
}
