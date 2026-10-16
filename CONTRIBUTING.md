# Contributing

Bug reports, documentation improvements, agent-installation feedback and focused pull requests are welcome. Contributions are provided under the repository's MIT license; retain third-party notices. Only contribute material you are authorized to license.

Start with AGENTS.md and INSTALL.md. Use the locked npm dependencies and a fresh local database. Describe the problem, the resulting behavior, checks performed, and any remaining limitations. AI-assisted contributions are welcome under the same review and verification expectations.

Run npm test and npm run typecheck. Run npm run test:ci for changes involving runtime behavior, installation, authentication, authorization, data storage, migrations, exports, budgets or deployment. Do not test on any live installation and do not include private deployment information, secrets or respondent data in reports.

Keep pull requests focused. Do not replace the data store, weaken access checks, change billing safeguards, or enable real research collection incidentally. Propose those changes with their migration, privacy and operational implications first.

Report suspected security vulnerabilities privately as described in SECURITY.md. Use synthetic examples in public issues.
