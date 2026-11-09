# HilaTech AWS infrastructure (CDK v2, TypeScript)

Standalone npm project. **Never deployed.** Start with `docs/operations/aws-setup-guide.md`; architecture in
`docs/architecture/aws-architecture.md`.

```bash
npm ci
npx tsc --noEmit          # type-check
npm test                  # template assertions (no AWS calls)
npm run validate          # cdk synth dev+staging+prod with cdk-nag, fails on unacknowledged findings
npx cdk synth -c env=dev  # one environment
```

`cdk synth` needs no AWS credentials (a placeholder account `000000000000` and pre-seeded AZ names are used).
**Do not run `cdk deploy` / `cdk bootstrap` until you have followed the setup guide** - they create billable resources.

Context flags: `-c env=dev|staging|prod`, `certificateArn`, `domainName`, `alarmEmail`, `imageTag`, `pauseServices=true`.
Sizing and feature flags per environment: `lib/config.ts`. Reasoned cdk-nag exceptions: `lib/nag-acknowledgements.ts`.
