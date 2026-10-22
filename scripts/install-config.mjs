import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configuredHostnames } from './public-access.mjs'
import { verifyMailConfig, realAddress } from './check-mail-config.mjs'
import { verifyImageConfig } from './check-image-config.mjs'
import { verifyPublicConfig } from './check-public-config.mjs'
import { qaMachineInstallSettings, qaMachineVariables } from './qa-machine-config.mjs'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const deploymentEnvironment = 'internal'
const placeholder = value => typeof value !== 'string' || /(?:replace|your-|example\.(?:com|org|net)|localhost|\.(?:invalid|test|example|local)(?:$|[/:]))/i.test(value)
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '') && !/^0+(?:-0+)*$/.test(value)
const accountID = value => /^[a-f0-9]{32}$/i.test(value || '') && !/^0+$/.test(value)

export function validateInstallConfig(config) {
  const internal = config.env?.[deploymentEnvironment]
  const hostnames = configuredHostnames(internal)
  const vars = internal.vars || {}
  const database = internal.d1_databases?.[0]
  if (config.main !== 'worker.ts' || (internal.main !== undefined && internal.main !== 'worker.ts') || placeholder(internal.name) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(internal.name) ||
    !accountID(internal.account_id) || internal.workers_dev !== false || internal.preview_urls !== false ||
    hostnames.some(placeholder) ||
    JSON.stringify((vars.SURVEY_ORIGINS || '').split(',').map(value => value.trim()).sort()) !== JSON.stringify(hostnames.map(host => `https://${host}`).sort()) ||
    vars.LOCAL_PROTOTYPE !== '0' || vars.DISABLE_SCHEMA_PUSH !== '1' ||
    !Number.isInteger(internal.limits?.cpu_ms) || internal.limits.cpu_ms < 1 || internal.limits.cpu_ms > 1000 ||
    internal.d1_databases?.length !== 1 || database?.binding !== 'D1' || !uuid(database.database_id) ||
    placeholder(database.database_name) || database.remote !== true ||
    placeholder(internal.r2_buckets?.[0]?.bucket_name)) {
    throw new Error('Install config requires real own account/resources, exact HTTPS origins, protected custom domains, bounded CPU and disabled schema push. Replace all example values.')
  }
  verifyMailConfig(internal)
  verifyImageConfig(internal)
  verifyPublicConfig(internal)
  // Offline schema only. An authorized release separately verifies the live
  // exact Access inventory; configuration validation never authorizes rollout.
  if (vars.FORMS_REAL_SURVEYS_ENABLED !== undefined && !['0', '1'].includes(vars.FORMS_REAL_SURVEYS_ENABLED)) throw new Error('FORMS_REAL_SURVEYS_ENABLED must be the string 0 or 1; omitted means disabled.')
  const qaMachine = qaMachineInstallSettings(vars)
  if (vars.ACCESS_LOGIN_ENABLED !== '1' || vars.ACCESS_SYNC_ENABLED !== '1' ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(vars.ACCESS_TEAM_DOMAIN || '') || placeholder(vars.ACCESS_TEAM_DOMAIN) ||
    !uuid(vars.ACCESS_APP_ID) || !uuid(vars.ACCESS_POLICY_ID) || !/^[a-f0-9]{64}$/i.test(vars.ACCESS_AUD || '') || /^0+$/.test(vars.ACCESS_AUD) ||
    vars.ACCESS_ACCOUNT_ID !== internal.account_id ||
    !vars.ACCESS_INITIAL_EMAILS?.split(',').length || vars.ACCESS_INITIAL_EMAILS.split(',').length > 40 ||
    vars.ACCESS_INITIAL_EMAILS.split(',').some(email => !realAddress(email.trim())) ||
    (vars.RELEASE_PROBE_SLUG && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(vars.RELEASE_PROBE_SLUG))) {
    throw new Error('Configure the own Access team domain, application, audience, sole reusable policy and initial email allowlist.')
  }
  const publicVars = new Set(['FORMS_REAL_SURVEYS_ENABLED', 'PUBLIC_GUARD_ENABLED', 'SURVEY_ORIGINS', 'LOCAL_PROTOTYPE', 'DISABLE_SCHEMA_PUSH',
    'MAIL_ENABLED', 'MAIL_FROM', 'MAIL_ORIGIN', 'MAIL_ALLOWED_RECIPIENTS', 'MAIL_MONTHLY_LIMIT', 'MAIL_LOCAL_TEST',
    'OPS_ALERT_RECIPIENT', 'ACCESS_LOGIN_ENABLED', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ACCESS_SYNC_ENABLED',
    'ACCESS_ACCOUNT_ID', 'ACCESS_APP_ID', 'ACCESS_POLICY_ID', 'ACCESS_INITIAL_EMAILS', 'RELEASE_PROBE_SLUG', ...qaMachineVariables])
  if (Object.keys(vars).some(key => !publicVars.has(key))) throw new Error('Only documented non-secret vars are permitted. Secrets belong in the Worker secret store and private environment.')
  return { internal, hostnames, database, qaMachine }
}

