import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectRoot, productionEnvironment, validateInstallConfig } from '../scripts/install-config.mjs'
import { releaseOptions, releaseEnvironments } from '../scripts/release-options.mjs'
import { verifyTransientMigrationSources } from '../scripts/reviewed-sql-migrations.mjs'
import { installFixture } from './install-fixture'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const stable = 'fixture-stable-release-key-'.repeat(2)
const install = () => ({ configPath: '/tmp/fixture/wrangler.install.jsonc', ...validateInstallConfig(installFixture()) })

test('release accepts only explicit known combinations and forbids transient bootstrap', () => {
  assert.deepEqual(releaseOptions([]), { migrate: false, bootstrap: false, runtimeSecretOnly: false })
  for (const argv of [['--migrate'], ['--bootstrap'], ['--migrate', '--bootstrap']]) assert.equal(releaseOptions(argv).runtimeSecretOnly, false)
  for (const argv of [['--runtime-secret-only'], ['--migrate', '--runtime-secret-only']]) {
    assert.equal(releaseOptions(argv).runtimeSecretOnly, true)
    assert.equal(releaseOptions(argv).bootstrap, false)
  }
  for (const argv of [['--skip-checks'], ['--runtime-secret-only=true'], ['--runtime-secret-only', '--bootstrap'], ['--bootstrap', '--migrate', '--runtime-secret-only']]) {
    assert.throws(() => releaseOptions(argv))
  }
})

test('default release still requires and propagates the supplied stable key', () => {
  const selected = install()
  assert.throws(() => productionEnvironment(selected, {}), /stable/)
  assert.throws(() => releaseEnvironments(selected, releaseOptions([]), {}), /stable/)
  const environments = releaseEnvironments(selected, releaseOptions(['--migrate', '--bootstrap']), { PAYLOAD_SECRET: stable })
  for (const env of Object.values(environments)) assert.equal(env.PAYLOAD_SECRET, stable)
})

test('explicit mode creates a fresh child-only key without mutating source environment or install config', async () => {
  const selected = install()
  const before = structuredClone(selected)
  const source = { CLOUDFLARE_API_TOKEN: 'fictional-deployment-token', QA_MACHINE_ENABLED: '1' }
  const sourceBefore = { ...source }
  const parentSecret = process.env.PAYLOAD_SECRET
  const options = releaseOptions(['--runtime-secret-only', '--migrate'])
  const first = releaseEnvironments(selected, options, source)
  const second = releaseEnvironments(selected, options, source)
  assert.match(first.build.PAYLOAD_SECRET, /^[a-f0-9]{96}$/)
  assert.notEqual(first.build.PAYLOAD_SECRET, second.build.PAYLOAD_SECRET)
  assert.equal(first.migration.PAYLOAD_SECRET, first.build.PAYLOAD_SECRET)
  assert.equal(first.migration.FORMS_D1_REMOTE, '1')
  assert.equal(first.build.FORMS_D1_REMOTE, '0')
  assert.equal(Object.hasOwn(first.operations, 'PAYLOAD_SECRET'), false)
  for (const env of Object.values(first)) {
    assert.equal(env.QA_MACHINE_ENABLED, '0')
    assert.equal(env.CLOUDFLARE_INCLUDE_PROCESS_ENV, 'false')
    assert.equal(env.PAYLOAD_FORMS_CONFIG, selected.configPath)
  }
  assert.deepEqual(selected, before)
  assert.deepEqual(source, sourceBefore)
  assert.equal(process.env.PAYLOAD_SECRET, parentSecret)
  for (const value of ['', stable]) assert.throws(() => releaseEnvironments(selected, options, { PAYLOAD_SECRET: value }), /Unset PAYLOAD_SECRET/)
  assert.throws(() => releaseEnvironments(selected, { ...options, bootstrap: true }, {}), /cannot bootstrap/)
})

