import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

// Add permissions without rebuilding the table or changing existing values.
// Payload supplies explicit defaults for new keys; legacy SQL defaults are retained.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE payload_mcp_api_keys ADD COLUMN payload_mcp_tool_create_survey_draft integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE payload_mcp_api_keys ADD COLUMN payload_mcp_tool_update_survey_draft integer DEFAULT false;`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatic rollback would remove permission data. Restore a reviewed database backup instead.')
}
