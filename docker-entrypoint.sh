#!/bin/sh
set -eu

strip_surrounding_quotes() {
  value=$1

  case "$value" in
    \"*\")
      value=${value#\"}
      value=${value%\"}
      ;;
    \'*\')
      value=${value#\'}
      value=${value%\'}
      ;;
  esac

  printf '%s' "$value"
}

export DATABASE_URL="$(strip_surrounding_quotes "${DATABASE_URL:-}")"
export DIRECT_URL="$(strip_surrounding_quotes "${DIRECT_URL:-}")"
export SUPABASE_URL="$(strip_surrounding_quotes "${SUPABASE_URL:-}")"
export SUPABASE_SERVICE_ROLE_KEY="$(strip_surrounding_quotes "${SUPABASE_SERVICE_ROLE_KEY:-}")"
export SUPABASE_STORAGE_BUCKET="$(strip_surrounding_quotes "${SUPABASE_STORAGE_BUCKET:-}")"
export ADMIN_USERNAME="$(strip_surrounding_quotes "${ADMIN_USERNAME:-}")"
export ADMIN_PASSWORD_HASH="$(strip_surrounding_quotes "${ADMIN_PASSWORD_HASH:-}")"
export JWT_SECRET="$(strip_surrounding_quotes "${JWT_SECRET:-}")"
export JWT_EXPIRES_IN="$(strip_surrounding_quotes "${JWT_EXPIRES_IN:-}")"
export LANDING_ORIGIN="$(strip_surrounding_quotes "${LANDING_ORIGIN:-}")"
export DASHBOARD_ORIGIN="$(strip_surrounding_quotes "${DASHBOARD_ORIGIN:-}")"
export PORT="$(strip_surrounding_quotes "${PORT:-4000}")"
export NODE_ENV="$(strip_surrounding_quotes "${NODE_ENV:-production}")"

exec "$@"
