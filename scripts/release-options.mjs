import { randomBytes } from 'node:crypto'
import { productionEnvironment } from './install-config.mjs'

export function releaseOptions(argv) {
  const args = new Set(argv)
  for (const arg of args) if (!['--migrate', '--bootstrap', '--runtime-secret-only'].includes(arg)) throw new Error(`Unknown release option: ${arg}`)
  if (args.has('--runtime-secret-only') && args.has('--bootstrap')) throw new Error('--runtime-secret-only cannot bootstrap; bootstrap requires the stable PAYLOAD_SECRET.')
  return { migrate: args.has('--migrate'), bootstrap: args.has('--bootstrap'), runtimeSecretOnly: args.has('--runtime-secret-only') }
}

/** The transient key is child-process input only; never a Worker secret or config var.
 * @param {any} install
 * @param {{ runtimeSecretOnly: boolean, bootstrap: boolean }} options
 * @param {Record<string, string | undefined>} source
 */
export function releaseEnvironments(install, options, source = process.env) {
  if (options.runtimeSecretOnly && options.bootstrap) throw new Error('--runtime-secret-only cannot bootstrap; bootstrap requires the stable PAYLOAD_SECRET.')
  if (options.runtimeSecretOnly && source.PAYLOAD_SECRET !== undefined) throw new Error('Unset PAYLOAD_SECRET before choosing --runtime-secret-only; supplied stable and transient keys must not be ambiguous.')
  const input = options.runtimeSecretOnly ? { ...source, PAYLOAD_SECRET: randomBytes(48).toString('hex') } : source
  const build = productionEnvironment(install, input)
  const operations = { ...build }
  if (options.runtimeSecretOnly) delete operations.PAYLOAD_SECRET
  return { operations, build, migration: productionEnvironment(install, input, { remote: true }) }
}
