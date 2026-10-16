import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`image_storage_usage\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`reserved_bytes\` numeric NOT NULL,
    \`reserved_objects\` numeric NOT NULL
  );
  `)
  await db.run(sql`INSERT INTO image_storage_usage (id, reserved_bytes, reserved_objects) VALUES (1, 0, 0);`)
  await db.run(sql`CREATE TABLE \`image_request_usage\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`month\` text NOT NULL,
    \`reads\` numeric NOT NULL,
    \`writes\` numeric NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`image_request_usage_month_idx\` ON \`image_request_usage\` (\`month\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`image_storage_usage_id\` integer REFERENCES image_storage_usage(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`image_request_usage_id\` integer REFERENCES image_request_usage(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_image_storage_usage_id_idx\` ON \`payload_locked_documents_rels\` (\`image_storage_usage_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_image_request_usage_id_idx\` ON \`payload_locked_documents_rels\` (\`image_request_usage_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Bildkontingente dürfen nicht gelöscht oder zurückgesetzt werden.')
}
