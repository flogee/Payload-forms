import type { GetPlatformProxyOptions } from 'wrangler'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { validateInstallConfig, productionEnvironment } from '../../scripts/install-config.mjs'

type Environment = Record<string, string | undefined>

export function platformOptions(env: Environment, isCLI: boolean): GetPlatformProxyOptions {
  const remote = env.FORMS_D1_REMOTE === '1'
  if (remote && (!isCLI || env.CLOUDFLARE_ENV !== 'internal' || env.NODE_ENV !== 'production' || !env.PAYLOAD_FORMS_CONFIG)) {
    throw new Error('Entfernte D1-Zugriffe benötigen einen ausdrücklichen Produktions-CLI-Aufruf mit explizit ausgewählter Installationskonfiguration.')
  }
  if (remote && env.FORMS_LOCAL_D1_PATH) throw new Error('Lokale Datenbankpfade und entfernte D1-Zugriffe dürfen nicht kombiniert werden.')
  if (remote) {
    const install = { ...validateInstallConfig(JSON.parse(readFileSync(env.PAYLOAD_FORMS_CONFIG!, 'utf8'))), configPath: env.PAYLOAD_FORMS_CONFIG! }
    productionEnvironment(install, env, { remote: true })
  }
  return {
    environment: env.CLOUDFLARE_ENV,
    ...(env.PAYLOAD_FORMS_CONFIG ? { configPath: env.PAYLOAD_FORMS_CONFIG } : {}),
    remoteBindings: remote,
    ...(env.PAYLOAD_FORMS_CONFIG ? { envFiles: [join(dirname(env.PAYLOAD_FORMS_CONFIG), 'scripts/config/empty.env')] }
      : env.FORMS_LOCAL_D1_PATH ? { envFiles: [] } : {}),
    ...(env.FORMS_LOCAL_D1_PATH ? { persist: { path: env.FORMS_LOCAL_D1_PATH } } : {}),
  }
}

export function schemaPushAllowed(env: Environment, isCLI: boolean): boolean {
  return !isCLI && env.NODE_ENV !== 'production' && env.DISABLE_SCHEMA_PUSH !== '1'
}
