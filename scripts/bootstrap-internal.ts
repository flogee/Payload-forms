import { getPayload } from 'payload'
import { ensureInitialAdmin } from '../src/auth/bootstrap'
import config from '../src/payload.config'
import { sample } from '../src/survey/sample'
import { toStored } from '../src/survey/storage'

// Run deliberately through `payload run`; startup never seeds a remote database.
if (process.env.FORMS_D1_REMOTE !== '1' || process.env.CLOUDFLARE_ENV !== 'internal' || process.env.NODE_ENV !== 'production' || !process.env.PAYLOAD_FORMS_CONFIG) {
  throw new Error('Dieser Einrichtungsaufruf ist ausschließlich für die ausdrücklich gewählte interne D1-Umgebung vorgesehen.')
}
const payload = await getPayload({ config })
try {
  const admin = await ensureInitialAdmin(payload, process.env.ACCESS_INITIAL_EMAILS)
  console.log(admin === 'created' ? 'Initial administrator provisioned for the configured Access identity.' : 'Existing team accounts preserved.')
  const existing = await payload.find({ collection: 'surveys', where: { slug: { equals: 'sample' } }, limit: 1, depth: 0 })
  if (existing.docs.length) {
    console.log('Vorhandene Beispielfassung erhalten; keine Änderungen vorgenommen.')
  } else {
    await payload.create({ collection: 'surveys', data: { title: 'Sample questionnaire', slug: 'sample', phase: 'pretest', ...toStored(sample) } })
    console.log('Beispielfragebogen als interne Fassung ausschließlich für Testdaten eingerichtet.')
  }
  console.log('Open /admin through Access using the configured administrator email.')
} finally {
  await payload.destroy()
}
