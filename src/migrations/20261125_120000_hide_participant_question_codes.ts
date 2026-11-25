import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE surveys ADD COLUMN hide_question_codes integer DEFAULT false`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Anzeigeeinstellungen müssen erhalten bleiben.')
}
