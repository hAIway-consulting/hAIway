#!/usr/bin/env bash
# Nightly Postgres backup for the Twenty stack. Install via cron, e.g.:
#   0 3 * * * /opt/twenty/backup.sh >> /var/log/twenty-backup.log 2>&1
# Keeps the last 14 dumps. Restore procedure: docs/crm-twenty.md "Backup & Restore".
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/twenty/backups}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/twenty}"
KEEP=14

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

docker compose --project-directory "$COMPOSE_DIR" exec -T db \
  pg_dump -U postgres -d default --format=custom \
  > "$BACKUP_DIR/twenty-$STAMP.dump"

# Rotate: keep the newest $KEEP dumps
ls -1t "$BACKUP_DIR"/twenty-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "$(date -Is) backup ok: twenty-$STAMP.dump"
