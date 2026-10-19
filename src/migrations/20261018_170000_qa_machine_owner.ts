import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`evaluation_runs\` ADD \`integration_client\` text;`)
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Client-Eigentum darf nicht verloren gehen.')
}