test('transient migration config is pinned despite ambient config selection', async () => {
  const options = releaseOptions(['--runtime-secret-only','--migrate'])
  const reviewedConfig = join(projectRoot,'src/payload.config.ts')
  for (const path of ['', './src/payload.config.ts', '/tmp/unreviewed.config.ts']) {
    assert.throws(() => releaseEnvironments(install(),options,{PAYLOAD_CONFIG_PATH:path}), /exact reviewed PAYLOAD_CONFIG_PATH/)
  }
  for (const source of [{}, {PAYLOAD_CONFIG_PATH:reviewedConfig}]) {
    const { migration } = releaseEnvironments(install(),options,source)
    assert.equal(migration.PAYLOAD_CONFIG_PATH,reviewedConfig)
    const { findConfig } = await import(pathToFileURL(join(projectRoot,'node_modules/payload/dist/config/find.js')).href)
    const previous = process.env.PAYLOAD_CONFIG_PATH
    try { process.env.PAYLOAD_CONFIG_PATH = migration.PAYLOAD_CONFIG_PATH; assert.equal(findConfig(),reviewedConfig) }
    finally { if (previous === undefined) delete process.env.PAYLOAD_CONFIG_PATH; else process.env.PAYLOAD_CONFIG_PATH = previous }
  }
})

