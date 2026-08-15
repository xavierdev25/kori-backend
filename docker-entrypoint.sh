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

# Solo se toca la variable si viene definida: exportar una opcional vacia
# cambia el comportamiento del backend (p. ej. STORAGE_DRIVER="" no es
# nullish y hace fallar la validacion de entorno, que espera
# "supabase" | "local" | ausente).
unquote_if_set() {
  name=$1

  eval "is_set=\${$name+yes}"
  [ "${is_set:-}" = yes ] || return 0

  eval "current=\$$name"
  export "$name=$(strip_surrounding_quotes "$current")"
}

# Valores por defecto antes de limpiar comillas
export PORT="${PORT:-4000}"
export NODE_ENV="${NODE_ENV:-production}"

# Todas las variables que lee el backend. JWT_ISSUER / JWT_AUDIENCE /
# HASH_PEPPER son obligatorias: si llegaran entrecomilladas, el token se
# firmaria con un issuer distinto al validado y todo /admin/* daria 401.
for kori_env_var in \
  DATABASE_URL \
  DIRECT_URL \
  SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY \
  SUPABASE_STORAGE_BUCKET \
  ADMIN_USERNAME \
  ADMIN_PASSWORD_HASH \
  JWT_SECRET \
  JWT_EXPIRES_IN \
  JWT_ISSUER \
  JWT_AUDIENCE \
  HASH_PEPPER \
  LANDING_ORIGIN \
  DASHBOARD_ORIGIN \
  PORT \
  NODE_ENV \
  ENABLE_REQUEST_LOGGING \
  TRUST_PROXY \
  STORAGE_DRIVER \
  PUBLIC_BASE_URL \
  SENTRY_DSN \
  ADMIN_ALERT_EMAIL \
  COOKIE_DOMAIN \
  COOKIE_SAMESITE \
  COOKIE_SECURE \
  INTERNAL_TASK_SECRET \
  JWT_ACCESS_EXPIRES_IN \
  JWT_ACCESS_SECRET \
  OUTBOX_INTERVAL_MS \
  OUTBOX_SCHEDULER \
  RESEND_API_KEY \
  RESEND_FROM_EMAIL \
  S3_ACCESS_KEY_ID \
  S3_BUCKET \
  S3_ENDPOINT \
  S3_PUBLIC_BASE_URL \
  S3_PUBLIC_BUCKET \
  S3_REGION \
  S3_SECRET_ACCESS_KEY \
  STRIPE_CANCEL_URL \
  STRIPE_SECRET_KEY \
  STRIPE_SUCCESS_URL \
  STRIPE_WEBHOOK_SECRET
do
  unquote_if_set "$kori_env_var"
done

unset kori_env_var

exec "$@"
