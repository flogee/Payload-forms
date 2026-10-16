import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { readInstallConfig, productionEnvironment, projectRoot, deploymentEnvironment } from './install-config.mjs'

// Deliberately bounded commands: callers cannot override the selected config/environment.
const commands = {
  build: ['opennextjs-cloudflare', ['build']],
  migrate: ['payload', ['migrate']],
  bootstrap: ['payload', ['run', 'scripts/bootstrap-internal.ts']],
}
try {
  const mode = process.argv[2]
  if (!commands[mode] || process.argv.length !== 3) throw new Error('Choose build, migrate or bootstrap; extra flags are forbidden.')
  const install = await readInstallConfig()
  const remote = mode !== 'build'
  const env = productionEnvironment(install, process.env, { remote })
  const [name, argv] = commands[mode]
  const args = remote ? argv : [...argv, '--config', install.configPath, '--env', deploymentEnvironment]
  const child = spawn(join(projectRoot, 'node_modules/.bin', name), args, { cwd: projectRoot, env, stdio: 'inherit' })
  child.once('error', error => { console.error(error.message); process.exitCode = 1 })
  child.once('exit', code => { process.exitCode = code ?? 1 })
} catch (error) { console.error(error.message); process.exitCode = 1 }
