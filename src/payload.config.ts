import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { r2Storage } from '@payloadcms/storage-r2'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { getCloudflareContext, type CloudflareContext } from '@opennextjs/cloudflare'
import { buildConfig } from 'payload'
import { z } from 'zod'
import { configureUsers, staff } from './collections/Users'
import { TeamAccessMonitor } from './collections/TeamAccessMonitor'
import { Surveys } from './collections/Surveys'
import { Responses } from './collections/Responses'
import { EvaluationRuns } from './collections/EvaluationRuns'
import { ResponseContacts } from './collections/ResponseContacts'
import { ResponseErasureLogs } from './collections/ResponseErasureLogs'
import { ResponseNotifications } from './collections/ResponseNotifications'
import { EmailUsage } from './collections/EmailUsage'
import { Media } from './collections/Media'
import { BudgetAlerts, BudgetAlertMonitor } from './collections/BudgetAlerts'
import { RetentionReminders, RetentionReminderMonitor } from './collections/RetentionReminders'
import { ImageStorageUsage, ImageRequestUsage } from './collections/ImageBudgets'
import { PublicRequestUsage } from './collections/PublicRequestUsage'
import { QAMachineUsage } from './collections/QAMachineUsage'
import { budgetedImageBucket, IMAGE_PREFIX, IMAGE_LIMITS } from './survey/image-budget'
import { sample } from './survey/sample'
import { toStored } from './survey/storage'
import { forSharing } from './survey/analysis'
import { loadAnalysis } from './survey/analysis-load'
import { demoReport } from './survey/analysis-demo'
import { isTeamUser } from './auth/team'
import { safeBatches } from './survey/d1-batches'
import { preserveUnchangedSurveyArrays } from './survey/persist-update'
import { draftTools } from './survey/mcp'
import { platformOptions, schemaPushAllowed } from './survey/runtime'
const dirname = path.dirname(fileURLToPath(import.meta.url))
const isCLI = process.argv.some(v => fs.existsSync(v) && fs.realpathSync(v).endsWith(path.join('payload', 'bin.js')))
const local = process.env.LOCAL_PROTOTYPE === '1' && process.env.NODE_ENV !== 'production' && !isCLI
const getLocalOrCLIContext = async () => await import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(({ getPlatformProxy }) => getPlatformProxy(platformOptions(process.env, isCLI))) as CloudflareContext
let cloudflare: CloudflareContext
if (isCLI || process.env.NODE_ENV !== 'production') {
  cloudflare = await getLocalOrCLIContext()
} else {
  try {
    // The Worker already supplies its live context. The async OpenNext fallback
    // would instead open remote bindings during a Node production build.
    cloudflare = getCloudflareContext()
  } catch (error) {
    if (process.env.NEXT_RUNTIME !== 'nodejs') throw error
    cloudflare = await getLocalOrCLIContext()
  }
}
const log = (level: string, fn: typeof console.log) => (obj: object | string, msg?: string) => fn(JSON.stringify({ level, msg: typeof obj === 'string' ? obj : msg }))
const logger = { level: 'info', trace: log('trace', console.debug), debug: log('debug', console.debug), info: log('info', console.log), warn: log('warn', console.warn), error: log('error', console.error), fatal: log('fatal', console.error), silent: () => {} } as any
const database = sqliteD1Adapter({ binding: cloudflare.env.D1, push: schemaPushAllowed(process.env, isCLI) })
const mediaBucket = budgetedImageBucket(cloudflare.env.MEDIA, cloudflare.env.D1)
export const cloudflareEnvironment = { ...cloudflare.env, MEDIA: mediaBucket }
const initDatabase = database.init
database.init = args => {
  const adapter = initDatabase(args)
  adapter.updateOne = preserveUnchangedSurveyArrays(adapter.updateOne)
  const originalInsert = adapter.insert
  adapter.insert = async function (args) {
    if (!Array.isArray(args.values)) return originalInsert.call(this, args)
    const result = []
    for (const batch of safeBatches(args.values)) result.push(...await originalInsert.call(this, { ...args, values: batch }))
    return result
  }
  return adapter
}
export default buildConfig({
  admin: { user: 'users', importMap: { baseDir: dirname }, meta: { titleSuffix: '· Payload Forms' },
    components: {
      logout: { Button: '/components/AccessLogout#AccessLogout' },
      beforeLogin: [{ path: '/components/AccessLoginHelp#AccessLoginHelp', serverProps: { enabled: cloudflare.env.ACCESS_LOGIN_ENABLED === '1' } }],
    } },
  collections: [configureUsers(cloudflare.env), Surveys, EvaluationRuns, Responses, ResponseContacts, ResponseErasureLogs, ResponseNotifications, EmailUsage, Media, ImageStorageUsage, ImageRequestUsage, PublicRequestUsage, QAMachineUsage, BudgetAlerts, BudgetAlertMonitor, RetentionReminders, RetentionReminderMonitor, TeamAccessMonitor], editor: lexicalEditor(), graphQL: { disable: true },
  // Payload also sends entire questionnaire edits in the multipart _payload
  // field. Keep metadata bounded without rejecting the existing Sample definition.
  upload: { limits: { fileSize: IMAGE_LIMITS.fileBytes, files: 1, fields: 10, fieldSize: 1024 * 1024 }, abortOnLimit: true },
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: database,
  logger: process.env.NODE_ENV === 'production' ? logger : undefined,
  plugins: [r2Storage({ bucket: mediaBucket, collections: { media: { prefix: IMAGE_PREFIX } }, clientUploads: false }), mcpPlugin({
    // Automatic write-tool schema conversion uses dynamic evaluation, unavailable in Workers.
    collections: { surveys: { enabled: { find: true, create: false, update: false, delete: false }, description: 'Versionierte Fragebögen lesen. Für Entwürfe die eigenen createSurveyDraft/updateSurveyDraft-Werkzeuge verwenden. Keine Rohantworten.' } },
    overrideAuth: async (_req, resolve) => {
      const settings = await resolve()
      const surveys = settings.surveys && typeof settings.surveys === 'object' ? settings.surveys : {}
      return { ...settings, surveys: { ...surveys, create: false, update: false, delete: false } }
    },
    overrideApiKeyCollection: c => {
      const legacyPermissions = ['create', 'update'].map(name => ({ name, type: 'checkbox', admin: { hidden: true, readOnly: true }, access: { create: () => false, update: () => false } }))
      // Preserve existing DB columns and values; overrideAuth disables their obsolete tools.
      const disableDefaultTools = (fields: any[]): any[] => fields.map(field => ({ ...field, ...(field.name === 'surveys' ? { fields: [...field.fields, ...legacyPermissions] } : field.name === 'payload-mcp-tool' ? { fields: field.fields.map((tool: any) => ({ ...tool, defaultValue: false })) } : field.fields ? { fields: disableDefaultTools(field.fields) } : {}) }))
      return { ...c, fields: disableDefaultTools(c.fields), access: { ...c.access, create: staff, read: staff, update: staff, delete: () => false } }
    },
    mcp: { tools: [...draftTools, { name: 'surveyStatistics', description: 'Deskriptive Testauswertung einer gespeicherten Fragebogenfassung (surveyID), oder mit demo=true ein vollständig erfundenes Beispiel. Gleiche Berechnung wie die App, mit Zurückhaltung positiver Fallzahlen unter fünf einschließlich ergänzender Bezugsgrößen. Keine Freitexte, Namen, Kontaktdaten oder individuellen Zahlen. Antworten sind keine unabhängigen Organisationen. Kein Forschungsbericht.', parameters: z.object({ surveyID: z.number().int().positive().max(2147483647).optional(), demo: z.boolean().optional() }).shape,
      handler: async (args, req) => {
        if (!isTeamUser(req.user)) throw new Error('Teamzugang erforderlich.')
        if (args.demo !== true && args.surveyID == null) throw new Error('Fragebogenkennung erforderlich.')
        const report = args.demo === true ? demoReport() : await loadAnalysis(req.payload, Number(args.surveyID), { req })
        return { content: [{ type: 'text' as const, text: JSON.stringify(forSharing(report)) }] }
      }
    }] }
  })],
  onInit: async payload => {
    if (!local) return
    if (!(await payload.count({ collection: 'users' })).totalDocs) {
      if (!process.env.PROTOTYPE_ADMIN_PASSWORD) throw new Error('Lokales Testpasswort fehlt')
      await payload.create({ collection: 'users', data: { email: process.env.PROTOTYPE_ADMIN_EMAIL || 'prototype@localhost.invalid', password: process.env.PROTOTYPE_ADMIN_PASSWORD, role: 'admin', enabled: true } })
    }
    if (!(await payload.count({ collection: 'surveys' })).totalDocs) await payload.create({ collection: 'surveys', data: { title: 'Fictional sample questionnaire', slug: 'sample', phase: 'pretest', ...toStored(sample) } })
  }
})
