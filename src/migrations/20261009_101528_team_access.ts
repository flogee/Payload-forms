import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`team_access_monitor\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`desired_digest\` text NOT NULL,
    \`synced_emails\` text,
    \`attempted_emails\` text,
    \`status\` text NOT NULL,
    \`attempts\` numeric NOT NULL,
    \`checked_at\` text,
    \`synced_at\` text,
    \`last_error\` text,
    \`lease_token\` text,
    \`lease_until\` text
  );
  `)
  await db.run(sql`ALTER TABLE \`users\` ADD \`name\` text;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`role\` text DEFAULT 'editor' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`enabled\` integer DEFAULT true NOT NULL;`)
  // Existing accounts already managed the team; preserve that capability.
  await db.run(sql`UPDATE \`users\` SET \`role\` = 'admin';`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`team_access_monitor_id\` integer REFERENCES team_access_monitor(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_team_access_monitor_id_idx\` ON \`payload_locked_documents_rels\` (\`team_access_monitor_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Teamrechte und Sperren dürfen nicht zurückgesetzt werden.')
}
