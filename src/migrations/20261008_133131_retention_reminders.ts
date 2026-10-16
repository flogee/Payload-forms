import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`retention_reminders\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`reminder_key\` text NOT NULL,
    \`survey_id\` integer NOT NULL,
    \`period\` text NOT NULL,
    \`recipient\` text NOT NULL,
    \`status\` text NOT NULL,
    \`attempts\` numeric NOT NULL,
    \`within90\` numeric NOT NULL,
    \`within30\` numeric NOT NULL,
    \`overdue\` numeric NOT NULL,
    \`claim_token\` text,
    \`claimed_at\` text,
    \`next_attempt_at\` text,
    \`last_error\` text,
    \`provider_message_id\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`survey_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`retention_reminders_reminder_key_idx\` ON \`retention_reminders\` (\`reminder_key\`);`)
  await db.run(sql`CREATE INDEX \`retention_reminders_survey_idx\` ON \`retention_reminders\` (\`survey_id\`);`)
  await db.run(sql`CREATE INDEX \`retention_reminders_updated_at_idx\` ON \`retention_reminders\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`retention_reminders_created_at_idx\` ON \`retention_reminders\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`retention_reminder_monitor\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`checked_at\` text NOT NULL
  );
  `)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_retention_years\` numeric DEFAULT 0;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`retention_reminders_enabled\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`responses\` ADD \`retention_review_due_at\` text;`)
  await db.run(sql`CREATE INDEX \`responses_retention_review_due_at_idx\` ON \`responses\` (\`retention_review_due_at\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`retention_reminders_id\` integer REFERENCES retention_reminders(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`retention_reminder_monitor_id\` integer REFERENCES retention_reminder_monitor(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_retention_reminders_id_idx\` ON \`payload_locked_documents_rels\` (\`retention_reminders_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_retention_reminder_monitor_idx\` ON \`payload_locked_documents_rels\` (\`retention_reminder_monitor_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Gespeicherte Fristen und Erinnerungsprotokolle dürfen nicht zurückgesetzt werden.')
}
