#!/bin/sh
# Container entrypoint: sync the database schema, then start Next.js.
# `prisma db push` without --accept-data-loss refuses changes that would drop
# data, so a schema mismatch stops the container instead of deleting rows.
set -e
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi
if [ "${DB_SYNC:-push}" = "push" ]; then
  node_modules/.bin/prisma db push --skip-generate
fi
exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
