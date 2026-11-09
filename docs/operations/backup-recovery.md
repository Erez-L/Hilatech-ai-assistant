# Backup and recovery

**Proposed targets and procedures. Nothing here has been drilled** - there is no deployed environment yet. The first
dev deploy should include a restore drill (section 5) and this document must be corrected from what actually happens.

## What is protected

| Data                                                                                | Where               | Mechanism (as built in `infra/cdk`)                                                                                                                                                                                           | dev             | staging | prod                       |
| ----------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------- | -------------------------- |
| PostgreSQL (all business data, embeddings, audit log, encrypted org AI credentials) | RDS                 | RDS automated backups + point-in-time recovery                                                                                                                                                                                | 1 day           | 7 days  | 14 days                    |
|                                                                                     |                     | AWS Backup plan (daily; monthly in prod) into vault `hilatech-<env>`                                                                                                                                                          | not created     | 14 d    | 35 d daily + 365 d monthly |
|                                                                                     |                     | Multi-AZ standby (availability, not a backup)                                                                                                                                                                                 | no              | no      | yes                        |
| Uploaded documents                                                                  | S3 documents bucket | versioning (non-current versions expire after 7 / 30 / 90 d) + AWS Backup (S3)                                                                                                                                                | versioning only | yes     | yes                        |
| Redis (BullMQ jobs, cache)                                                          | ElastiCache         | snapshots (staging/prod: 3 daily). **Reconstructible**: jobs are enqueued by the API from DB state; losing Redis loses queued/in-flight jobs and repeatable-job registrations                                                 | none            | 3       | 3                          |
| Secrets                                                                             | Secrets Manager     | AWS keeps previous versions; `CREDENTIALS_ENCRYPTION_KEY` **must additionally be backed up offline** (password manager / sealed envelope): losing it makes stored org AI credentials permanently unreadable, backups included |                 |         |                            |
| Infrastructure                                                                      | git (`infra/cdk`)   | `cdk deploy` rebuilds the stateless layers                                                                                                                                                                                    |                 |         |                            |
| Container images                                                                    | ECR                 | last 20 images per repo                                                                                                                                                                                                       |                 |         |                            |

Not covered: cross-region copies (no DR region), logical dumps (`infrastructure/monitoring/backup.sh` is the
non-AWS template), CloudWatch logs beyond retention.

## Proposed objectives

| Scenario                                 | RPO (max data loss)                         | RTO (time to restore service) | Basis                                                                                   |
| ---------------------------------------- | ------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| Single task / AZ failure (prod)          | 0                                           | minutes                       | ECS replaces tasks; Multi-AZ RDS fails over (typically minutes - **verify in a drill**) |
| Accidental data deletion / bad migration | <= 5 min (PITR)                             | 1-2 h                         | point-in-time restore to a new instance, then cut over or copy rows back                |
| RDS instance loss (single-AZ staging)    | <= 5 min (PITR)                             | 1-2 h                         | restore latest + PITR                                                                   |
| Region outage                            | up to 24 h (nothing is copied cross-region) | **not supported**             | no DR region built; state this to stakeholders                                          |
| Document deletion                        | 0 (versioning)                              | minutes                       | restore the previous object version                                                     |
| Redis loss                               | n/a                                         | 15-30 min                     | recreate; re-enqueue (see below)                                                        |

PITR granularity is up to five minutes of the latest restorable time per AWS RDS behaviour (confirm in the RDS
console "Latest restorable time"). RTO figures are estimates from instance size and data volume; the drill replaces
them with measured values. Prod instance restore time grows with database size.

## Restore procedures

All restores create **new** resources; nothing overwrites production. Replace names as needed.

### 1. Database: point-in-time restore (RDS)

