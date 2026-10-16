import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`budget_alerts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`alert_key\` text NOT NULL,
    \`metric\` text NOT NULL,
    \`period\` text NOT NULL,
    \`level\` text NOT NULL,
    \`used\` numeric NOT NULL,
    \`quota_limit\` numeric NOT NULL,
    \`status\` text NOT NULL,
    \`attempts\` numeric NOT NULL,
    \`claim_token\` text,
    \`claimed_at\` text,
    \`next_attempt_at\` text,
    \`last_error\` text,
    \`provider_message_id\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`budget_alerts_alert_key_idx\` ON \`budget_alerts\` (\`alert_key\`);`)
  await db.run(sql`CREATE INDEX \`budget_alerts_updated_at_idx\` ON \`budget_alerts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`budget_alerts_created_at_idx\` ON \`budget_alerts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`budget_alert_monitor\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`checked_at\` text NOT NULL
  );
  `)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`budget_alerts_id\` integer REFERENCES budget_alerts(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`budget_alert_monitor_id\` integer REFERENCES budget_alert_monitor(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_budget_alerts_id_idx\` ON \`payload_locked_documents_rels\` (\`budget_alerts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_budget_alert_monitor_id_idx\` ON \`payload_locked_documents_rels\` (\`budget_alert_monitor_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Warnprotokolle und dauerhafte Versandbegrenzungen dürfen nicht zurückgesetzt werden.')
}
