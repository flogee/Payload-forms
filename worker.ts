// OpenNext generates this module during build; preserve its request handler.
// @ts-ignore Generated at build time.
import handler from './.open-next/worker.js'
import { accessMutationAllowed } from './src/auth/request-origin'
import { restartAccessLogin } from './src/auth/restart'
import { guardPublicParticipation } from './src/auth/public-participation'
import { reconcileTeamAccess } from './src/auth/team-sync'
import { dispatchBudgetAlerts } from './src/survey/budget-alerts'
import { dispatchNotifications } from './src/survey/notification-dispatch'
import { responseDatabase } from './src/survey/response-store'
import { dispatchRetentionReminders } from './src/survey/retention-reminders'
import { QA_MACHINE_PATH } from './src/auth/qa-machine'

export default {
  async fetch(request, env, ctx) {
    // Supply an explicit runtime default before OpenNext fills missing values
    // from build-time env. Removing an old opt-in must never inherit that build.
    env = { ...env, FORMS_REAL_SURVEYS_ENABLED: env.FORMS_REAL_SURVEYS_ENABLED === '1' ? '1' : '0' }
    // Only this exact API has its own non-human JWT boundary. Human mutation
    // origin checks remain unchanged everywhere else; no public bypass added.
    if (new URL(request.url).pathname === QA_MACHINE_PATH) return handler.fetch(request, env, ctx)
    if (env.ACCESS_LOGIN_ENABLED === '1' && !accessMutationAllowed(request)) return Response.json({ error: 'Ungültiger Ursprung.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
    const restart = restartAccessLogin(request, env.ACCESS_LOGIN_ENABLED === '1')
    if (restart) return restart
    const publicGuard = await guardPublicParticipation(request, env)
    if (publicGuard) return publicGuard
    return handler.fetch(request, env, ctx)
  },
  async scheduled(_event, env) {
    const db = responseDatabase({ db: { client: env.D1 } })
    try { await reconcileTeamAccess(db, env) } catch { console.error('TEAM_ACCESS_SYNC_FAILED') }
    try { await dispatchBudgetAlerts(db, env) } catch { console.error('BUDGET_ALERT_CHECK_FAILED') }
    await dispatchNotifications(db, env)
    try { await dispatchRetentionReminders(db, env) }
    catch { console.error('RETENTION_REMINDER_CHECK_FAILED') }
  },
} satisfies ExportedHandler<CloudflareEnv>
