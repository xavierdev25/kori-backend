import { Logger } from '@nestjs/common';

/**
 * Calla el logger de Nest durante los tests.
 *
 * Los tests ejercitan a propósito los caminos de error —un webhook con firma
 * falsa, un trabajo que agota sus reintentos, un refresh token reutilizado— y
 * el código, correctamente, escribe un ERROR por cada uno. El resultado era
 * un muro de rojo en cada ejecución del CI donde todo estaba bien.
 *
 * Eso no es cosmético: con cincuenta líneas rojas de ruido, un fallo de
 * verdad pasa desapercibido. Ya ocurrió dos veces seguidas — un test roto y
 * una auditoría fallando quedaron enterrados entre logs esperados.
 *
 * Si hace falta ver los logs de un test concreto para depurarlo:
 *   LOGS=1 pnpm test -- outbox
 */
if (!process.env.LOGS) {
  Logger.overrideLogger(false);
}
