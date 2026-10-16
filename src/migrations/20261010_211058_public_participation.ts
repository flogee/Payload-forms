import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`public_request_usage\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`month\` text NOT NULL,
    \`reads\` numeric NOT NULL,
    \`submissions\` numeric NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`public_request_usage_month_idx\` ON \`public_request_usage\` (\`month\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`public_request_usage_id\` integer REFERENCES public_request_usage(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_public_request_usage_id_idx\` ON \`payload_locked_documents_rels\` (\`public_request_usage_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Öffentliche Teilnahmebudgets dürfen nicht zurückgesetzt werden.')
}
