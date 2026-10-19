import * as migration_20261005_100813_initial_schema from './20261005_100813_initial_schema';
import * as migration_20261005_101926_mcp_drafts from './20261005_101926_mcp_drafts';
import * as migration_20261007_052947_privacy_controls from './20261007_052947_privacy_controls';
import * as migration_20261007_064226_email_notifications from './20261007_064226_email_notifications';
import * as migration_20261007_134653_content_blocks from './20261007_134653_content_blocks';
import * as migration_20261007_135122_image_budgets from './20261007_135122_image_budgets';
import * as migration_20261007_155505_budget_alerts from './20261007_155505_budget_alerts';
import * as migration_20261008_133131_retention_reminders from './20261008_133131_retention_reminders';
import * as migration_20261009_101528_team_access from './20261009_101528_team_access';
import * as migration_20261009_155346_voting_fields from './20261009_155346_voting_fields';
import * as migration_20261009_185835_survey_branding from './20261009_185835_survey_branding';
import * as migration_20261010_211058_public_participation from './20261010_211058_public_participation';
import * as migration_20261018_155303_evaluation_runs from './20261018_155303_evaluation_runs';
import * as migration_20261018_170000_qa_machine_owner from './20261018_170000_qa_machine_owner';
import * as migration_20261019_100000_qa_machine_budgets from './20261019_100000_qa_machine_budgets';

export const migrations = [
  {
    up: migration_20261005_100813_initial_schema.up,
    down: migration_20261005_100813_initial_schema.down,
    name: '20261005_100813_initial_schema',
  },
  {
    up: migration_20261005_101926_mcp_drafts.up,
    down: migration_20261005_101926_mcp_drafts.down,
    name: '20261005_101926_mcp_drafts',
  },
  {
    up: migration_20261007_052947_privacy_controls.up,
    down: migration_20261007_052947_privacy_controls.down,
    name: '20261007_052947_privacy_controls',
  },
  {
    up: migration_20261007_064226_email_notifications.up,
    down: migration_20261007_064226_email_notifications.down,
    name: '20261007_064226_email_notifications',
  },
  {
    up: migration_20261007_134653_content_blocks.up,
    down: migration_20261007_134653_content_blocks.down,
    name: '20261007_134653_content_blocks',
  },
  {
    up: migration_20261007_135122_image_budgets.up,
    down: migration_20261007_135122_image_budgets.down,
    name: '20261007_135122_image_budgets',
  },
  {
    up: migration_20261007_155505_budget_alerts.up,
    down: migration_20261007_155505_budget_alerts.down,
    name: '20261007_155505_budget_alerts',
  },
  {
    up: migration_20261008_133131_retention_reminders.up,
    down: migration_20261008_133131_retention_reminders.down,
    name: '20261008_133131_retention_reminders',
  },
  {
    up: migration_20261009_101528_team_access.up,
    down: migration_20261009_101528_team_access.down,
    name: '20261009_101528_team_access',
  },
  {
    up: migration_20261009_155346_voting_fields.up,
    down: migration_20261009_155346_voting_fields.down,
    name: '20261009_155346_voting_fields',
  },
  {
    up: migration_20261009_185835_survey_branding.up,
    down: migration_20261009_185835_survey_branding.down,
    name: '20261009_185835_survey_branding',
  },
  {
    up: migration_20261010_211058_public_participation.up,
    down: migration_20261010_211058_public_participation.down,
    name: '20261010_211058_public_participation',
  },
  {
    up: migration_20261018_155303_evaluation_runs.up,
    down: migration_20261018_155303_evaluation_runs.down,
    name: '20261018_155303_evaluation_runs',
  },
  {
    up: migration_20261018_170000_qa_machine_owner.up,
    down: migration_20261018_170000_qa_machine_owner.down,
    name: '20261018_170000_qa_machine_owner'
  },
  {
    up: migration_20261019_100000_qa_machine_budgets.up,
    down: migration_20261019_100000_qa_machine_budgets.down,
    name: '20261019_100000_qa_machine_budgets',
  },
];
