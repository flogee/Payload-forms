import { attemptMail } from './mail-attempt'
import type { ResponseDatabase } from './response-store'
import { mailPolicy, notificationMessage, type MailEnvironment } from './notifications'
import { cancelNotification, claimNotification, finishNotification, maintainNotifications, pendingNotifications } from './notification-store'

export async function dispatchNotifications(db: ResponseDatabase, env: MailEnvironment, now = new Date(), timeoutMs = 10000) {
  await maintainNotifications(db, now)
  const policy = mailPolicy(env)
  if (!policy.configured) return
  for (const pending of await pendingNotifications(db, now.toISOString())) {
    if (!policy.allowedRecipients.includes(pending.recipient)) {
      await cancelNotification(db, pending, now.toISOString())
      continue
    }
    const token = crypto.randomUUID()
    const job = await claimNotification(db, pending, token, now.toISOString(), policy.routineLimit)
    if (!job) continue
    const outcome = await attemptMail(env.EMAIL!, notificationMessage(policy.sender!, job.recipient, policy.origin!, job.response_reference), job.attempts, now, timeoutMs)
    await finishNotification(db, job.id, token, outcome.state, now.toISOString(), outcome)
  }
}
