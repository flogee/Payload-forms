import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { installFixture } from '../tests/install-fixture.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const secret = randomBytes(48).toString('hex')
const password = `ä§!🔒-${randomBytes(32).toString('hex')}`
const sanitize = (value) => String(value).replaceAll(secret, '[redacted]').replaceAll(password, '[redacted]')
const controller = new AbortController()
const processes = []
let temporary
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => controller.abort(new Error(`Interrupted by ${signal}`)))
}

// Keep inherited deployment settings and credentials out of all local subprocesses.
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(CLOUDFLARE_|CF_|FORMS_|ACCESS_|QA_MACHINE_|PAYLOAD_|MAIL_|OPS_ALERT_|PROTOTYPE_ADMIN_|LOCAL_PROTOTYPE$|DISABLE_SCHEMA_PUSH$|SURVEY_ORIGINS?$|TEST_BASE_URL$|TEST_SECOND_ORIGIN$|TEST_SCHEDULED$|NODE_ENV$)/.test(key),
))

async function copySource(destination) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  }).split('\0').filter(Boolean)
  for (const file of new Set(files)) {
    const segments = file.split('/')
    if (segments.some((part) => ['node_modules', '.git', '.worktrees', '.next', '.open-next', '.wrangler'].includes(part)
      || /^\.env(?:\.|$)/.test(part) || /^\.dev\.vars(?:\.|$)/.test(part))) continue
    const source = join(root, file)
    let stat
    try { stat = await lstat(source) } catch (error) {
      if (error.code === 'ENOENT') continue // Include working-tree deletions as well as edits.
      throw error
    }
    if (!stat.isFile()) throw new Error(`Source must be a regular file: ${file}`)
    await mkdir(dirname(join(destination, file)), { recursive: true })
    await copyFile(source, join(destination, file))
  }
  // Next's standalone tracing must see dependencies inside this disposable tree.
  // Reflink where supported; preserve npm's relative bin symlinks.
  await cp(await realpath(join(root, 'node_modules')), join(destination, 'node_modules'), {
    recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
  })
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

function launch(label, executable, args, cwd, env) {
  controller.signal.throwIfAborted()
  const child = spawn(executable, args, {
    cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const state = { label, child, log: '', finished: false, result: null }
  processes.push(state)
  const capture = (chunk) => { state.log = (state.log + chunk.toString()).slice(-32768) }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  state.done = new Promise((resolve) => {
    child.once('error', (error) => {
      state.finished = true
      state.result = { error }
      resolve(state.result)
    })
    child.once('exit', (code, signal) => {
      state.finished = true
      state.result = { code, signal }
      resolve(state.result)
    })
  })
  return state
}

function killGroup(state, signal) {
  if (!state.child.pid) return
  try { process.kill(-state.child.pid, signal) } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function stop(state) {
  if (state.stopped) return
  // Also signal descendants when their original parent has already exited.
  killGroup(state, 'SIGTERM')
  if (!state.finished) await Promise.race([state.done, delay(5000)])
  killGroup(state, 'SIGKILL')
  if (!state.finished) await Promise.race([state.done, delay(1000)])
  state.stopped = true
}

function failure(state, reason) {
  return new Error(`${state.label}: ${reason}\n${sanitize(state.log).slice(-12000)}`)
}

async function run(label, executable, args, cwd, env, timeout = 180000) {
  const state = launch(label, executable, args, cwd, env)
  const deadline = Date.now() + timeout
  while (!state.finished) {
    controller.signal.throwIfAborted()
    if (Date.now() > deadline) throw failure(state, 'timed out')
    await delay(200, undefined, { signal: controller.signal })
  }
  if (state.result.error || state.result.code !== 0) {
    throw failure(state, state.result.error?.message || `exited with ${state.result.code ?? state.result.signal}`)
  }
  console.log(`PASS: ${label}`)
}

async function ready(state, origin) {
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    controller.signal.throwIfAborted()
    if (state.finished) throw failure(state, 'server exited before readiness')
    try {
      const response = await fetch(origin, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) })
      await response.body?.cancel()
      if (response.ok) {
        if (state.finished) throw failure(state, 'server exited during readiness')
        return
      }
    } catch (error) {
      controller.signal.throwIfAborted()
      if (state.finished) throw failure(state, error.message)
    }
    await delay(500, undefined, { signal: controller.signal })
  }
  throw failure(state, 'readiness timed out')
}