```bash
ENV=prod
DBID=$(aws cloudformation describe-stack-resources --stack-name HilaTech-$ENV-Data \
  --query "StackResources[?ResourceType=='AWS::RDS::DBInstance'].PhysicalResourceId" --output text)
aws rds describe-db-instances --db-instance-identifier "$DBID" --query 'DBInstances[0].LatestRestorableTime'
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier "$DBID" \
  --target-db-instance-identifier "$DBID-restore-$(date -u +%Y%m%d%H%M)" \
  --restore-time 2026-01-01T12:00:00Z \
  --db-subnet-group-name <same subnet group as source> --vpc-security-group-ids <db security group id> \
  --no-publicly-accessible
```

(Use `--use-latest-restorable-time` instead of `--restore-time` to restore to the newest point.)
Get the subnet group and SG from `aws rds describe-db-instances --db-instance-identifier $DBID`. The restored
instance has the **same master credentials**. Then verify (section 4) and either:

- **Cut over:** update the `hilatech/$ENV/database-url` secret to the new endpoint, force new deployments of api and
  workers (`runbooks.md` section 2), keep the old instance until sure. CloudFormation will show drift for the DB;
  reconcile by importing the new instance or by restoring data into the CDK-managed instance instead (copy-back).
- **Copy back:** `pg_dump` the affected tables from the restored instance and load them into production (use a
  port-forward session, `runbooks.md` section 9).

### 2. Database: restore from an AWS Backup recovery point

Console: AWS Backup -> Vaults -> `hilatech-<env>` -> recovery point -> Restore. CLI outline:
`aws backup list-recovery-points-by-backup-vault --backup-vault-name hilatech-$ENV` then
`aws backup start-restore-job --recovery-point-arn ... --iam-role-arn <backup role> --metadata '{...}'` (the metadata
keys depend on the resource type; use the console the first time and capture the generated metadata). Same cut-over
options as above.

### 3. Documents (S3)

Restore a deleted/overwritten object by removing its delete marker or copying a previous version:

```bash
B=$(aws cloudformation describe-stacks --stack-name HilaTech-$ENV-Data --query "Stacks[0].Outputs[?OutputKey=='DocumentsBucketName'].OutputValue" --output text)
aws s3api list-object-versions --bucket "$B" --prefix <key>
aws s3api copy-object --bucket "$B" --key <key> --copy-source "$B/<key>?versionId=<id>"
```

Whole-bucket restore: AWS Backup -> restore the S3 recovery point to a new or existing bucket (requires the S3
restore permissions the CDK-created backup role has).

### 4. Verify a restored database

```sql
SELECT count(*) FROM "Organization";
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3;
SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','citext');
SELECT count(*) FROM "DocumentChunk";   -- embeddings present
```

Check that the newest business record timestamp is as expected, then run the smoke tests in the setup guide against a
temporary copy of the API pointed at the restored database, **before** cutting over.

### 5. Restore drill (do this once on dev/staging, then quarterly for prod)

1. Note the time; run section 1 to a new instance.
2. Record: time to `available`, restored row counts vs. production, time to a working API pointed at it.
3. Delete the restored instance. 4. Update the RTO table above with measured values and commit.

### 6. Redis loss

Recreate (`cdk deploy HilaTech-$ENV-Data`), restart api/workers. Queued jobs are gone: re-run ingestion for
documents stuck in `processing`, and verify repeatable jobs (automation scheduler) are re-registered by the workers
on boot (**unverified** - confirm in worker logs). Webhook deliveries in flight must be retried from the delivery log.

### 7. Total loss of the account/region

Not supported by the current build (no cross-region copies). A recovery would be: new account/region ->
`cdk bootstrap` -> deploy stacks -> restore from any exported dump. Decide whether staging/prod need AWS Backup
cross-region/cross-account copy rules before taking real customer data.

## Retention and deletion notes

- Prod retains RDS, buckets, vault and snapshots on `cdk destroy` (`RemovalPolicy.RETAIN`/snapshot, deletion
  protection). Dev destroys everything (no final snapshot is configured for dev: **teardown loses dev data**).
- GDPR/PII: backups contain deleted tenants' data until they expire; document this in the privacy policy and align
  retention (`backupRetentionDays`, vault lifecycle) with it.