/** @param {Record<string, string | undefined>} env */
export async function readInstallConfig(env = process.env, root = projectRoot) {
  if (!env.PAYLOAD_FORMS_CONFIG) throw new Error('Select the install explicitly with PAYLOAD_FORMS_CONFIG=wrangler.install.jsonc.')
  const configPath = resolve(root, env.PAYLOAD_FORMS_CONFIG)
  // Keep all paths relative to the app root; Wrangler resolves main/assets from its config directory.
  if (dirname(configPath) !== resolve(root)) throw new Error('Install config must be in the project root so every tool resolves the same paths.')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  return { config, configPath, ...validateInstallConfig(config) }
}

/** @param {any} install
 * @param {Record<string, string | undefined>} env
 */
export function productionEnvironment(install, env = process.env, { remote = false } = {}) {
  if (typeof env.PAYLOAD_SECRET !== 'string' || env.PAYLOAD_SECRET.length < 32 || placeholder(env.PAYLOAD_SECRET)) {
    throw new Error('Provide the stable pre-provisioned PAYLOAD_SECRET (at least 32 characters). Production never generates or rotates it.')
  }
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== install.internal.account_id) throw new Error('Selected account differs from CLOUDFLARE_ACCOUNT_ID.')
  const selected = { ...env }
  const qaMachine = qaMachineInstallSettings(install.internal.vars)
  for (const key of Object.keys(selected)) if (/^(MAIL_|ACCESS_|QA_MACHINE_|FORMS_REAL_SURVEYS_ENABLED$|OPS_ALERT_|SURVEY_ORIGINS?$|FORMS_LOCAL_D1_PATH$|NEXT_DEV_WRANGLER_ENV$|CLOUDFLARE_ENV$|WRANGLER_ENV$)/.test(key)) delete selected[key]
  return { ...selected, ...install.internal.vars, FORMS_REAL_SURVEYS_ENABLED: install.internal.vars.FORMS_REAL_SURVEYS_ENABLED === '1' ? '1' : '0', QA_MACHINE_ENABLED: qaMachine?.enabled ? '1' : '0', PAYLOAD_SECRET: env.PAYLOAD_SECRET,
    PAYLOAD_FORMS_CONFIG: install.configPath, CLOUDFLARE_ACCOUNT_ID: install.internal.account_id,
    PAYLOAD_FORMS_ACCESS_APP_ID: install.internal.vars.ACCESS_APP_ID,
    PAYLOAD_FORMS_ALLOWED_EMAILS: install.internal.vars.ACCESS_INITIAL_EMAILS,
    NODE_ENV: 'production', CLOUDFLARE_ENV: deploymentEnvironment, NEXT_DEV_WRANGLER_ENV: deploymentEnvironment,
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', FORMS_D1_REMOTE: remote ? '1' : '0', OPEN_NEXT_DEPLOY: 'true' }
}
