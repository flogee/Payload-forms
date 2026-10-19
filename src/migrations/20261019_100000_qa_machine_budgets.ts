import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`qa_machine_usage\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`scope\` text NOT NULL,
    \`month\` text NOT NULL,
    \`requests\` numeric NOT NULL CHECK (\`requests\` >= 0 AND typeof(\`requests\`) = 'integer'),
    \`reports\` numeric NOT NULL CHECK (\`reports\` >= 0 AND \`reports\` <= \`requests\` AND typeof(\`reports\`) = 'integer')
  );`)
  await db.run(sql`CREATE UNIQUE INDEX \`scope_month_idx\` ON \`qa_machine_usage\` (\`scope\`, \`month\`);`)
  await db.run(sql`ALTER TABLE \`budget_alerts\` ADD \`scope\` text NOT NULL DEFAULT '';`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`qa_machine_usage_id\` integer REFERENCES qa_machine_usage(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_qa_machine_usage_id_idx\` ON \`payload_locked_documents_rels\` (\`qa_machine_usage_id\`);`)
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. QA-Reservierungen und Warnstatus dürfen nicht verloren gehen.')
}
