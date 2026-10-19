import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`evaluation_runs\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`context_ref\` text NOT NULL,
    \`survey_id\` integer NOT NULL,
    \`version\` text NOT NULL,
    \`instrument\` text NOT NULL,
    \`status\` text NOT NULL,
    \`expires_at\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`survey_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE set null
  );`)
  await db.run(sql`CREATE UNIQUE INDEX \`evaluation_runs_key_idx\` ON \`evaluation_runs\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`evaluation_runs_survey_idx\` ON \`evaluation_runs\` (\`survey_id\`);`)
  await db.run(sql`CREATE INDEX \`evaluation_runs_updated_at_idx\` ON \`evaluation_runs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`evaluation_runs_created_at_idx\` ON \`evaluation_runs\` (\`created_at\`);`)
  await db.run(sql`ALTER TABLE \`responses\` ADD \`evaluation_run_id\` integer REFERENCES evaluation_runs(id);`)
  await db.run(sql`CREATE INDEX \`responses_evaluation_run_idx\` ON \`responses\` (\`evaluation_run_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`evaluation_runs_id\` integer REFERENCES evaluation_runs(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_evaluation_runs_id_idx\` ON \`payload_locked_documents_rels\` (\`evaluation_runs_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Durchlaufzuordnungen und Antwortnachweise müssen erhalten bleiben.')
}