try {
  temporary = await mkdtemp(join(tmpdir(), 'payload-forms-ci-'))
  const source = join(temporary, 'source')
  const persistence = join(temporary, 'd1')
  const workerPersistence = join(temporary, 'd1-worker')
  await mkdir(source)
  await mkdir(persistence)
  await copySource(source)
  const env = {
    ...inherited,
    CI: '1', NEXT_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false',
    PAYLOAD_SECRET: secret, FORMS_REAL_SURVEYS_ENABLED: '1',
    PROTOTYPE_ADMIN_EMAIL: 'prototype@localhost.invalid',
    PROTOTYPE_ADMIN_PASSWORD: password,
    // getPlatformProxy takes the versioned Miniflare root directly; Wrangler's
    // --persist-to takes its parent and appends /v3.
    FORMS_LOCAL_D1_PATH: join(persistence, 'v3'), FORMS_D1_REMOTE: '0',
    MAIL_ENABLED: '1', MAIL_FROM: 'forms@localhost.invalid', MAIL_ALLOWED_RECIPIENTS: 'notify@localhost.invalid,second@localhost.invalid',
    OPS_ALERT_RECIPIENT: 'notify@localhost.invalid', MAIL_MONTHLY_LIMIT: '5', MAIL_LOCAL_TEST: '1', TEST_SCHEDULED: '0',
  }
  const devPort = await freePort()
  const devOrigin = `http://127.0.0.1:${devPort}`
  await run('fresh local D1 migrations', join(source, 'node_modules/.bin/payload'), ['migrate'], source,
    { ...env, NODE_ENV: 'production', LOCAL_PROTOTYPE: '0', DISABLE_SCHEMA_PUSH: '1' })
  // Both runtimes must create their first account on a fresh database. Sharing
  // the seeded development DB previously hid first-registration failures.
  await cp(persistence, workerPersistence, { recursive: true })
  const devSecondOrigin = `http://localhost:${devPort}`
  const devEnv = { ...env, LOCAL_PROTOTYPE: '0', DISABLE_SCHEMA_PUSH: '1', SURVEY_ORIGIN: devOrigin, SURVEY_ORIGINS: `${devOrigin},${devSecondOrigin}`, MAIL_ORIGIN: devOrigin }
  const dev = launch('Next development server', join(source, 'node_modules/.bin/next'),
    ['dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(devPort)], source, devEnv)
  await ready(dev, devOrigin)
  // The full suite cold-compiles Payload/MCP, live consent and editor routes.
  // Five minutes repeatedly expired on slower private hosted runners despite
  // passing assertions. Keep a bounded ten-minute phase for the same checks.
  await run('development HTTP checks', process.execPath, ['--import', 'tsx', 'tests/http-check.ts'],
    source, { ...devEnv, TEST_BASE_URL: devOrigin, TEST_SECOND_ORIGIN: devSecondOrigin, TEST_FIRST_USER: '1' }, 600000)
  await stop(dev)

  const buildEnv = { ...env, LOCAL_PROTOTYPE: '0', DISABLE_SCHEMA_PUSH: '1', SURVEY_ORIGIN: devOrigin, SURVEY_ORIGINS: `${devOrigin},${devSecondOrigin}` }
  // Exercise the actual installer command with valid, entirely fictional
  // resources. No provider token is inherited; build bindings must stay local.
  const installation = installFixture()
  installation.env.internal.vars.FORMS_REAL_SURVEYS_ENABLED = '1'
  await writeFile(join(source, 'wrangler.install.jsonc'), JSON.stringify(installation), { mode: 0o600 })
  await run('installation Worker build with local D1 bindings', 'npm', ['run', 'build:cloudflare'],
    source, { ...buildEnv, PAYLOAD_FORMS_CONFIG: 'wrangler.install.jsonc' }, 600000)
  const workerPort = await freePort()
  const workerOrigin = `http://127.0.0.1:${workerPort}`
  const workerSecondOrigin = `http://localhost:${workerPort}`
  const workerEnv = { ...buildEnv, FORMS_LOCAL_D1_PATH: join(workerPersistence, 'v3'), SURVEY_ORIGIN: workerOrigin, SURVEY_ORIGINS: `${workerOrigin},${workerSecondOrigin}`, MAIL_ORIGIN: workerOrigin, TEST_SCHEDULED: '1' }
  const workerArgs = [
    'dev', '--local', '--test-scheduled', '--ip', '127.0.0.1', '--port', String(workerPort), '--persist-to', workerPersistence,
    '--var', `PAYLOAD_SECRET:${secret}`, '--var', `SURVEY_ORIGIN:${workerOrigin}`, '--var', `SURVEY_ORIGINS:${workerEnv.SURVEY_ORIGINS}`,
    '--var', 'FORMS_REAL_SURVEYS_ENABLED:1', '--var', 'LOCAL_PROTOTYPE:0', '--var', 'DISABLE_SCHEMA_PUSH:1', '--var', 'FORMS_D1_REMOTE:0',
    '--var', 'MAIL_ENABLED:1', '--var', 'MAIL_FROM:forms@localhost.invalid', '--var', `MAIL_ORIGIN:${workerOrigin}`,
    '--var', `MAIL_ALLOWED_RECIPIENTS:${workerEnv.MAIL_ALLOWED_RECIPIENTS}`, '--var', 'OPS_ALERT_RECIPIENT:notify@localhost.invalid', '--var', 'MAIL_MONTHLY_LIMIT:5', '--var', 'MAIL_LOCAL_TEST:1',
  ]
  const worker = launch('local Worker runtime', join(source, 'node_modules/.bin/wrangler'), workerArgs, source, workerEnv)
  await ready(worker, workerOrigin)
  await run('Worker HTTP checks', process.execPath, ['--import', 'tsx', 'tests/http-check.ts'],
    source, { ...workerEnv, TEST_BASE_URL: workerOrigin, TEST_SECOND_ORIGIN: workerSecondOrigin, TEST_FIRST_USER: '1' })
  await stop(worker)
  // Keep the enabled build and persisted live fixture. Shut collection down
  // with explicit off, malformed, and truly absent runtime bindings.
  for (const runtimeFlag of ['0', 'true', undefined]) {
    const disabledEnv = { ...workerEnv }
    let disabledArgs = workerArgs.map(value => value === 'FORMS_REAL_SURVEYS_ENABLED:1' ? `FORMS_REAL_SURVEYS_ENABLED:${runtimeFlag}` : value)
    if (runtimeFlag === undefined) {
      delete disabledEnv.FORMS_REAL_SURVEYS_ENABLED
      const runtimeConfig = JSON.parse(await readFile(join(source, 'wrangler.jsonc'), 'utf8'))
      delete runtimeConfig.vars?.FORMS_REAL_SURVEYS_ENABLED
      for (const environment of Object.values(runtimeConfig.env || {})) delete environment.vars?.FORMS_REAL_SURVEYS_ENABLED
      const runtimePath = join(source, 'wrangler.runtime-missing.jsonc')
      await writeFile(runtimePath, JSON.stringify(runtimeConfig))
      const flagIndex = disabledArgs.indexOf('FORMS_REAL_SURVEYS_ENABLED:undefined')
      if (flagIndex < 1 || disabledArgs[flagIndex - 1] !== '--var') throw new Error('Expected explicit runtime flag pair')
      disabledArgs.splice(flagIndex - 1, 2)
      disabledArgs.push('--config', runtimePath)
    } else disabledEnv.FORMS_REAL_SURVEYS_ENABLED = runtimeFlag
    const disabledWorker = launch(`runtime-disabled Worker (${runtimeFlag ?? 'missing'})`, join(source, 'node_modules/.bin/wrangler'),
      disabledArgs, source, disabledEnv)
    await ready(disabledWorker, workerOrigin)
    await run(`real-survey runtime shutdown checks (${runtimeFlag ?? 'missing'})`, process.execPath, ['--import', 'tsx', 'tests/http-real-disabled.ts'],
      source, { ...disabledEnv, TEST_BASE_URL: workerOrigin })
    await stop(disabledWorker)
  }
  console.log('PASS: disposable local development and Worker integration checks')
} catch (error) {
  console.error(sanitize(error.stack || error))
  for (const state of processes.filter((item) => !item.finished)) {
    console.error(`${state.label} (last output):\n${sanitize(state.log).slice(-8000)}`)
  }
  process.exitCode = 1
} finally {
  await Promise.allSettled(processes.map(stop))
  if (temporary) await rm(temporary, { recursive: true, force: true })
}
