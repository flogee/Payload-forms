import { getPayload } from 'payload'
import config, { cloudflareEnvironment } from '@payload-config'
import { mediaStaff } from '@/collections/Media'
import { IMAGE_LIMITS } from '@/survey/image-budget'
import { budgetAlertStatus, budgetSnapshot } from '@/survey/budget-alerts'
import { responseDatabase } from '@/survey/response-store'
import { PUBLIC_LIMITS } from '@/survey/public-limits'

export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!mediaStaff({ req: { user } as any })) return Response.json({ error: 'Team-Anmeldung erforderlich.' }, { status: 401 })
  const headers = { 'Cache-Control': 'private, no-store' }, now = new Date(), db = responseDatabase(payload)
  try {
    const [{ month, used }, warnings] = await Promise.all([budgetSnapshot(db, now), budgetAlertStatus(db, cloudflareEnvironment, now)])
    return Response.json({ month, storage: { reservedBytes: used.storage, limitBytes: IMAGE_LIMITS.storageBytes, reservedObjects: used.objects, limitObjects: IMAGE_LIMITS.objects },
      reads: { used: used.reads, limit: IMAGE_LIMITS.monthlyReads }, writes: { used: used.writes, limit: IMAGE_LIMITS.monthlyWrites },
      mail: { used: used.mail, limit: warnings.mailUsedLimit },
      participation: { used: used.participation, limit: PUBLIC_LIMITS.reads }, submissions: { used: used.submissions, limit: PUBLIC_LIMITS.submissions }, warnings }, { headers })
  } catch {
    return Response.json({ error: 'Kontingentprüfung oder Warnstatus nicht verfügbar. Der automatische Warnversand kann gestört sein; bitte den Betrieb prüfen.' }, { status: 503, headers })
  }
}
