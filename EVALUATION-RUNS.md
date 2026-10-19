# Evaluation runs — local integration prototype

Status: additive, fictional-data pretest prototype. No deployment, real survey,
learning-platform integration or production authorization is implied.

## Ownership and compatibility

One immutable, opened questionnaire can serve multiple independent evaluation
runs. A run stores an opaque external context UUID, an immutable questionnaire
reference/version and instrument snapshot, an expiry and open/closed state.
It does not store learners, trainers, bookings, payments or educational outcomes.

The additive `evaluation_runs` migration preserves existing questionnaires,
responses, contacts, accounts and usage reservations. Legacy responses have a
null run reference; they are not silently allocated to a seminar. Old public
links and submission bodies remain supported. New scoped responses use the
existing answer/privacy/notification transaction, not another answer store.
Deploy the reviewed additive migration before code relying on the new schema.
No automatic down migration is supplied: code rollback must retain run links,
existing answers and reserved budgets. Preserve a verified operator recovery
point before any authorized remote upgrade.

## Narrow HTTP contract

These management/report endpoints remain behind the installation's existing
whole-host protection. No Access policy, provider service or public bypass has
been added. Management requires a current human team account and rejects MCP
keys. This is **not** yet a server-to-server LMS authentication solution.

- `POST /api/survey/runs`: JSON `{ key, contextRef, surveyID, version, expiresAt }`.
  Both references are opaque UUIDs, never email/name or editable cohort fields.
  The caller creates/persists `key` before sending; reuse exactly the same body
  after an uncertain result. New runs require a saved pretest and an expiry
  within 90 days. Matching retries return the existing run without reopening it;
  a different binding is a conflict.
- `GET /api/survey/runs?key=<uuid>`: authorized operator refreshes the credentials.
- `PATCH /api/survey/runs`: JSON `{ key }`, permanently closes that run only.
- `POST /api/survey/runs/report`: JSON `{ key, token }`, accepts a report grant
  for that one run and returns the existing aggregate-sharing projection with
  run/context/version metadata. No arbitrary filters, raw text, contacts or
  individual completion status. Existing minimum-cell suppression is retained;
  it is not an anonymity guarantee.

Management returns `participationPath` and a separate `reportCredential`.
Participation grants expire with the run. Report grants last 15 minutes and are
sent in the POST body, never in a public link. MACs bind the application secret,
scope, run, questionnaire/version, opaque context and expiry. Responses are
`no-store`; participant pages use `no-referrer`.

The participation path uses the existing `/f/<slug>` page, with `run` and
`access` query parameters. The renderer passes the validated credential to
`/api/survey/submit` as `evaluationRun: { key, token }`. The browser cannot choose
an unrelated context. Invalid run credentials never fall back to an unscoped
answer. The existing public request/body/rate budgets still apply.

A group link can be forwarded. It proves possession of that link, **not** who a
learner is, eligibility for a particular session, one answer per person or
personal completion. An operator must not treat report grants as a replacement
for a production trainer/region permission model. No general SSO, roster sync,
learning gate or certificate callback is introduced.

## Retry, closure and failure

The submission UUID is scoped to the run. The database transaction checks the
current run, survey/version, state and expiry again before inserting. Closing
one run neither closes another run nor changes the shared instrument. Matching
committed retries can return their existing receipt after closure or automatic
expiry; authentic expired participation credentials permit **receipt recovery
only**, never a new insert, participant page or report.

Storage errors remain errors. A missing report is not replaced with an empty or
another context's report. The external application never commands booking,
learning, attendance or certification; those remain with the calling system.
Actual caller-side timeout handling is still an integration acceptance item.

## Machine connector — locally checked prototype, default disabled

An additional exact `POST /api/integrations/qa` route is prepared for local
fictional integration tests. **Local checks below passed; it has not been
released/enabled or accepted for real ingress.** Existing human management and public participation
routes are unchanged. Do not deploy this worktree as an accepted integration.

