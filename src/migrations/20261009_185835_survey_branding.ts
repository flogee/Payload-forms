import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`branding_mode\` text DEFAULT 'default';`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`branding_text\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`branding_logo_id\` integer REFERENCES media(id);`)
  await db.run(sql`CREATE INDEX \`surveys_branding_branding_logo_idx\` ON \`surveys\` (\`branding_logo_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Gespeicherte Kopfzeilen und Logoreferenzen dürfen nicht verloren gehen.')
}
