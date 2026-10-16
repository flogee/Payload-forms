import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const payload = join(root, 'node_modules/payload')
const { version } = JSON.parse(await readFile(join(payload, 'package.json'), 'utf8'))
if (version !== '3.90.2') throw new Error('Review the Payload Forms password hashing patch before changing Payload versions')
const originals = {
  'generatePasswordSaltHash.js': '5feeb0cf504cc3effc68414115abfd6e3defd801060a18d9731254a77238ad06', // gitleaks:allow -- public upstream file SHA-256, not a credential
  'authenticate.js': '7da055edf5cf64ae4a18e6d66bbaed7584bcf954fa6a6166a8eb07711cc970fa', // gitleaks:allow -- public upstream file SHA-256, not a credential
}
const changes = []
// Verify every target before modifying any file. An unfamiliar upstream file
// fails installation instead of silently replacing authentication code.
for (const [name, expected] of Object.entries(originals)) {
  const target = join(payload, 'dist/auth/strategies/local', name)
  const current = await readFile(target)
  const replacement = await readFile(join(root, 'patches/payload-3.90.2-auth', name))
  if (current.equals(replacement)) continue
  if (createHash('sha256').update(current).digest('hex') !== expected) {
    throw new Error(`Payload authentication source differs from the reviewed version: ${name}`)
  }
  changes.push({ target, replacement })
}
for (const { target, replacement } of changes) await writeFile(target, replacement)
console.log('Payload 3.90.2 authentication patch verified: scrypt N=32768, r=8, p=3')
