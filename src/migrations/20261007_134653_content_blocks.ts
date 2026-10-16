import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`surveys_blocks_text\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`_path\` text NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`content\` text NOT NULL,
    \`block_name\` text,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`surveys_blocks_text_order_idx\` ON \`surveys_blocks_text\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`surveys_blocks_text_parent_id_idx\` ON \`surveys_blocks_text\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`surveys_blocks_text_path_idx\` ON \`surveys_blocks_text\` (\`_path\`);`)
  await db.run(sql`CREATE TABLE \`surveys_blocks_image\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`_path\` text NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`image_id\` integer NOT NULL,
    \`alt\` text NOT NULL,
    \`caption\` text,
    \`block_name\` text,
    FOREIGN KEY (\`image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`surveys_blocks_image_order_idx\` ON \`surveys_blocks_image\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`surveys_blocks_image_parent_id_idx\` ON \`surveys_blocks_image\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`surveys_blocks_image_path_idx\` ON \`surveys_blocks_image\` (\`_path\`);`)
  await db.run(sql`CREATE INDEX \`surveys_blocks_image_image_idx\` ON \`surveys_blocks_image\` (\`image_id\`);`)
  await db.run(sql`CREATE TABLE \`surveys_blocks_text_2\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`_path\` text NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`after_question\` text,
    \`content\` text NOT NULL,
    \`block_name\` text,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`surveys_blocks_text_2_order_idx\` ON \`surveys_blocks_text_2\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`surveys_blocks_text_2_parent_id_idx\` ON \`surveys_blocks_text_2\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`surveys_blocks_text_2_path_idx\` ON \`surveys_blocks_text_2\` (\`_path\`);`)
  await db.run(sql`CREATE TABLE \`surveys_blocks_image_2\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`_path\` text NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`after_question\` text,
    \`image_id\` integer NOT NULL,
    \`alt\` text NOT NULL,
    \`caption\` text,
    \`block_name\` text,
    FOREIGN KEY (\`image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`surveys_blocks_image_2_order_idx\` ON \`surveys_blocks_image_2\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`surveys_blocks_image_2_parent_id_idx\` ON \`surveys_blocks_image_2\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`surveys_blocks_image_2_path_idx\` ON \`surveys_blocks_image_2\` (\`_path\`);`)
  await db.run(sql`CREATE INDEX \`surveys_blocks_image_2_image_idx\` ON \`surveys_blocks_image_2\` (\`image_id\`);`)
  await db.run(sql`CREATE TABLE \`media\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`prefix\` text DEFAULT 'forms-images',
    \`_objectkey\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`url\` text,
    \`thumbnail_u_r_l\` text,
    \`filename\` text,
    \`mime_type\` text,
    \`filesize\` numeric,
    \`width\` numeric,
    \`height\` numeric
  );
  `)
  await db.run(sql`CREATE INDEX \`media_updated_at_idx\` ON \`media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`media_created_at_idx\` ON \`media\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_filename_idx\` ON \`media\` (\`filename\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`media_id\` integer REFERENCES media(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error("Automatischer Rückbau ist gesperrt. Bilddateien, gestartete Fassungen und Sicherungen zuerst prüfen.");
}
