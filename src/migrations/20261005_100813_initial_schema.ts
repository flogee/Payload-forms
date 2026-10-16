import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`users_sessions\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`created_at\` text,
    \`expires_at\` text NOT NULL,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_sessions_order_idx\` ON \`users_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`users_sessions_parent_id_idx\` ON \`users_sessions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`users\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`email\` text NOT NULL,
    \`reset_password_token\` text,
    \`reset_password_expiration\` text,
    \`salt\` text,
    \`hash\` text,
    \`reset_password_requested_at\` text,
    \`login_attempts\` numeric DEFAULT 0,
    \`lock_until\` text
  );
  `)
  await db.run(sql`CREATE INDEX \`users_updated_at_idx\` ON \`users\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`users_created_at_idx\` ON \`users\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_email_idx\` ON \`users\` (\`email\`);`)
  await db.run(sql`CREATE TABLE \`surveys_introduction\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`text\` text NOT NULL,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`surveys_introduction_order_idx\` ON \`surveys_introduction\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`surveys_introduction_parent_id_idx\` ON \`surveys_introduction\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`surveys_sections_questions_options\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` text NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`value\` text,
    \`label\` text,
    \`exclusive\` integer,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`surveys_sections_questions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`surveys_sections_questions_options_order_idx\` ON \`surveys_sections_questions_options\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`surveys_sections_questions_options_parent_id_idx\` ON \`surveys_sections_questions_options\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`surveys_sections_questions_rows\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` text NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text,
    \`label\` text,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`surveys_sections_questions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`surveys_sections_questions_rows_order_idx\` ON \`surveys_sections_questions_rows\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`surveys_sections_questions_rows_parent_id_idx\` ON \`surveys_sections_questions_rows\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`surveys_sections_questions\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` text NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`code\` text NOT NULL,
    \`block\` text NOT NULL,
    \`label\` text NOT NULL,
    \`kind\` text NOT NULL,
    \`help\` text,
    \`optional\` integer,
    \`allow_n_a\` integer,
    \`min\` numeric,
    \`max\` numeric,
    \`show_if\` text,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`surveys_sections\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`surveys_sections_questions_order_idx\` ON \`surveys_sections_questions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`surveys_sections_questions_parent_id_idx\` ON \`surveys_sections_questions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`surveys_sections\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`title\` text NOT NULL,
    \`description\` text,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`surveys_sections_order_idx\` ON \`surveys_sections\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`surveys_sections_parent_id_idx\` ON \`surveys_sections\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`surveys\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`slug\` text NOT NULL,
    \`version\` text NOT NULL,
    \`phase\` text DEFAULT 'draft' NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`surveys_slug_idx\` ON \`surveys\` (\`slug\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`surveys_version_idx\` ON \`surveys\` (\`version\`);`)
  await db.run(sql`CREATE INDEX \`surveys_updated_at_idx\` ON \`surveys\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`surveys_created_at_idx\` ON \`surveys\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`responses\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`submission_key\` text NOT NULL,
    \`survey_id\` integer NOT NULL,
    \`version\` text NOT NULL,
    \`test_only\` integer DEFAULT false NOT NULL,
    \`duration_seconds\` numeric,
    \`answers\` text NOT NULL,
    \`instrument\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`survey_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`responses_submission_key_idx\` ON \`responses\` (\`submission_key\`);`)
  await db.run(sql`CREATE INDEX \`responses_survey_idx\` ON \`responses\` (\`survey_id\`);`)
  await db.run(sql`CREATE INDEX \`responses_updated_at_idx\` ON \`responses\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`responses_created_at_idx\` ON \`responses\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_mcp_api_keys\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`user_id\` integer NOT NULL,
    \`label\` text,
    \`description\` text,
    \`surveys_find\` integer DEFAULT false,
    \`surveys_create\` integer DEFAULT false,
    \`surveys_update\` integer DEFAULT false,
    \`payload_mcp_tool_survey_statistics\` integer DEFAULT true,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`enable_a_p_i_key\` integer,
    \`api_key\` text,
    \`api_key_index\` text,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_mcp_api_keys_user_idx\` ON \`payload_mcp_api_keys\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_mcp_api_keys_updated_at_idx\` ON \`payload_mcp_api_keys\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_mcp_api_keys_created_at_idx\` ON \`payload_mcp_api_keys\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_kv\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`data\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`global_slug\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_global_slug_idx\` ON \`payload_locked_documents\` (\`global_slug\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_updated_at_idx\` ON \`payload_locked_documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_created_at_idx\` ON \`payload_locked_documents\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`users_id\` integer,
    \`surveys_id\` integer,
    \`responses_id\` integer,
    \`payload_mcp_api_keys_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`surveys_id\`) REFERENCES \`surveys\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`responses_id\`) REFERENCES \`responses\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`payload_mcp_api_keys_id\`) REFERENCES \`payload_mcp_api_keys\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_surveys_id_idx\` ON \`payload_locked_documents_rels\` (\`surveys_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_responses_id_idx\` ON \`payload_locked_documents_rels\` (\`responses_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payload_mcp_api_keys_id_idx\` ON \`payload_locked_documents_rels\` (\`payload_mcp_api_keys_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`key\` text,
    \`value\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_key_idx\` ON \`payload_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_updated_at_idx\` ON \`payload_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_created_at_idx\` ON \`payload_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`users_id\` integer,
    \`payload_mcp_api_keys_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`payload_mcp_api_keys_id\`) REFERENCES \`payload_mcp_api_keys\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_order_idx\` ON \`payload_preferences_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_parent_idx\` ON \`payload_preferences_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_path_idx\` ON \`payload_preferences_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_users_id_idx\` ON \`payload_preferences_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_payload_mcp_api_keys_id_idx\` ON \`payload_preferences_rels\` (\`payload_mcp_api_keys_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_migrations\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`name\` text,
    \`batch\` numeric,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_migrations_updated_at_idx\` ON \`payload_migrations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_migrations_created_at_idx\` ON \`payload_migrations\` (\`created_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`users_sessions\`;`)
  await db.run(sql`DROP TABLE \`users\`;`)
  await db.run(sql`DROP TABLE \`surveys_introduction\`;`)
  await db.run(sql`DROP TABLE \`surveys_sections_questions_options\`;`)
  await db.run(sql`DROP TABLE \`surveys_sections_questions_rows\`;`)
  await db.run(sql`DROP TABLE \`surveys_sections_questions\`;`)
  await db.run(sql`DROP TABLE \`surveys_sections\`;`)
  await db.run(sql`DROP TABLE \`surveys\`;`)
  await db.run(sql`DROP TABLE \`responses\`;`)
  await db.run(sql`DROP TABLE \`payload_mcp_api_keys\`;`)
  await db.run(sql`DROP TABLE \`payload_kv\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_migrations\`;`)
}
