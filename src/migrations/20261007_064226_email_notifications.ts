import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`response_notifications\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`response_id\` integer NOT NULL,
    \`survey_id\` integer NOT NULL,
    \`response_reference\` text NOT NULL,
    \`recipient\` text NOT NULL,
    \`status\` text NOT NULL,
    \`attempts\` numeric NOT NULL,
    \`last_error\` text,
    \`next_attempt_at\` text,
    \`claimed_at\` text,
    \`claim_token\` text,
    \`sent_at\` text,
    \`provider_message_id\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`response_id\`) REFERENCES \`responses\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`survey_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`response_notifications_response_idx\` ON \`response_notifications\` (\`response_id\`);`)
  await db.run(sql`CREATE INDEX \`response_notifications_survey_idx\` ON \`response_notifications\` (\`survey_id\`);`)
  await db.run(sql`CREATE INDEX \`response_notifications_updated_at_idx\` ON \`response_notifications\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`response_notifications_created_at_idx\` ON \`response_notifications\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`responseReference_recipient_idx\` ON \`response_notifications\` (\`response_reference\`,\`recipient\`);`)
  await db.run(sql`CREATE TABLE \`email_usage\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`month\` text NOT NULL,
    \`attempts\` numeric NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`email_usage_month_idx\` ON \`email_usage\` (\`month\`);`)
  await db.run(sql`CREATE INDEX \`email_usage_updated_at_idx\` ON \`email_usage\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`email_usage_created_at_idx\` ON \`email_usage\` (\`created_at\`);`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`notifications_enabled\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`notifications_recipients\` text;`)
  await db.run(sql`ALTER TABLE \`responses\` ADD \`notification_reference\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`responses_notification_reference_idx\` ON \`responses\` (\`notification_reference\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`response_notifications_id\` integer REFERENCES response_notifications(id) ON DELETE cascade;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`email_usage_id\` integer REFERENCES email_usage(id) ON DELETE cascade;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_response_notifications_id_idx\` ON \`payload_locked_documents_rels\` (\`response_notifications_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_email_usage_id_idx\` ON \`payload_locked_documents_rels\` (\`email_usage_id\`);`)
}

// Retain additive schema during code rollback: removing it would reset the
// send cap, discard delivery evidence and invalidate links in existing emails.
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau der E-Mail-Migration ist gesperrt. Versandwarteschlange, Budget und Wiederherstellung zuerst prüfen.')
}
