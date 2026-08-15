#!/usr/bin/env bash
# Ejecuta un comando en la instancia por SSM y espera a saber como acabo.
#
# Existe porque `aws ssm send-command` es asincrono: devuelve un id y sale con
# codigo 0 aunque el comando falle en el servidor. Usado tal cual, un
# despliegue roto se veria en verde. Aqui se espera al resultado, se imprime
# la salida real y se propaga el fallo.
#
# Uso: ssm-run.sh <instance-id> <comando>
set -euo pipefail

INSTANCE_ID=${1:?falta el id de la instancia}
COMANDO=${2:?falta el comando}

# 10 min: cubre un `docker compose pull` de una imagen grande con red lenta.
TIMEOUT_SEGUNDOS=600

echo "→ $COMANDO"

command_id=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "deploy kori-backend" \
  --timeout-seconds "$TIMEOUT_SEGUNDOS" \
  --parameters commands="[\"$(printf '%s' "$COMANDO" | sed 's/\\/\\\\/g; s/"/\\"/g')\"]" \
  --query 'Command.CommandId' --output text)

echo "  command-id: $command_id"

# El comando tarda un instante en registrarse; preguntar demasiado pronto
# devuelve InvocationDoesNotExist y abortaria por el `set -e`.
sleep 5

fin=$((SECONDS + TIMEOUT_SEGUNDOS + 60))

while true; do
  estado=$(aws ssm get-command-invocation \
    --command-id "$command_id" --instance-id "$INSTANCE_ID" \
    --query 'Status' --output text 2>/dev/null || echo "Pending")

  case "$estado" in
    Success | Failed | Cancelled | TimedOut | Undeliverable | Terminated)
      break
      ;;
  esac

  if [ "$SECONDS" -ge "$fin" ]; then
    estado=TimedOut
    break
  fi

  sleep 5
done

salida=$(aws ssm get-command-invocation \
  --command-id "$command_id" --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' --output text 2>/dev/null || true)
errores=$(aws ssm get-command-invocation \
  --command-id "$command_id" --instance-id "$INSTANCE_ID" \
  --query 'StandardErrorContent' --output text 2>/dev/null || true)

[ -n "$salida" ] && { echo "--- salida ---"; echo "$salida"; }
# La salida de error se imprime siempre, tambien cuando todo fue bien: docker
# escribe ahi su progreso y no verlo deja los fallos sin contexto.
[ -n "$errores" ] && { echo "--- stderr ---"; echo "$errores"; }

if [ "$estado" != "Success" ]; then
  echo "::error::El comando remoto acabo en estado $estado"
  exit 1
fi

echo "  ok"
