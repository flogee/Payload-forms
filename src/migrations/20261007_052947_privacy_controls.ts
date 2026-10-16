import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`response_contacts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`response_id\` integer NOT NULL,
    \`name\` text NOT NULL,
    \`email\` text NOT NULL,
    \`test_only\` integer DEFAULT false NOT NULL,
    \`privacy_receipt\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`response_id\`) REFERENCES \`responses\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`response_contacts_response_idx\` ON \`response_contacts\` (\`response_id\`);`)
  await db.run(sql`CREATE INDEX \`response_contacts_updated_at_idx\` ON \`response_contacts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`response_contacts_created_at_idx\` ON \`response_contacts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`response_erasure_logs\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`response_key\` text NOT NULL,
    \`survey_id\` integer NOT NULL,
    \`version\` text NOT NULL,
    \`reason\` text NOT NULL,
    \`erased_by_id\` integer NOT NULL,
    \`erased_at\` text NOT NULL,
    \`retention_until\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`survey_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`erased_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`response_erasure_logs_response_key_idx\` ON \`response_erasure_logs\` (\`response_key\`);`)
  await db.run(sql`CREATE INDEX \`response_erasure_logs_survey_idx\` ON \`response_erasure_logs\` (\`survey_id\`);`)
  await db.run(sql`CREATE INDEX \`response_erasure_logs_erased_by_idx\` ON \`response_erasure_logs\` (\`erased_by_id\`);`)
  await db.run(sql`CREATE INDEX \`response_erasure_logs_updated_at_idx\` ON \`response_erasure_logs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`response_erasure_logs_created_at_idx\` ON \`response_erasure_logs\` (\`created_at\`);`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_enabled\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_notice_version\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_controller_name\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_controller_address\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_contact_email\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_purpose\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_legal_basis\` text DEFAULT 'consent';`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_legal_basis_details\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_data_categories\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_recipients\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_international_transfers\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_retention\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_rights\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_complaint_authority\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_contact_mode\` text DEFAULT 'none';`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_contact_purpose\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_contact_retention\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_consent_text\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_contact_consent_text\` text;`)
  await db.run(sql`ALTER TABLE \`surveys\` ADD \`privacy_reviewed\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`responses\` ADD \`privacy_receipt\` text;`)
  await db.run(sql`ALTER TABLE \`responses\` ADD \`submission_digest\` text;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`response_contacts_id\` integer REFERENCES response_contacts(id) ON DELETE cascade;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`response_erasure_logs_id\` integer REFERENCES response_erasure_logs(id) ON DELETE cascade;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_response_contacts_id_idx\` ON \`payload_locked_documents_rels\` (\`response_contacts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_response_erasure_logs_id_idx\` ON \`payload_locked_documents_rels\` (\`response_erasure_logs_id\`);`)
}

// Code rollback can keep these additive columns. Removing the schema would also
// remove contact information, consent evidence and restore-suppression records.
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau der Datenschutzmigration ist gesperrt. Wiederherstellung und Betroffenenrechte zuerst anhand des gesicherten Datenbestands prüfen.')
}
