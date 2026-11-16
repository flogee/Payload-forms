import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`survey_corrections\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`survey_id\` integer NOT NULL,
  	\`corrected_by_id\` integer NOT NULL,
  	\`reason\` text NOT NULL,
  	\`status\` text NOT NULL,
  	\`before\` text NOT NULL,
  	\`after\` text NOT NULL,
  	\`before_hash\` text NOT NULL,
  	\`after_hash\` text NOT NULL,
  	\`edit_token\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`survey_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`corrected_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`survey_corrections_survey_idx\` ON \`survey_corrections\` (\`survey_id\`);`)
  await db.run(sql`CREATE INDEX \`survey_corrections_corrected_by_idx\` ON \`survey_corrections\` (\`corrected_by_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`survey_corrections_edit_token_idx\` ON \`survey_corrections\` (\`edit_token\`);`)
  await db.run(sql`CREATE INDEX \`survey_corrections_updated_at_idx\` ON \`survey_corrections\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`survey_corrections_created_at_idx\` ON \`survey_corrections\` (\`created_at\`);`)
  // Add the new relation without rebuilding existing lock rows or foreign keys.
  await db.run(sql`ALTER TABLE payload_locked_documents_rels ADD survey_corrections_id integer REFERENCES survey_corrections(id) ON DELETE cascade;`)
  await db.run(sql`CREATE INDEX payload_locked_documents_rels_survey_corrections_id_idx ON payload_locked_documents_rels (survey_corrections_id);`)
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Korrekturprotokolle müssen erhalten bleiben.')
}
