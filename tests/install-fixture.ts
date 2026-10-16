import { readFileSync } from 'node:fs'

// Entirely fictional identifiers; these tests never contact Cloudflare.
export function installFixture() {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))
  const internal = config.env.internal
  internal.account_id = 'a'.repeat(32)
  internal.routes = [{ pattern: 'forms.fixture.dev', custom_domain: true }]
  internal.d1_databases[0].database_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  internal.vars = { ...internal.vars, SURVEY_ORIGINS: 'https://forms.fixture.dev', MAIL_ORIGIN: 'https://forms.fixture.dev',
    MAIL_FROM: 'forms@fixture.dev', MAIL_ALLOWED_RECIPIENTS: 'operator@fixture.dev', OPS_ALERT_RECIPIENT: 'operator@fixture.dev',
    ACCESS_ACCOUNT_ID: internal.account_id, ACCESS_APP_ID: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
    ACCESS_POLICY_ID: 'cccccccc-1111-4111-8111-cccccccccccc', ACCESS_AUD: 'd'.repeat(64),
    ACCESS_TEAM_DOMAIN: 'https://fixture-team.cloudflareaccess.com', ACCESS_INITIAL_EMAILS: 'operator@fixture.dev' }
  internal.send_email[0] = { name: 'EMAIL', allowed_sender_addresses: ['forms@fixture.dev'], allowed_destination_addresses: ['operator@fixture.dev'] }
  return config
}
