import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { projectRoot } from './install-config.mjs'

// Reviewed 2026-11-03: all 16 up functions execute fixed SQL through db.run.
// The new migration adds two nullable fields, backfills real-response timestamps
// and installs fixed triggers. CLI initialization remains free of data writes.
// Pin config (including migration directory selection), index, and CLI onInit
// suppression too. Changes require a fresh source review, not automatic rehashing.
// Reviewed 2026-11-13: config adds only a static admin navigation component.
// Migration selection, CLI initialization and all 16 migration files are unchanged.
// Reviewed 2026-11-16: migration 17 adds only the correction table/indexes and
// a nullable lock relation via fixed SQL; no prior table rebuild or data write.
// Config only registers the new collection; CLI initialization remains unchanged.
// Migration 18 adds one nullable text column. The index appends only this migration.
// Migration 19 adds one optional boolean column with default false.
const reviewedSources = {
  "src/migrations/20261125_120000_hide_participant_question_codes.ts": "8ea4ee090d92e94bed38b595602cdcce84550e1dc1feedef8fd215852d510aa6", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261125_090000_thank_you_content.ts": "9cf4c54457f4a0735df659b7cb512c124fe59658c1eab452b9280d9690eff21b", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261116_081552_editorial_corrections.ts": "be7212c8489640d34ae28e3647559b5d03bbc1f5618ffb6bc0a0362c92109373", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261103_180000_first_real_response_freeze.ts": "77ee2e89c89cf0cb17fbc0b9f4c59d1c415e9ffd74dc08d70252ee646c9438c9", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261005_100813_initial_schema.ts": "2b60c02e2d320d1e26c6bbc58728455bf31b3b57dc843fa291b5eafea0700800", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261005_101926_mcp_drafts.ts": "2fb1123b4dd4c5fc57e42dc7470a9cbf764f37769bd026654e3357ffe7909548", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261007_052947_privacy_controls.ts": "44edd3b02e0ebd471d056ab5e3011723915d5ea1096b316f5db5f1a1c325b4a3", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261007_064226_email_notifications.ts": "e684de36118dc61c5e8ad9edd9afb744167ad51de073ef89d4fe9c4fcb74a86b", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261007_134653_content_blocks.ts": "dd33cefbf58683d4babad3a8b8e748b0d9a0228a79c428ba49550dab4db40a4e", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261007_135122_image_budgets.ts": "6e42c8913e8af43cb1333ad5ba0478d6d017e485b34d2f6fcb8bc40919ce84a4", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261007_155505_budget_alerts.ts": "ac328f712ff25571cfc80bd8aafb6b9a206511b0dfeefbabb0f0200d6bf8bc42", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261008_133131_retention_reminders.ts": "673070c0b9df83e0fb96716ed49d46e0829547e773b914589aae29ba1f2ddeab", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261009_101528_team_access.ts": "9ecfd518641583ae2334d50e47927c21b2bbd77b0150df40ae9911024443e65f", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261009_155346_voting_fields.ts": "82c65e3f3901b8dae19358ff62910852d14e7b23a60ff5bc70a197ac46b9aa36", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261009_185835_survey_branding.ts": "42a35fff91a71a8dd1c6e8bd10668fb6c4b3ff385c3aebb71614a46721aa72ae", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261010_211058_public_participation.ts": "95ea4effab9382042259695179fe79af8c3fa5a51713aa13518f2249cb73ffd5", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261018_155303_evaluation_runs.ts": "0afc3b94eb00317bcf65e9457fb217ce77b02e7871b6df70dcb1af3162cc70b4", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261018_170000_qa_machine_owner.ts": "65dc1347a593e32092b8f5eaf8a1192385b819655a6c0ee6e4a134c6154b857c", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/20261019_100000_qa_machine_budgets.ts": "43f77cc714d81caa17f8147506ae27448eb11e9cceac097c18c319a9023169af", // gitleaks:allow -- reviewed source SHA-256
  "src/migrations/index.ts": "8ff734d685e2829239e08d8cb918484702cdcafdeb82b956e1eea138143f6522", // gitleaks:allow -- reviewed source SHA-256
  "src/payload.config.ts": "bb970d946acea3ba698eff9644c3fb2ec256acf99d3fe2ad79ba9e03c479dc28", // gitleaks:allow -- reviewed source SHA-256
  "node_modules/payload/dist/bin/migrate.js": "caa258402b1327a6f87c5716c4537b5422f2f2ab43d8f9538ab656bd6c87177e", // gitleaks:allow -- reviewed source SHA-256
}

export async function verifyTransientMigrationSources(root = projectRoot) {
  const fail = () => { throw new Error('Runtime-secret-only migration sources or Payload version changed. Review SQL-only migrations and CLI initialization before updating the identity guard; otherwise supply the stable PAYLOAD_SECRET without this mode.') }
  const declared = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  for (const name of ['payload', '@payloadcms/db-d1-sqlite']) {
    const installed = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'))
    if (declared.dependencies?.[name] !== '3.90.2' || installed.version !== '3.90.2') fail()
  }
  // Payload CLI discovers both .ts and .js files, independently of index.ts.
  const actual = (await readdir(join(root, 'src/migrations'))).filter(name => /\.(?:ts|js)$/.test(name)).sort()
  const expected = Object.keys(reviewedSources).filter(name => name.startsWith('src/migrations/')).map(name => name.slice('src/migrations/'.length)).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail()
  for (const [name, expectedDigest] of Object.entries(reviewedSources)) {
    const digest = createHash('sha256').update(await readFile(join(root, name))).digest('hex')
    if (digest !== expectedDigest) fail()
  }
}
