import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot } from './install-config.mjs'

export async function setupInstall(mode, root = projectRoot) {
  if (mode === 'local') {
    await writeFile(join(root, '.env.local'), [
      `PAYLOAD_SECRET=${randomBytes(48).toString('hex')}`,
      'LOCAL_PROTOTYPE=0', 'FORMS_REAL_SURVEYS_ENABLED=0', 'SURVEY_ORIGIN=http://127.0.0.1:3212',
      'MAIL_ENABLED=1', 'MAIL_LOCAL_TEST=1', 'MAIL_ORIGIN=http://127.0.0.1:3212', 'MAIL_FROM=forms@localhost.invalid',
      'MAIL_ALLOWED_RECIPIENTS=notify@localhost.invalid,second@localhost.invalid',
      'OPS_ALERT_RECIPIENT=notify@localhost.invalid', 'MAIL_MONTHLY_LIMIT=500', '',
    ].join('\n'), { flag: 'wx', mode: 0o600 })
    return 'Created private .env.local with a fresh local-only secret. Run npm run dev; create the first local account in /admin. Mail is simulated.'
  }
  if (mode === 'cloudflare') {
    const example = await readFile(join(root, 'wrangler.jsonc'), 'utf8')
    await writeFile(join(root, 'wrangler.install.jsonc'), example, { flag: 'wx', mode: 0o600 })
    return 'Created wrangler.install.jsonc. Replace internal example values with your pre-provisioned account, resources, domains and verified addresses; select it with PAYLOAD_FORMS_CONFIG. Run npm run doctor:cloudflare. No resources were created.'
  }
  throw new Error('Choose local or cloudflare. Existing files are never overwritten; review them manually before rerunning setup.')
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(await setupInstall(process.argv[2])) }
  catch (error) { console.error(error.code === 'EEXIST' ? 'Configuration already exists; preserved without changes. Review the existing file.' : error.message); process.exitCode = 1 }
}
