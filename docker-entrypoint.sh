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
  SENTRY_DSN
do
  unquote_if_set "$kori_env_var"
done

unset kori_env_var

exec "$@"
