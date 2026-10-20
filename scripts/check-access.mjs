import { internalHostnames, publicParticipationName, participationDestinations } from './public-access.mjs'
import { qaMachineInstallSettings } from './qa-machine-config.mjs'
export { internalHostnames } from './public-access.mjs'

function publicDestinations(application) {
  // Cloudflare ignores legacy fields whenever destinations are provided, even when empty.
  if (application.destinations != null) {
    if (!Array.isArray(application.destinations)) throw new Error('Access-Zielinventar unvollständig.')
    return application.destinations.filter(destination => destination.type === 'public')
  }
  if (application.self_hosted_domains != null && !Array.isArray(application.self_hosted_domains)) throw new Error('Access-Zielinventar unvollständig.')
  return [application.domain, ...(application.self_hosted_domains || [])].filter(Boolean).map(uri => ({ type: 'public', uri }))
}

function overlapsInternalHostname(uri, hostnames) {
  if (typeof uri !== 'string') throw new Error('Öffentliche Access-Zieladresse fehlt.')
  // Inspect all paths and Cloudflare's per-label hostname wildcards, also for the second domain.
  const hostname = uri.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase()
  const pattern = hostname.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^.]*')
  return hostnames.some(host => new RegExp(`^${pattern}$`).test(host))
}

// The display name is shared by installations in one account. Only effective
// destinations identify a candidate for this installation; exact paths/policy
// still need validatePublicParticipation. Unknown destinations cannot prove
// that a same-name application is disjoint and must fail closed.
export function isPublicParticipationCandidate(application, hostnames = internalHostnames) {
  if (application.name !== publicParticipationName) return false
  const destinations = publicDestinations(application)
  if (!destinations.length || (application.destinations != null && destinations.length !== application.destinations.length) ||
    destinations.some(destination => {
      if (typeof destination.uri !== 'string' || destination.uri.length > 512 || /[?#\s\\]/.test(destination.uri) ||
        (destination.overrides != null && (!Array.isArray(destination.overrides) || destination.overrides.length))) return true
      const [hostname] = destination.uri.split('/')
      return hostname.length > 253 || !hostname.includes('.') || hostname.split('.').some(label =>
        !label.length || label.length > 63 || !/^[a-z0-9*](?:[a-z0-9*-]*[a-z0-9*])?$/.test(label))
    })) throw new Error('Access-Zielinventar der Teilnahme-Anwendung unvollständig.')
  return destinations.some(destination => overlapsInternalHostname(destination.uri, hostnames))
}

export function validatePublicParticipation(application, policies, hostnames = internalHostnames) {
  const publicParticipationDestinations = participationDestinations(hostnames)
  const destinations = application.destinations
  if (application.type !== 'self_hosted' || application.name !== publicParticipationName ||
    !Array.isArray(destinations) || destinations.length !== publicParticipationDestinations.length ||
    new Set(destinations.map(destination => destination.uri)).size !== publicParticipationDestinations.length ||
    destinations.some(destination => destination.type !== 'public' || !publicParticipationDestinations.includes(destination.uri) ||
      (destination.overrides != null && (!Array.isArray(destination.overrides) || destination.overrides.length)))) {
    throw new Error('Die öffentliche Teilnahme-Anwendung muss genau die freigegebenen Pfadziele enthalten.')
  }
  if (policies !== undefined && (!Array.isArray(policies) || policies.length !== 1 || policies[0].decision !== 'bypass' ||
    policies[0].include?.length !== 1 || Object.keys(policies[0].include[0]).length !== 1 ||
    !policies[0].include[0].everyone || typeof policies[0].include[0].everyone !== 'object' || Array.isArray(policies[0].include[0].everyone) || Object.keys(policies[0].include[0].everyone).length !== 0 ||
    !['exclude', 'require'].every(key => policies[0][key] == null || (Array.isArray(policies[0][key]) && policies[0][key].length === 0)))) {
    throw new Error('Die öffentliche Teilnahme benötigt genau eine Bypass-Everyone-Regel ohne weitere Bedingungen.')
  }
}

export function validateAccessApplications(applications, applicationID, publicApplicationID, hostnames = internalHostnames) {
  if (!Array.isArray(applications) || !applications.some(app => app.id === applicationID)) throw new Error('Access-Anwendungsinventar unvollständig.')
  let publicApplication
  for (const app of applications) {
    if (app.id === applicationID) continue
    if (isPublicParticipationCandidate(app, hostnames) || (publicApplicationID && app.id === publicApplicationID)) {
      validatePublicParticipation(app, undefined, hostnames)
      if (!app.id || publicApplication || (publicApplicationID && app.id !== publicApplicationID)) throw new Error('Öffentliche Access-Anwendung ist nicht eindeutig zugeordnet.')
      publicApplication = app
    } else if (publicDestinations(app).some(destination => overlapsInternalHostname(destination.uri, hostnames))) {
      throw new Error('Eine weitere Access-Anwendung überschneidet sich mit einer internen Domain; Zugriffsregeln zuerst abgleichen.')
    }
  }
  if (publicApplicationID && !publicApplication) throw new Error('Konfigurierte öffentliche Access-Anwendung fehlt.')
  return publicApplication
}

export function validateAccess(application, policies, allowedEmails, hostnames = internalHostnames) {
  const approved = new Set(allowedEmails.map(email => email.toLowerCase()))
  const destinations = publicDestinations(application)
  if (!approved.size || application.type !== 'self_hosted' ||
    application.destinations?.some(destination => destination.type !== 'public') ||
    !hostnames.every(host => destinations.some(destination => destination.uri === host)) ||
    destinations.some(destination => !hostnames.includes(destination.uri) || (destination.overrides != null && (!Array.isArray(destination.overrides) || destination.overrides.length)))) {
    throw new Error('Cloudflare Access muss alle vollständigen konfigurierten Domains ohne öffentliche Ausnahmen mit ausdrücklich freigegebenen E-Mail-Adressen schützen.')
  }
  if (!policies.some(policy => policy.decision === 'allow')) throw new Error('Keine erlaubende Access-Regel vorhanden.')
  for (const policy of policies) {
    if (policy.decision === 'deny') continue
    if (policy.decision !== 'allow' || !policy.include?.length || !policy.include.every(rule =>
      Object.keys(rule).length === 1 && Object.keys(rule.email || {}).length === 1 &&
      typeof rule.email?.email === 'string' && approved.has(rule.email.email.toLowerCase()),
    )) throw new Error('Die interne Access-Anwendung darf ausschließlich die freigegebenen E-Mail-Adressen erlauben; Bypass- und Service-Regeln sind nicht vorgesehen.')
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{databaseID?: string, audience?: string, policyID?: string, hostnames?: string[], request?: typeof fetch, initialSetup?: boolean}} options
 */
export async function verifyAccess(env = process.env, { databaseID, audience, policyID, hostnames = internalHostnames, request = fetch, initialSetup = false } = {}) {
  env = { ...env, FORMS_ACCESS_APP_ID: env.PAYLOAD_FORMS_ACCESS_APP_ID || env.FORMS_ACCESS_APP_ID, FORMS_ALLOWED_EMAILS: env.PAYLOAD_FORMS_ALLOWED_EMAILS || env.FORMS_ALLOWED_EMAILS, FORMS_PUBLIC_ACCESS_APP_ID: env.PAYLOAD_FORMS_PUBLIC_ACCESS_APP_ID || env.FORMS_PUBLIC_ACCESS_APP_ID }
  const qaMachine = qaMachineInstallSettings({ ...env, ACCESS_APP_ID: env.FORMS_ACCESS_APP_ID,
    ACCESS_POLICY_ID: policyID, ACCESS_AUD: audience })
  if (qaMachine && (!audience || !policyID)) throw new Error('Explicit human audience and policy are required for the QA release preflight.')
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'FORMS_ACCESS_APP_ID', 'FORMS_ALLOWED_EMAILS']) {
    if (!env[name]) throw new Error(`${name} fehlt für die Prüfung des internen Zugangsschutzes.`)
  }
  const path = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/access/apps/${encodeURIComponent(env.FORMS_ACCESS_APP_ID)}`
  async function read(url, completeList = false) {
    const response = await request(url, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, redirect: 'manual', signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`Cloudflare Access konnte nicht geprüft werden (HTTP ${response.status}).`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Access-Prüfung unvollständig; Release gestoppt.')
    let bytes = 0; const chunks = []
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 1024 * 1024) throw new Error('Access-Prüfung zu groß; Release gestoppt.')
        chunks.push(value)
      }
    } finally { await reader.cancel() }
    let data
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new Error('Access-Prüfung unvollständig; Release gestoppt.') }
    if (!data.success || data.result_info?.total_pages > 1) throw new Error('Access-Prüfung unvollständig; Release gestoppt.')
    if (completeList) {
      const info = data.result_info
      if (!Array.isArray(data.result) || data.result.length > 100 || !info || info.page !== 1
        || info.total_count !== data.result.length || ![0, 1].includes(info.total_pages)
        || (info.total_pages === 0 && data.result.length !== 0)
        || (info.count !== undefined && info.count !== data.result.length)) {
        throw new Error('Access-Prüfung benötigt eine vollständig bestätigte begrenzte Inventarseite; Release gestoppt.')
      }
    }
    return data.result
  }
  const application = await read(path)
  if (qaMachine && application?.id !== env.FORMS_ACCESS_APP_ID) throw new Error('Access-Team-Anwendung ist nicht eindeutig zugeordnet.')
  const accountPath = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}`
  const applications = await read(`${accountPath}/access/apps?per_page=100`, Boolean(qaMachine))
  let checkedApplications = applications
  if (qaMachine) {
    const { verifyQAMachineRelease } = await import('./check-qa-release.mjs')
    checkedApplications = await verifyQAMachineRelease({ settings: qaMachine, applications, humanApplication: application,
      humanPolicyID: policyID, humanAudience: audience, publicApplicationID: env.FORMS_PUBLIC_ACCESS_APP_ID,
      hostnames, accountPath, read })
  }
  const publicApplication = validateAccessApplications(checkedApplications, env.FORMS_ACCESS_APP_ID, env.FORMS_PUBLIC_ACCESS_APP_ID, hostnames)
  const policies = await read(`${path}/policies?per_page=100`)
  if (!Array.isArray(policies)) throw new Error('Access-Regeln konnten nicht vollständig gelesen werden.')
  let approvedEmails = env.FORMS_ALLOWED_EMAILS.split(',').map(email => email.trim()).filter(Boolean)
  if (databaseID) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database/${encodeURIComponent(databaseID)}/query`
    async function query(sql) {
      const response = await request(url, { method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }), signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error(`Teamfreigabe konnte nicht geprüft werden (HTTP ${response.status}).`)
      const data = await response.json()
      if (!data.success || data.result?.length !== 1 || !data.result[0].success) throw new Error('D1-Teamfreigabe ist unvollständig.')
      return data.result[0].results
    }
    // The first release checks before applying this additive migration.
    const columns = await query("SELECT name FROM pragma_table_info('users')")
    const rows = columns.length ? await query(columns.some(column => column.name === 'enabled')
      ? 'SELECT email FROM users WHERE enabled = 1 ORDER BY email LIMIT 41' : 'SELECT email FROM users ORDER BY email LIMIT 41') : []
    if (!rows.length && initialSetup && columns.length && (await query('SELECT id FROM users LIMIT 1')).length) {
      throw new Error('Initial setup requires an empty team table; existing disabled accounts remain disabled.')
    }
    if (rows.length || !initialSetup) approvedEmails = rows.map(row => row.email?.toLowerCase())
    if (!approvedEmails.length || approvedEmails.length > 40 || approvedEmails.some(email => typeof email !== 'string')) throw new Error('Die Teamliste benötigt 1 bis 40 aktive Konten.')
  }
  validateAccess(application, policies, approvedEmails, hostnames)
  if (audience && application.aud !== audience) throw new Error('Access-Anmeldekennung stimmt nicht mit der geprüften Anwendung überein.')
  if (policyID && (policies.length !== 1 || policies[0].id !== policyID)) throw new Error('Access-Teamrichtlinie ist nicht eindeutig zugeordnet.')
  if (policyID) {
    const reusable = await read(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/access/policies/${encodeURIComponent(policyID)}`)
    if (reusable?.id !== policyID || reusable.app_count !== 1) {
      const count = Number.isSafeInteger(reusable?.app_count) && reusable.app_count >= 0 ? reusable.app_count : 'nicht bestätigt'
      throw new Error(`Die Access-Teamrichtlinie muss genau einer Anwendung zugeordnet sein (app_count: ${count}).`)
    }
  }
  if (databaseID) {
    const actual = [...new Set(policies.flatMap(policy => policy.decision === 'allow' ? policy.include.map(rule => rule.email.email.toLowerCase()) : []))].sort()
    if (JSON.stringify(actual) !== JSON.stringify([...new Set(approvedEmails)].sort())) throw new Error('Access und gespeicherte Teamzugänge sind noch nicht abgeglichen.')
  }
  if (publicApplication) {
    const publicPolicies = await read(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/access/apps/${encodeURIComponent(publicApplication.id)}/policies?per_page=100`)
    if (!Array.isArray(publicPolicies)) throw new Error('Öffentliche Access-Regeln konnten nicht vollständig gelesen werden.')
    validatePublicParticipation(publicApplication, publicPolicies, hostnames)
  }
  console.log('PASS: Cloudflare Access schützt alle konfigurierten Domains mit der freigegebenen E-Mail-Liste.')
  return { publicParticipation: Boolean(publicApplication), ...(qaMachine ? { qaMachine: qaMachine.enabled } : {}) }
}
