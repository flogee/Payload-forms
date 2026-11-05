import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

// Additive only: preserve all prior tables, foreign keys, answers and receipts.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE surveys ADD privacy_contact_consent_mode text DEFAULT 'separate';`)
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Gespeicherte Einwilligungsfassungen müssen erhalten bleiben.')
}
