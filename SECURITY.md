# Security

This application supports fictional pretests and explicitly gated real surveys. It is not a certification for sensitive or regulated data collection. The maintainers do not promise that publishing source eliminates security risks. Operators remain responsible for their hosting, account permissions, privacy notices, backups, access administration and updates.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** private reporting flow. Do not post exploit details, credentials, personal data or live target URLs in public issues. Include the affected version, relevant source path, expected boundary, and the smallest reproduction using fictional local data. Do not probe an installation without its operator's authorization. If private reporting is unavailable, open a public issue asking for a private contact without disclosing details.

Security fixes initially target the latest published release. There is no guaranteed response or support SLA. Review dependency and framework advisories before public deployment and maintain a tested update process.

## Deployment boundaries

- Local development binds to loopback. Test credentials and the sample questionnaire must never be treated as production provisioning.
- Cloudflare deployments require valid Access protection for administration, responses, exports, analysis, media administration and MCP. Public exemptions cover only questionnaire, notice, scoped image, static-asset and submission routes.
- Never expose a Worker preview or alternate hostname that bypasses the intended Access application. Keep workers.dev and preview URLs disabled for deployments using this model.
- Installations use their own persistent Payload secret and a restricted Access synchronization token. Never log either value or reuse development secrets in production.
- The vendored password-hashing compatibility code is tied to Payload 3.90.2. Its postinstall verifier rejects unknown versions and source hashes. Upgrading Payload requires reviewing/removing/replacing that patch and rerunning native Worker authentication tests. See THIRD_PARTY_NOTICES.md.

## Usage safeguards

The default budgets apply jointly to an installation's domains: 20,000 public reads and 2,000 submission attempts per UTC month; 2 MiB per image, 128 MiB and 256 reserved image objects, 256 image writes and 100,000 image reads per UTC month; 500 mail attempts with 40 reserved for operational warnings. Failed attempts can count. Atomic reservations happen before the relevant operations. Rate limits are supplementary and approximate.

Warnings start at 80 percent and at blocking thresholds. Use the operator's verified address, bounded deduplicated retries, and the protected operational status to inspect failed or uncertain warning delivery. Provider acceptance does not confirm inbox delivery. Failure of a dependent feature must not expose private data or reset its reservations.

These budgets do not cap account-wide billing, other projects, direct provider access, Worker invocation costs or all D1 costs. Verify current provider quotas, shared account usage and overage rules before enabling a deployment. Provider budget alerts are not hard spending limits. Never automatically raise limits or enable paid overage.

The **default-disabled, experimental QA machine connector** additionally reserves
at most 500 command attempts/50 report attempts per client and 2,000/200 for the
installation per UTC month. Reports consume both counters atomically before
application reads; failed or uncertain work is not refunded. Fixed limits are
not environment overrides. Existing rate bindings use independent machine keys;
they are approximate/per-location, not accurate accounting. Invalid commands
can still consume Worker/rate usage, and monthly rejected calls still incur
bounded reservation/alert checks. These are accepted-work caps, not a D1/CPU or
account-wide spend cap. Preserve stable client keys across credential rotation.
Scoped 80%/blocked alerts share the existing bounded mail reserve and protected
status. Queueing or provider acceptance does not guarantee timely inbox delivery.
Failed rate-alert capture returns a sanitized failure and is not repeatedly
written by the same isolate/month; later blocked calls retain that failure.
See [evaluation-run boundaries](EVALUATION-RUNS.md#local-machine-guards-and-offline-access-inventory).

The coordinated release preflight accepts explicit machine configuration only
after offline validation. Its online reader verifies exact QA inventory before
allowing that one overlap, with bounded bodies, manual redirects and complete
single-page metadata; unsupported/multi-page inventories stop the release.
This is not a fresh ingress proof or an atomic guarantee against subsequent
provider changes. Off with retained mappings does not require an active service
credential, but still verifies the same narrow route/policy boundary. Disabling
the machine endpoint never revokes already-issued participant grants: close the
corresponding Runs separately. No rollout or real-data acceptance is implied.

## Data handling and recovery

Fictional-data pretests are the default. Real collection additionally requires the exact operator flag `FORMS_REAL_SURVEYS_ENABLED=1`, complete reviewed privacy settings and human-administrator activation. Disabling the runtime flag stops new real participation without changing stored data. Missing/malformed runtime flags fail closed even if a build previously enabled collection. QA/evaluation runs and machine clients stay fictional/pretest-only. The sample is synthetic and is not an original research instrument. Published questionnaire/privacy versions are frozen; contacts are stored separately. Optional live contacts need separate consent and a valid email; their name is optional. Participation without login does not guarantee anonymity, and separated contacts remain linkable to their response for follow-up. Exports and reports need team authorization and may require additional privacy review before sharing.

Retention reminders do not automatically delete or anonymize data. Before a remote migration, preserve a verified recovery point and an operator-managed backup strategy. Code rollback does not undo schema changes; budget reservations must not be blindly restored to zero. Test recovery on a disposable installation.

## Dependency advisory review (2026-10-16)

The initial npm audit is not zero-warning. Compatible updates pin Wrangler 4.149.0 and scoped Undici 7.29.1 / DOMPurify 3.4.16 fixes. Remaining warning chains include the MCP SDK OAuth **client** advisory (the application uses server-only SDK paths), Braces through build/dependency-discovery tools (no untrusted public glob path was established), and legacy Drizzle/esbuild development-server tooling. A warning's presence is not proof of exploitability, and this bounded review is not a complete audit. Reassess these paths if adding MCP client/OAuth functionality, user-controlled glob operations or exposed development servers. Do not globally override the MCP SDK across an exact peer contract merely to clear audit counts.

Primary advisories: [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h), [Braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [esbuild](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
