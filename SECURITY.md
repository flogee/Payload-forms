# Security

This initial public release is a pretest application, not a certification for sensitive or regulated data collection. The maintainers do not promise that publishing source eliminates security risks. Operators remain responsible for their hosting, account permissions, privacy notices, backups, access administration and updates.

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

## Data handling and recovery

Only fictional-data pretests are enabled. The sample is synthetic and is not an original research instrument. Published questionnaire/privacy versions are frozen; contacts are stored separately. Exports and reports need team authorization and may require additional privacy review before sharing.

Retention reminders do not automatically delete or anonymize data. Before a remote migration, preserve a verified recovery point and an operator-managed backup strategy. Code rollback does not undo schema changes; budget reservations must not be blindly restored to zero. Test recovery on a disposable installation.

## Dependency advisory review (2026-10-16)

The initial npm audit is not zero-warning. Compatible updates pin Wrangler 4.149.0 and scoped Undici 7.29.1 / DOMPurify 3.4.16 fixes. Remaining warning chains include the MCP SDK OAuth **client** advisory (the application uses server-only SDK paths), Braces through build/dependency-discovery tools (no untrusted public glob path was established), and legacy Drizzle/esbuild development-server tooling. A warning's presence is not proof of exploitability, and this bounded review is not a complete audit. Reassess these paths if adding MCP client/OAuth functionality, user-controlled glob operations or exposed development servers. Do not globally override the MCP SDK across an exact peer contract merely to clear audit counts.

Primary advisories: [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h), [Braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [esbuild](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
