#!/usr/bin/env bash
# Copia de seguridad diaria de RDS, desde la propia instancia de EC2.
#
# Sustituye al workflow de GitHub, que dejo de poder hacerlo: RDS esta con
# "Public access: No" y un runner de GitHub vive en internet publico, asi que
# no la alcanza. La instancia si, porque comparte VPC.
#
# Que NO sustituye: las copias automaticas de RDS. Esas cubren fallo de disco
# y borrado accidental. Esta cubre lo que aquellas no: perder la cuenta de
# AWS. Por eso se sube a Backblaze, otro proveedor. Una copia dentro de la
# misma cuenta que protege no es una copia, es un segundo disco.
#
# El volcado se CIFRA antes de salir de la maquina: contiene correos y
# direcciones de compradores.
#
# Uso: backup-rds.sh   (lee /home/ec2-user/backup.env)
set -euo pipefail

CONFIG=${BACKUP_ENV_FILE:-/home/ec2-user/backup.env}

if [ ! -r "$CONFIG" ]; then
  echo "No se puede leer $CONFIG" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; . "$CONFIG"; set +a

: "${BACKUP_DIRECT_URL:?falta BACKUP_DIRECT_URL}"
: "${BACKUP_PASSPHRASE:?falta BACKUP_PASSPHRASE}"
: "${BACKUP_S3_BUCKET:?falta BACKUP_S3_BUCKET}"
: "${BACKUP_S3_ENDPOINT:?falta BACKUP_S3_ENDPOINT}"
: "${BACKUP_S3_ACCESS_KEY_ID:?falta BACKUP_S3_ACCESS_KEY_ID}"
: "${BACKUP_S3_SECRET_ACCESS_KEY:?falta BACKUP_S3_SECRET_ACCESS_KEY}"

TRABAJO=$(mktemp -d)
trap 'rm -rf "$TRABAJO"' EXIT

SELLO=$(date -u +%Y%m%d-%H%M)
ARCHIVO="kori-${SELLO}.sql.gz"
CIFRADO="${ARCHIVO}.gpg"

# Un fallo de copia que nadie ve es lo mismo que no tener copia. Si algo se
# rompe, sale un correo antes de morir.
avisar_fallo() {
  local motivo=$1

  echo "FALLO: $motivo" >&2

  if [ -n "${RESEND_API_KEY:-}" ] && [ -n "${ADMIN_ALERT_EMAIL:-}" ] \
     && [ -n "${RESEND_FROM_EMAIL:-}" ]; then
    curl -sS --max-time 20 -X POST https://api.resend.com/emails \
      -H "Authorization: Bearer ${RESEND_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$(printf '{"from":"%s","to":["%s"],"subject":"Kori: fallo la copia de seguridad","text":"%s"}' \
            "$RESEND_FROM_EMAIL" "$ADMIN_ALERT_EMAIL" \
            "La copia del $SELLO no se completo. Motivo: $motivo")" \
      >/dev/null || echo "Ademas, no se pudo avisar por correo." >&2
  fi

  exit 1
}

echo "[$(date -u +%FT%TZ)] Volcando la base…"

# En contenedor y con version fijada: pg_dump se niega a volcar un servidor
# mas nuevo que el, y el cliente que traiga el sistema no esta bajo control.
docker run --rm postgres:17 pg_dump "$BACKUP_DIRECT_URL" \
  --no-owner --no-privileges --clean --if-exists \
  2>"$TRABAJO/error.txt" | gzip -9 > "$TRABAJO/$ARCHIVO" \
  || avisar_fallo "pg_dump: $(head -3 "$TRABAJO/error.txt" | tr '\n' ' ')"

TAMANO=$(stat -c%s "$TRABAJO/$ARCHIVO" 2>/dev/null || echo 0)
echo "  volcado: $ARCHIVO ($TAMANO bytes)"

# Un volcado diminuto es un fallo silencioso: pg_dump puede salir con codigo 0
# y escribir solo la cabecera si la conexion se corta a media transferencia.
[ "$TAMANO" -lt 1024 ] && avisar_fallo "el volcado pesa $TAMANO bytes, menos de 1 KB"

echo "[$(date -u +%FT%TZ)] Cifrando…"
gpg --batch --yes --symmetric --cipher-algo AES256 \
  --passphrase "$BACKUP_PASSPHRASE" \
  --output "$TRABAJO/$CIFRADO" "$TRABAJO/$ARCHIVO" \
  || avisar_fallo "gpg no pudo cifrar"

# Una copia que no se puede restaurar no es una copia. Se comprueba ahora, no
# el dia que haga falta de verdad.
echo "[$(date -u +%FT%TZ)] Verificando que se puede descifrar…"
gpg --batch --yes --decrypt --passphrase "$BACKUP_PASSPHRASE" \
  "$TRABAJO/$CIFRADO" 2>/dev/null | gunzip | head -c 200 \
  | grep -q "PostgreSQL database dump" \
  || avisar_fallo "el cifrado no se pudo descifrar o el contenido no es un volcado"

echo "[$(date -u +%FT%TZ)] Subiendo a Backblaze…"
AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
aws s3 cp "$TRABAJO/$CIFRADO" "s3://${BACKUP_S3_BUCKET}/${CIFRADO}" \
  --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors \
  || avisar_fallo "no se pudo subir a Backblaze"

# No se borra nada de aqui a proposito.
#
# La caducidad la lleva una regla de ciclo de vida del bucket, y asi la clave
# de esta maquina puede ser de SOLO ESCRITURA. Si alguien entra en el
# servidor, no puede leer las copias viejas —que llevan datos de tus
# compradores— ni borrarlas para taparse.
echo "[$(date -u +%FT%TZ)] Listo: $CIFRADO ($(stat -c%s "$TRABAJO/$CIFRADO") bytes cifrados)"
