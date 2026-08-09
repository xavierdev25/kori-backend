import { Injectable } from '@nestjs/common';
import type { FulfillmentOrder, Order, OrderItem } from '@prisma/client';

import { formatMoney } from '../../common/money/currency';
import { EmailService, type EmailMessage } from './email.service';

type OrderWithItems = Order & { items: OrderItem[] };
type OrderWithTracking = OrderWithItems & {
  fulfillmentOrders: FulfillmentOrder[];
};

const money = (cents: number): string => formatMoney(cents);

/**
 * Redacción de los correos de la tienda.
 *
 * Todo en texto plano y en español de México, a propósito: llega a la bandeja
 * principal con más facilidad que un HTML pesado, se lee igual en cualquier
 * cliente, y para tres correos no compensa mantener plantillas.
 *
 * Los importes salen de las copias congeladas del pedido, nunca del precio
 * actual del producto.
 */
@Injectable()
export class OrderEmailsService {
  constructor(private readonly emailService: EmailService) {}

  async sendOrderConfirmation(order: OrderWithItems): Promise<void> {
    await this.emailService.send(this.buildConfirmation(order));
  }

  async sendShippingNotification(order: OrderWithTracking): Promise<void> {
    await this.emailService.send(this.buildShippingNotice(order));
  }

  /**
   * Aviso al admin. Cubre la regla de tu §6: un pedido pagado nunca se queda
   * en silencio sin producción.
   */
  async sendAdminAlert(subject: string, body: string): Promise<void> {
    const to = this.emailService.alertRecipient;

    if (!to) {
      throw new Error('ADMIN_ALERT_EMAIL no está configurado');
    }

    await this.emailService.send({
      to,
      subject: `[Kori] ${subject}`,
      text: body,
    });
  }

  /**
   * Los enlaces de descarga de un pedido digital ya pagado.
   *
   * Se dice cuánto duran y cuántas veces sirven. Quien compra a las 3 de la
   * mañana y lo abre tres días después necesita saber por qué ya no funciona,
   * y a quién escribirle.
   */
  async sendDownloadLinks(
    order: OrderWithItems,
    enlaces: { nombre: string; url: string }[],
    horasDeCaducidad: number,
    descargasMaximas: number,
  ): Promise<void> {
    const lista = enlaces
      .map((enlace) => `  · ${enlace.nombre}\n    ${enlace.url}`)
      .join('\n\n');

    await this.emailService.send({
      subject: `Tu descarga de Kori — pedido #${order.orderNumber}`,
      text:
        `Gracias por tu compra.\n\n` +
        `Aquí están tus archivos:\n\n${lista}\n\n` +
        `Los enlaces caducan en ${horasDeCaducidad} horas y sirven para ` +
        `${descargasMaximas} descargas.\n` +
        `Si se te pasa el plazo, escríbenos y te mandamos unos nuevos.\n\n` +
        `— Kori`,
      to: order.customerEmail,
    });
  }

  /** Pedido pagado que hay que colocar a mano en el proveedor. */
  async sendManualFulfillmentRequest(order: OrderWithItems): Promise<void> {
    const lines = order.items.map(
      (item) =>
        `  · ${item.quantity} x ${item.productName} — ${item.variantLabel}\n` +
        `    SKU ${item.sku}\n` +
        `    Prenda en proveedor: ${item.providerProductUid ?? '(sin capturar)'}\n` +
        `    Archivo de impresión: ${item.printFileUrl ?? '(sin capturar)'}`,
    );

    await this.sendAdminAlert(
      `Pedido #${order.orderNumber} pagado — colocar en el proveedor`,
      [
        `El pedido #${order.orderNumber} está pagado y espera producción.`,
        '',
        'ARTÍCULOS',
        ...lines,
        '',
        'ENVIAR A',
        this.formatAddress(order),
        '',
        `Total cobrado: ${money(order.totalCents)}`,
        '',
        'Cuando lo coloques, guarda la guía de rastreo en el panel para que',
        'el comprador reciba su aviso de envío.',
      ].join('\n'),
    );
  }

  private buildConfirmation(order: OrderWithItems): EmailMessage {
    const lines = order.items.map(
      (item) =>
        `  ${item.quantity} x ${item.productName} (${item.variantLabel})` +
        `  ${money(item.lineTotalCents)}`,
    );

    return {
      to: order.customerEmail,
      subject: `Tu pedido #${order.orderNumber} está confirmado`,
      text: [
        `Hola${order.customerName ? ` ${order.customerName}` : ''},`,
        '',
        'Gracias por tu compra. Ya recibimos tu pago y tu pedido entró en',
        'producción: cada prenda se imprime bajo pedido, así que tarda unos',
        'días más que algo que ya está en un almacén.',
        '',
        `PEDIDO #${order.orderNumber}`,
        ...lines,
        '',
        `  Subtotal: ${money(order.subtotalCents)}`,
        order.shippingCents > 0
          ? `  Envío:    ${money(order.shippingCents)}`
          : '  Envío:    incluido',
        `  Total:    ${money(order.totalCents)}`,
        '',
        'ENVIAREMOS A',
        this.formatAddress(order),
        '',
        'Te escribimos otra vez en cuanto salga, con el número de rastreo.',
        '',
        'Kori',
      ].join('\n'),
    };
  }

  private buildShippingNotice(order: OrderWithTracking): EmailMessage {
    const shipments = order.fulfillmentOrders.filter(
      (fulfillment) => fulfillment.trackingCode ?? fulfillment.trackingUrl,
    );

    // Un pedido puede salir en varios paquetes. Enseñar solo un rastreo sería
    // mentirle a alguien que va a recibir dos cajas.
    const tracking = shipments.map((shipment, index) =>
      [
        shipments.length > 1 ? `  Paquete ${index + 1}:` : '  Rastreo:',
        shipment.trackingCode ? `  Guía: ${shipment.trackingCode}` : null,
        shipment.trackingUrl ? `  ${shipment.trackingUrl}` : null,
        shipment.shipmentMethodName
          ? `  Vía ${shipment.shipmentMethodName}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );

    return {
      to: order.customerEmail,
      subject: `Tu pedido #${order.orderNumber} va en camino`,
      text: [
        `Hola${order.customerName ? ` ${order.customerName}` : ''},`,
        '',
        `Tu pedido #${order.orderNumber} ya salió.`,
        '',
        ...(tracking.length > 0
          ? tracking
          : ['  El número de rastreo estará disponible en unas horas.']),
        '',
        'ENVIADO A',
        this.formatAddress(order),
        '',
        'Kori',
      ].join('\n'),
    };
  }

  private formatAddress(order: Order): string {
    return (
      [
        order.shipName,
        order.shipLine1,
        order.shipLine2,
        [order.shipCity, order.shipState].filter(Boolean).join(', '),
        order.shipPostalCode ? `CP ${order.shipPostalCode}` : null,
        order.shipCountry,
      ]
        .filter(Boolean)
        .map((line) => `  ${line}`)
        .join('\n') || '  (dirección no registrada)'
    );
  }
}