test('transient migrations fail closed on changed, missing or new executable sources and Payload versions', async () => {
  await verifyTransientMigrationSources()
  const root = await mkdtemp(join(tmpdir(), 'payload-reviewed-migrations-'))
  try {
    await cp(join(projectRoot, 'src/migrations'), join(root, 'src/migrations'), { recursive: true })
    await cp(join(projectRoot, 'src/payload.config.ts'), join(root, 'src/payload.config.ts'))
    await cp(join(projectRoot, 'package.json'), join(root, 'package.json'))
    for (const name of ['payload', '@payloadcms/db-d1-sqlite']) {
      await mkdir(join(root, 'node_modules', name), { recursive: true })
      await cp(join(projectRoot, 'node_modules', name, 'package.json'), join(root, 'node_modules', name, 'package.json'))
    }
    await mkdir(join(root, 'node_modules/payload/dist/bin'), { recursive: true })
    await cp(join(projectRoot, 'node_modules/payload/dist/bin/migrate.js'), join(root, 'node_modules/payload/dist/bin/migrate.js'))
    await verifyTransientMigrationSources(root)
    const migration = (await readdir(join(root, 'src/migrations'))).find(name => name.endsWith('.ts') && name !== 'index.ts')!
    for (const name of [`src/migrations/${migration}`, 'src/migrations/index.ts', 'src/payload.config.ts', 'node_modules/payload/dist/bin/migrate.js']) {
      const path = join(root, name)
      const original = await readFile(path)
      await writeFile(path, Buffer.concat([original, Buffer.from('\n// unreviewed change')]))
      await assert.rejects(verifyTransientMigrationSources(root), /sources or Payload version changed/)
      await writeFile(path, original)
    }
    for (const name of ['future.ts', 'future.js', 'index.js']) {
      const path = join(root, 'src/migrations', name)
      await writeFile(path, 'export async function up() {}')
      await assert.rejects(verifyTransientMigrationSources(root), /sources or Payload version changed/)
      await rm(path)
    }
    const path = join(root, 'src/migrations', migration)
    const original = await readFile(path)
    await rm(path)
    await assert.rejects(verifyTransientMigrationSources(root), /sources or Payload version changed/)
    await writeFile(path, original)
    for (const name of ['package.json', 'node_modules/payload/package.json', 'node_modules/@payloadcms/db-d1-sqlite/package.json']) {
      const path = join(root, name)
      const original = await readFile(path, 'utf8')
      await writeFile(path, original.replaceAll('3.90.2', '3.90.3'))
      await assert.rejects(verifyTransientMigrationSources(root), /sources or Payload version changed/)
      await writeFile(path, original)
    }
    await verifyTransientMigrationSources(root)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('release keeps preflight, secret inventory, dry-run and HTTPS checks around the isolated build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'payload-release-plan-'))
  try {
    await cp(join(projectRoot, 'scripts'), join(root, 'scripts'), { recursive: true })
    const releasePath = join(root, 'scripts/release-internal.mjs')
    const source = await readFile(releasePath, 'utf8')
    await writeFile(releasePath, source.replace("'./check-access.mjs'", "'./release-test-checks.mjs'")
      .replace("'./check-release-hosts.mjs'", "'./release-test-checks.mjs'").replace("'./check-mail-config.mjs'", "'./release-test-checks.mjs'"))
    await writeFile(join(root, 'scripts/release-test-checks.mjs'), `
      import { appendFileSync } from 'node:fs'
      const event = name => appendFileSync('events.jsonl', JSON.stringify({ name }) + '\\n')
      export const verifyAccess = async env => { if (env.PAYLOAD_SECRET) throw Error('Key reached preflight'); event('access'); return { publicParticipation: true } }
      export const verifyMailDestinations = async () => event('mail')
      export const verifyReleaseHosts = async () => event('https')
    `)
    await writeFile(join(root, 'package.json'), '{"type":"module"}')
    await writeFile(join(root, 'wrangler.install.jsonc'), JSON.stringify(installFixture()))
    await mkdir(join(root, 'node_modules/.bin'), { recursive: true })
    const mock = `#!/usr/bin/env node
      import { appendFileSync } from 'node:fs'
      import { basename } from 'node:path'
      const name = basename(process.argv[1]), args = process.argv.slice(2)
      appendFileSync('events.jsonl', JSON.stringify({ name, args, hasKey: !!process.env.PAYLOAD_SECRET }) + '\\n')
      if (args[0] === 'secret') console.log(JSON.stringify(['ACCESS_SYNC_TOKEN', 'PAYLOAD_SECRET'].filter(name => name !== process.env.MOCK_MISSING_SECRET).map(name => ({ name }))))
    `
    for (const name of ['wrangler', 'opennextjs-cloudflare']) await writeFile(join(root, 'node_modules/.bin', name), mock, { mode: 0o700 })
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: 'production', PUBLIC_GUARD_ENABLED: '1',
      PAYLOAD_FORMS_CONFIG: 'wrangler.install.jsonc', CLOUDFLARE_API_TOKEN: 'fictional-deployment-token' }
    const execFile = promisify(execFileCallback)
    const result = await execFile(process.execPath, ['scripts/release-internal.mjs', '--runtime-secret-only'], { cwd: root, env })
    assert.equal(result.stderr, '')
    const events = (await readFile(join(root, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(events.map(event => event.name), ['access', 'mail', 'wrangler', 'opennextjs-cloudflare', 'wrangler', 'wrangler', 'https'])
    assert.deepEqual(events[2].args.slice(0, 2), ['secret', 'list'])
    assert.equal(events[3].hasKey, true)
    for (const index of [2, 4, 5]) assert.equal(events[index].hasKey, false)
    assert.ok(events[4].args.includes('--dry-run'))
    assert.equal(events[5].args.includes('--dry-run'), false)
    assert.equal((await readFile(join(root, 'wrangler.install.jsonc'), 'utf8')).includes('PAYLOAD_SECRET'), false)
    for (const name of ['PAYLOAD_SECRET', 'ACCESS_SYNC_TOKEN']) {
      await rm(join(root, 'events.jsonl'))
      await assert.rejects(execFile(process.execPath, ['scripts/release-internal.mjs', '--runtime-secret-only'], { cwd: root, env: { ...env, MOCK_MISSING_SECRET: name } }))
      const events = await readFile(join(root, 'events.jsonl'), 'utf8')
      assert.equal(events.includes('opennextjs-cloudflare'), false)
      assert.equal(events.includes('deploy'), false)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
