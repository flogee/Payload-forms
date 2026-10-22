import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectRoot, readInstallConfig, productionEnvironment } from './install-config.mjs'

try {
  const mode = process.argv[2]
  if (mode === 'cloudflare') {
    const install = await readInstallConfig()
    productionEnvironment(install)
    console.log(`Real surveys: ${install.internal.vars.FORMS_REAL_SURVEYS_ENABLED === '1' ? 'operator-enabled; each live version still requires complete reviewed privacy settings' : 'disabled (default)'}. QA/evaluation runs remain fictional only.`)
    console.log('PASS: selected production configuration and stable secret are present; budgets, warnings, origins and Access scope validated offline.')
    console.log('Before release: provision the same PAYLOAD_SECRET and ACCESS_SYNC_TOKEN in this Worker, verify sender/domain DNS and recipient delivery, confirm private EU R2 and backup D1 before migrations. Release verifies Access, recipient verification and Worker secret names online.')
  } else if (mode === 'local') {
    await access(join(projectRoot, 'node_modules'))
    const env = await readFile(join(projectRoot, '.env.local'), 'utf8')
    if (!/^PAYLOAD_SECRET=.{32,}$/m.test(env)) throw new Error('Run npm run setup:local to prepare a local secret.')
    console.log('PASS: local dependencies and private local secret exist. Local development uses simulated bindings and mail.')
  } else throw new Error('Choose local or cloudflare.')
} catch (error) { console.error(error.message); process.exitCode = 1 }
