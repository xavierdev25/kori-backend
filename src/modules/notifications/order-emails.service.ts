import { Injectable } from '@nestjs/common';
import type { FulfillmentOrder, Order, OrderItem } from '@prisma/client';

import { formatMoney } from '../../common/money/currency';
import {
  escaparHtml,
  filasDeImporte,
  listaDeEnlaces,
  renderizarCorreo,
} from './email-layout';
import { t } from './i18n/email-messages';
import { EmailService, type EmailMessage } from './email.service';

type OrderWithItems = Order & { items: OrderItem[] };
type OrderWithTracking = OrderWithItems & {
  fulfillmentOrders: FulfillmentOrder[];
};

const money = (cents: number): string => formatMoney(cents);

/**
 * Redacción de los correos de la tienda.
 *
 * Cada correo se manda en HTML y en texto plano a la vez. El texto no es un
 * resto del pasado: un correo que solo lleva HTML puntúa peor en los filtros
 * de spam, y hay quien lee el correo en texto. Los dos dicen lo mismo, y el
 * texto se construye primero para que no se pueda quedar atrás.
 *
 * Las alertas al admin siguen siendo solo texto: nadie necesita un correo
 * maquetado para enterarse de que hay un pedido atascado.
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
    const m = t(order.locale).downloads;
    const lista = enlaces
      .map((enlace) => `  · ${enlace.nombre}\n    ${enlace.url}`)
      .join('\n\n');

    await this.emailService.send({
      subject: m.subject(order.orderNumber),
      text: [
        m.thanks,
        '',
        m.body,
        '',
        lista,
        '',
        m.expiry(horasDeCaducidad, descargasMaximas),
        m.ifExpired,
        '',
        `— ${t(order.locale).signature}`,
      ].join('\n'),
      html: renderizarCorreo(
        {
          avance: m.body,
          titulo: m.thanks,
          parrafos: [escaparHtml(m.body)],
          // Los enlaces van escritos enteros y no detrás de un botón: son
          // varios archivos, cada uno con su nombre, y quien reenvíe el
          // correo o lo lea en texto tiene que poder copiarlos.
          bloque: listaDeEnlaces(enlaces),
          nota: `${escaparHtml(m.expiry(horasDeCaducidad, descargasMaximas))}<br>${escaparHtml(m.ifExpired)}`,
        },
        escaparHtml(t(order.locale).signature),
      ),
      to: order.customerEmail,
    });
  }

  /**
   * El enlace para ver las compras. Va a quien lo pidió, sin cuenta de por
   * medio: su correo es su credencial.
   */
  async sendPurchaseAccessLink(
    to: string,
    url: string,
    minutosDeVida: number,
    locale: string,
  ): Promise<void> {
    const m = t(locale).access;

    await this.emailService.send({
      subject: m.subject,
      text: [
        m.body,
        '',
        url,
        '',
        m.expiry(minutosDeVida),
        m.ignore,
        '',
        `— ${t(locale).signature}`,
      ].join('\n'),
      html: renderizarCorreo(
        {
          avance: m.body,
          titulo: m.subject,
          parrafos: [escaparHtml(m.body)],
          boton: { texto: m.cta, url },
          // El enlace también en claro bajo el botón: hay clientes que no
          // pintan el botón, y quien pidió esto ya tuvo un problema antes.
          // Que no se quede mirando un correo sin nada donde pulsar.
          bloque: `<a href="${url}" style="color:#e8657f;word-break:break-all;">${escaparHtml(url)}</a>`,
          nota: `${escaparHtml(m.expiry(minutosDeVida))}<br>${escaparHtml(m.ignore)}`,
        },
        escaparHtml(t(locale).signature),
      ),
      to,
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
    const m = t(order.locale).confirmation;
    const lines = order.items.map(
      (item) =>
        `  ${item.quantity} x ${item.productName} (${item.variantLabel})` +
        `  ${money(item.lineTotalCents)}`,
    );

    const articulos = order.items
      .map(
        (item) =>
          `<div style="margin:0 0 10px;">${item.quantity} × ${escaparHtml(item.productName)}` +
          `<br><span style="color:#9a9e91;">${escaparHtml(item.variantLabel)} — ${money(item.lineTotalCents)}</span></div>`,
      )
      .join('');

    // Un pedido de puras descargas no se envía a ninguna parte. Enseñarle
    // "ENVIAREMOS A" y prometerle un número de rastreo a quien acaba de
    // comprar un drumkit es prometer algo que no va a llegar nunca.
    const hayEnvio = Boolean(order.shipLine1);

    const importes = filasDeImporte([
      { concepto: m.subtotal, importe: money(order.subtotalCents) },
      ...(hayEnvio
        ? [
            order.shippingCents > 0
              ? {
                  concepto: m.shippingLabel,
                  importe: money(order.shippingCents),
                }
              : { concepto: m.shippingFree, importe: '—' },
          ]
        : []),
      { concepto: m.total, importe: money(order.totalCents), fuerte: true },
    ]);

    return {
      to: order.customerEmail,
      subject: m.subject(order.orderNumber),
      text: [
        m.greeting(order.customerName),
        '',
        ...m.body,
        '',
        m.orderLabel(order.orderNumber),
        ...lines,
        '',
        `${m.subtotal} ${money(order.subtotalCents)}`,
        ...(hayEnvio
          ? [
              order.shippingCents > 0
                ? `${m.shippingLabel} ${money(order.shippingCents)}`
                : m.shippingFree,
            ]
          : []),
        `${m.total} ${money(order.totalCents)}`,
        ...(hayEnvio
          ? ['', m.shipTo, this.formatAddress(order), '', m.trackingSoon]
          : []),
        '',
        t(order.locale).signature,
      ].join('\n'),
      html: renderizarCorreo(
        {
          avance: m.orderLabel(order.orderNumber),
          titulo: m.greeting(order.customerName),
          // `body` viene partido en líneas para que el texto plano no salga
          // con renglones kilométricos. En HTML el navegador ya ajusta solo,
          // así que se vuelven a unir: un `<p>` por línea dejaba huecos a
          // media frase.
          parrafos: [escaparHtml(m.body.join(' '))],
          bloque: `<p style="margin:0 0 14px;font-weight:bold;">${escaparHtml(m.orderLabel(order.orderNumber))}</p>${articulos}<div style="margin-top:16px;">${importes}</div>`,
          nota: hayEnvio
            ? `${escaparHtml(m.shipTo)}<br>${escaparHtml(this.formatAddress(order)).replace(/\n/g, '<br>')}<br><br>${escaparHtml(m.trackingSoon)}`
            : undefined,
        },
        escaparHtml(t(order.locale).signature),
      ),
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
