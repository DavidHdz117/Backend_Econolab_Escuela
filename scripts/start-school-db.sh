#!/usr/bin/env bash
set -euo pipefail
school_db_password="$(openssl rand -hex 32)"
echo "::add-mask::$school_db_password"
echo "SCHOOL_TEST_DATABASE_URL=postgresql://postgres:$school_db_password@127.0.0.1:5432/econolab_school_test" >> "$GITHUB_ENV"
docker run --detach --name school-postgres --publish 127.0.0.1:5432:5432 --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD="$school_db_password" --env POSTGRES_DB=econolab_school_test postgres:17
for attempt in $(seq 1 30); do
  if docker exec school-postgres pg_isready -U postgres; then exit 0; fi
  sleep 1
done
exit 1
