import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export const freezeTriggers = [
  `CREATE TRIGGER surveys_real_response_edit_guard BEFORE INSERT ON responses
    WHEN NEW.test_only = 0 AND EXISTS (SELECT 1 FROM surveys WHERE id = NEW.survey_id AND instrument_edit_token IS NOT NULL)
    BEGIN SELECT RAISE(ABORT, 'Questionnaire is being edited'); END`,
  `CREATE TRIGGER surveys_first_real_response AFTER INSERT ON responses WHEN NEW.test_only = 0
    BEGIN UPDATE surveys SET first_real_response_at = NEW.created_at
      WHERE id = NEW.survey_id AND first_real_response_at IS NULL; END`,
  `CREATE TRIGGER surveys_keep_real_response_freeze BEFORE UPDATE OF first_real_response_at ON surveys
    WHEN OLD.first_real_response_at IS NOT NULL AND NEW.first_real_response_at IS NOT OLD.first_real_response_at
    BEGIN SELECT RAISE(ABORT, 'First real response freeze is permanent'); END`,
]

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE surveys ADD first_real_response_at text;`)
  await db.run(sql`ALTER TABLE surveys ADD instrument_edit_token text;`)
  await db.run(sql`UPDATE surveys SET first_real_response_at =
    (SELECT min(created_at) FROM responses WHERE survey_id = surveys.id AND test_only = 0);`)
  for (const statement of freezeTriggers) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Automatischer Rückbau ist gesperrt. Der Schutz echter Erhebungsfassungen muss erhalten bleiben.')
}
