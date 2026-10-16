import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`surveys_sections_questions\` ADD \`step\` numeric;`)
  await db.run(sql`ALTER TABLE \`surveys_sections_questions\` ADD \`low_label\` text;`)
  await db.run(sql`ALTER TABLE \`surveys_sections_questions\` ADD \`high_label\` text;`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Gespeicherte Skalenbeschriftungen und Schrittweiten dürfen nicht verloren gehen.')
}
