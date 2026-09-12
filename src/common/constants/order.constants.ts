import { OrderStatus, Prisma } from '@prisma/client';

/**
 * Los dos estados en los que nunca entró dinero.
 *
 * No confundir con `SOLD_STATUSES` de `orders.service`, que responde otra
 * pregunta: aquella dice qué cuenta como venta cerrada para las estadísticas
 * —y por eso deja fuera `REFUNDED`, donde el dinero entró y volvió a salir—.
 * Esta dice qué pedidos se pueden tirar sin perder nada, y `REFUNDED` sí es
 * un registro que hay que conservar.
 */
export const ESTADOS_SIN_COBRO: OrderStatus[] = [
  'PENDING_PAYMENT',
  'CANCELLED',
];

/**
 * Condición para "este pedido nunca cobró nada", con tirantes y cinturón.
 *
 * El estado solo no basta: se comprueba también que no haya ni PaymentIntent
 * ni fecha de pago. Son tres señales que se escriben en la misma transacción
 * al confirmar el cobro, así que si alguna dice que hubo dinero, lo hubo — y
 * este pedido no se toca. La alternativa, fiarse del estado a secas, convierte
 * cualquier transición futura mal escrita en un borrado de historial de
 * ventas, que es de lo poco que no tiene arreglo.
 */
export const NUNCA_COBRADO: Prisma.OrderWhereInput = {
  status: { in: ESTADOS_SIN_COBRO },
  stripePaymentIntentId: null,
  paidAt: null,
};

/**
 * Cuánto se conserva un intento de compra que nunca llegó a pagarse.
 *
 * Un carrito abandonado no es un registro contable: es ruido con el correo de
 * alguien dentro. Treinta días dan margen de sobra para investigar un cobro
 * raro y son un plazo defendible para quedarse un dato personal que ya no
 * sirve para nada.
 */
export const DIAS_RETENCION_SIN_COBRO = 30;

/** Cuánto se conserva un trabajo de la cola ya completado. */
export const DIAS_RETENCION_TRABAJOS_HECHOS = 90;

/**
 * Vida de la sesión de pago de Stripe.
 *
 * Treinta minutos es el mínimo que Stripe admite, y comprar un drumkit es una
 * decisión de dos. El defecto de Stripe son 24 horas: un día entero en el que
 * el pedido fantasma existe, bloquea el borrado del producto y no le sirve a
 * nadie.
 */
export const MINUTOS_VIDA_SESION = 30;

/**
 * Margen antes de que el barrido dé por muerta una sesión.
 *
 * La vida de la sesión más cinco minutos: si el webhook de caducidad viene de
 * camino, que llegue él primero. El barrido es la red, no la vía principal.
 */
export const MINUTOS_GRACIA_CONCILIACION = MINUTOS_VIDA_SESION + 5;