The draft requires `QA_MACHINE_ENABLED=1`, a dedicated `QA_MACHINE_AUD` different
from the human `ACCESS_AUD`, and bounded `QA_MACHINE_CLIENTS` configuration.
Each configured client has a stable UUID `key`, a native `accessClientID` and
an explicit `surveyVersions` allowlist. It verifies RS256 assertions against
the fixed team issuer/JWKS and machine audience: `type=app`, empty `sub`,
allowlisted `common_name`, no human email. Raw service-token headers are not
application authentication proof. Cloudflare documents this
[service application-token shape](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
and the server's
[service-token header pair](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

No Payload account is created or impersonated. Requests with browser cookies,
Origin/fetch headers, Authorization, a different host/path, query parameters or
more than 4 KiB JSON are rejected. Only these strict command bodies exist:

- `{ action: "ensure", key, contextRef, surveyID, version, expiresAt }`: retain
  the caller's exact binding and its integration-client owner; matching retry
  returns the same Run without reopening or returning a report credential.
- `{ action: "participation", key }`: return the existing group's relative
  participation path for an open, unexpired, owned Run of an allowed version.
- `{ action: "report", key }`: return the existing aggregate-sharing projection
  for that owned Run, never raw answers or a browser report token.

The additive `qa_machine_owner` migration and companion schema snapshot add a
nullable `integration_client`. Human/legacy Runs remain NULL and cannot be
claimed by a service. Old human grant MACs omit the undefined client field;
machine grants also bind to the client UUID. Apply the reviewed migration before
code reading that column; automatic rollback discarding ownership is blocked.
Generated types were compared exactly and migration generation with skip-empty
proposed no new migration in the disposable local validation.

Local validation on Node 26.3.0 passed **181 tests**, typecheck and the full
disposable Next/D1/Worker CI. This includes the machine/owner regressions,
legacy preservation, and the real compiled route remaining disabled for both
anonymous callers and ordinary team users. Native JOSE/JWKS verification uses
synthetic signed keys and a test-only Next/DB ingress model. Miniflare rewrites
Host to loopback; that model explicitly restores the fixture application Host,
not a relaxed production verifier. It is not real Cloudflare policy acceptance.

A separately maintained fictional PHP caller proof also exercised actual
loopback HTTP, this handler, native local D1 and the application response
transaction: two Runs/one version, separate aggregates, uncertain ensure retry,
owner/context denial, outage and closure. It uses a test-double human/HTTP
bootstrap and a synthetic service-auth edge, not a running WordPress instance.
Real WordPress/Access ingress, release/recovery and data policies remain gates.

Installation/release guards still reject activation and an overlapping service
application. A later local compatibility step accepts only an absent machine
flag or explicit `QA_MACHINE_ENABLED=0`; production subprocesses force it off
and discard inherited `QA_MACHINE_*` values. The CI environment also excludes
that namespace. The Access inventory guard is unchanged. This is not an enabled
Service Auth configuration or a completed coordinated release.
Enabling this feature needs a coordinated reviewed public/private release:
exact-path Service Auth policy, human/public route isolation, private secrets,
acceptance of the local client/rate/budget controls described below, and recovery/data
policy. Do not weaken the guards, add a whole-host Bypass, use a human team
account, or introduce real responses to make this local draft run.

The same compatibility step verifies the prior fixed-parameter scrypt format
without rewriting accounts during installation, retains disabled accounts and
existing usage reservations in fictional upgrades, and checks the old/current
hashes in Node and native workerd. Application source remains unpublished;
private installation selection and upgrade acceptance are separate from these
local checks. Real collection remains blocked. The subsequent local portable
extract/recovery proof below does not authorize a release or remote recovery.

## Verification and remaining decision gates

### Local machine guards and offline Access inventory

19 October local preparation, still unreleased/default off. No Cloudflare
application, policy, token, installation or private deployment workflow changed.
`scripts/check-qa-access.mjs` exports `validateQAMachineAccessInventory(input)`
and optionally reads `node scripts/check-qa-access.mjs --file snapshot.json`.
The bounded offline input contains explicit expected app/policy IDs, audiences,
hosts and client mappings, plus a complete sanitized application/policy/token
metadata snapshot. No token secret, email allowlist or real response is needed.
The fixture in `tests/qa-access.test.ts` documents the exact input contract.
Policy selectors use service-token UUIDs; JWT `common_name` uses native
`client_id` (`32hex.access`). These are checked as different mapped identifiers.
Only the exact QA path on each host, separate audience/app/policy, one reusable
`non_identity` policy with the complete explicit service-token set, unexpired
metadata and no other overlapping application are accepted. Human/public checks
and the installer/old release overlap rejection remain intact. A supplied
offline snapshot cannot prove inventory completeness, freshness or real ingress.
Official references: [path precedence](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/),
[policy selectors](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/subresources/policies/methods/get/),
[native service claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).

The runtime additionally requires the existing two rate bindings and native D1;
missing guards fail closed, without initializing Payload. Distinct stable keys
reuse the checked 300/minute client and 1,000/minute installation rate bindings,
separate from public-participation counters. The bindings are approximate and
location-local ([Cloudflare limitations](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)).
Authenticated, valid commands reserve one request; reports reserve one report
too. In one D1 batch a conditional installation update checks both headrooms,
then gates the client update with `changes()`. Monthly limits are **500 requests /
50 reports per client; 2,000 / 200 installation-wide**, across all hosts. A report
cap leaves ensure/participation commands available while request quota remains.
An exhausted client cannot spend another client's allowance. Failures, unknown
Runs and matching retries may consume reservations; never reset them for retry,
credential rotation, code rollback or response erasure. These fixed conservative
pilot settings are not approved business-volume assumptions or provider quotas.

The additive `qa_machine_budgets` migration creates only the usage table, locked
relation and alert scope column; old alerts retain empty scope and all prior
counters remain. Its generated snapshot/types align with Payload. Automatic down
migration is blocked. Apply reviewed migrations before code, keep schema/counters
on code rollback and verify a recovery point before any later authorized upgrade.

The existing five-minute scheduler recovers 80%/blocked warnings from durable
usage; per-client and overall alerts do not supersede one another. The protected
**Bilder → Betriebskontingente** panel shows machine enabled/off state, both
request/report meters and scoped warning delivery status. Existing notification
capacity/retry bounds are reused, not increased. A failed warning capture never
permits application work; reservations remain consumed. Rate bursts write at most
one event attempt per client/isolate/month, with a durable cross-isolate dedup key.
Failed event capture is remembered as failure (sanitized 503/log signal), not a
successful warning or endlessly retried write. Restart/month rollover can retry.
The status query is bounded to 64 historical client scopes per month and fails
closed if an unexpected larger inventory needs operator review.

Monthly denied calls still touch D1, authentication/body validation still costs
CPU, and direct/other-account paths are outside these accepted-work budgets.
Warnings are queued at 80%, not guaranteed delivered before a sudden burst hits
100%. No production cost or delivery guarantee follows from local tests. Before
a separately authorized activation, verify the affected account quotas/overage
path and actual warning recipient; do not audit or change unrelated services.
Public participation, stored answers and educational evidence are not disabled
by a QA-machine limit. Run reports still recalculate from remaining responses;
this package does not create frozen historical summaries or alter erasure.

### Portable answer extract and local technical recovery

19 October, still local and fictional-data only. A current human team account
may download `GET /api/survey/runs/export?key=<uuid>`. The query accepts exactly
one key; MCP keys, participation/report grants and service identities do not
authorize raw export. It remains under the existing protected human route,
not the machine endpoint. Success/error responses are private/no-store,
no-referrer and nosniff; success is a JSON attachment, never executable HTML.

Format `evaluation-run-export`, version 1, contains one Run's original frozen
instrument, stable question codes, raw answers and explicit provenance IDs;
also the opaque context, client UUID and Run state/timestamps. It does not read
contact tables or include privacy receipts, submission/grant keys, account
authorization, queue jobs, usage counters, secrets or media binaries. Raw
answers/free text are **not anonymized** and can themselves identify people.
Do not share this extract as a reduced trainer report or put real exports in Git.

One D1 batch reads metadata/statistics and the bounded selection consistently.
At most 1,000 responses and 2 MiB total stored answer UTF-8 bytes may be returned;
SQL rejects the over-limit case before returning raw bodies to Worker memory.
The entire document is capped at 4 MiB. Overflow rejects with 422, never a partial
export. Missing Runs return 404; corrupted/mixed-version/non-test records or
unavailable storage return sanitized 503. Answers must validate against the
frozen instrument without normalization or dropping values (including hidden/
unknown keys and numeric overflow). Valid zero/Unicode values remain intact.
Closed/expired Runs can be exported without reopening. No writes occur.
The canonical-JSON SHA-256 detects accidental changes; it is not a signature,
authenticity proof or an anonymity guarantee.

The caller separately retains/exports its context. Join by Run key, contextRef,
source survey ID, questionnaire version **and expiry**; source numeric IDs are
provenance, not portable authorization or a chosen cross-provider remapping.
There is no general import endpoint and this answer-only extract is not a
complete backup, audit archive or erasure-reconciliation mechanism.

`tests/evaluation-run-recovery-worker.test.ts` instead creates disposable local
D1 databases and uses actual Wrangler `d1 export --local` / `d1 execute --local
--file`. With all fixture writers stopped, it exports `--no-data` (all schema)
then `--no-schema` (all rows), combines those in that order with
`PRAGMA defer_foreign_keys=ON` and imports once into each blank target. A plain
interleaved full local dump failed on Payload's cross-table relationships;
creating referenced tables before rows fixes that documented ordering issue.
This follows Cloudflare's [SQL import/export instructions](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
and [deferred-constraint rules](https://developers.cloudflare.com/d1/sql-api/foreign-keys/),
not a new restore engine or disabled final constraint enforcement.

The drill compares all application rows, checks foreign keys, Run exports and
separate reports; closed Runs, disabled accounts, consumed budgets and erasure
markers survive, erased retries remain erased and unchanged committed retries
remain recoverable. Disabled machine access and a removed client are denied
before Payload initialization using signed synthetic service assertions.
A deliberately old fixture restores erased contacts/answers and lower counters:
the comparison exposes that loss, not an automatic freshness/activation gate.
Both restored copies are kept disabled in the drill.

For any later real restore, keep application writes, email and cron paused until
the latest erasure/closure/account/client/counter state is reconciled and checked;
do not reset limits or replay old pending mail. A complete DB backup may include
contacts and account hashes and needs protected storage. Stable application keys,
R2 files, Access policies and installation config are separate recovery inputs.
This local proof does not verify remote Time Travel, R2/secret/config recovery,
actual WordPress database recovery or migration-ledger/remote upgrade acceptance.
Do not run the fictional test suite against an existing installation.

### Executable checks and remaining gates

Run `npm test`, `npm run typecheck` and `npm run test:ci`. The latter uses fresh
local D1 databases, Next HTTP and a native Worker HTTP runtime, with fictional
credentials. Do not run it on an existing installation.

Tests cover two runs sharing one version, concurrent ensure, scoped aggregation,
small-group suppression, separate grants, changed bindings, retained previous
versions, lost acknowledgement, close/expiry receipt recovery, rejection of new
answers, SQL-fault rollback, unavailable storage and additive legacy upgrade.
The 19 October export/recovery package passed 205 tests, typecheck, and the full
disposable fresh-D1 → Next HTTP → installer Worker build → Worker HTTP suite.
This includes bounded raw exports, corruption rejection and native local SQL
recovery, not a remote upgrade/restore or authorization to collect real data.

Still required before any real LMS use: reviewed machine-to-machine ingress
compatible with the existing Access/release guards; caller-owned session/region
authorization and actual caller/bootstrap acceptance (the synthetic adapter/
outage checks already pass); public/private release pinning; remote recovery
and export acceptance; privacy, retention and disclosure
policy. None is solved by adding global Forms team accounts for trainers.
