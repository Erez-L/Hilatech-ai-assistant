#!/usr/bin/env sh
# Nightly PostgreSQL backup template. Requires DATABASE_URL and BACKUP_DIR (or an S3 target via aws cli).
set -eu
: "${DATABASE_URL:?}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hilatech}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/hilatech-$STAMP.dump"
pg_dump --format=custom --no-owner --file "$FILE" "$DATABASE_URL"
# Keep 14 days locally
find "$BACKUP_DIR" -name 'hilatech-*.dump' -mtime +14 -delete
# Optional: aws s3 cp "$FILE" "s3://$BACKUP_BUCKET/postgres/"
echo "backup written: $FILE"
