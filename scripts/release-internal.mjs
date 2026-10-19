import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { verifyAccess } from './check-access.mjs'
import { verifyReleaseHosts } from './check-release-hosts.mjs'
import { verifyMailDestinations } from './check-mail-config.mjs'
import { readInstallConfig, projectRoot, deploymentEnvironment } from './install-config.mjs'
import { releaseOptions, releaseEnvironments } from './release-options.mjs'
import { verifyTransientMigrationSources } from './reviewed-sql-migrations.mjs'

const options = releaseOptions(process.argv.slice(2))
const install = await readInstallConfig()
const { internal, hostnames, database, configPath } = install
const environments = releaseEnvironments(install, options)
const env = environments.operations
if (options.runtimeSecretOnly && options.migrate) await verifyTransientMigrationSources()
if (!env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required for read-only preflight and explicitly requested release operations.')
const { publicParticipation } = await verifyAccess(env, { databaseID: database.database_id,
  audience: internal.vars.ACCESS_AUD, policyID: internal.vars.ACCESS_POLICY_ID, hostnames, initialSetup: options.bootstrap })
await verifyMailDestinations(internal, env)

async function run(executable, argv, options = {}) {
  const child = spawn(executable, argv, { cwd: projectRoot, env: options.env || env, stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
  let output = ''
  if (options.capture) child.stdout.on('data', chunk => { output += chunk.toString() })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Release step failed (${code}).`)))
  })
  return output
}
const bin = name => join(projectRoot, 'node_modules/.bin', name)
const selection = ['--config', configPath, '--env', deploymentEnvironment]
const secrets = JSON.parse(await run(bin('wrangler'), ['secret', 'list', ...selection], { capture: true }))
if (!secrets.some(secret => secret.name === 'ACCESS_SYNC_TOKEN')) throw new Error('Provision the restricted ACCESS_SYNC_TOKEN in the selected Worker first.')
if (!secrets.some(secret => secret.name === 'PAYLOAD_SECRET')) throw new Error('Provision the same stable PAYLOAD_SECRET in the selected Worker first; releases never create or rotate it.')
await run(bin('opennextjs-cloudflare'), ['build', ...selection], { env: environments.build })
await run(bin('wrangler'), ['deploy', ...selection, '--dry-run'])
if (options.migrate) {
  if (options.runtimeSecretOnly) {
    // Recheck immediately before invoking the reviewed SQL-only migration path.
    await verifyTransientMigrationSources()
    await run(bin('payload'), ['migrate'], { env: environments.migration })
  } else await run('npm', ['run', 'migrate:cloudflare'])
}
if (options.bootstrap) await run('npm', ['run', 'bootstrap:cloudflare'])
// No OpenNext cache bindings: deploying directly avoids an unnecessary remote D1 proxy.
await run(bin('wrangler'), ['deploy', ...selection])
await verifyReleaseHosts({ teamDomain: internal.vars.ACCESS_TEAM_DOMAIN, hostnames,
  probeSlug: internal.vars.RELEASE_PROBE_SLUG || 'sample', publicParticipation })
