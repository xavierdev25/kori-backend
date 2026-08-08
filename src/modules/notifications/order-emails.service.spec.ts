import type { Order, OrderItem } from '@prisma/client';

import { EmailService, type EmailMessage } from './email.service';
import { OrderEmailsService } from './order-emails.service';

describe('OrderEmailsService', () => {
  let sent: EmailMessage[];
  let service: OrderEmailsService;

  const order = (overrides: Partial<Order> = {}) =>
    ({
      id: 'o1',
      orderNumber: 42,
      customerEmail: 'ana@ejemplo.mx',
      customerName: 'Ana Ramirez',
      subtotalCents: 119_800,
      shippingCents: 0,
      totalCents: 119_800,
      shipName: 'Ana Ramirez',
      shipLine1: 'Av. Insurgentes Sur 1234',
      shipLine2: null,
      shipCity: 'Ciudad de Mexico',
      shipState: 'CDMX',
      shipPostalCode: '06700',
      shipCountry: 'MX',
      ...overrides,
    }) as Order;

  const item = (overrides: Partial<OrderItem> = {}) =>
    ({
      productName: 'Playera Kori',
      variantLabel: 'M / Negro',
      sku: 'KORI-TEE-BLK-M',
      unitPriceCents: 59_900,
      quantity: 2,
      lineTotalCents: 119_800,
      providerProductUid: 'uid_m',
      printFileUrl: 'https://kori.mx/print.png',
      ...overrides,
    }) as OrderItem;

  beforeEach(() => {
    sent = [];
    service = new OrderEmailsService({
      send: (message: EmailMessage) => {
        sent.push(message);
        return Promise.resolve();
      },
      alertRecipient: 'xaviermg2504@gmail.com',
    } as unknown as EmailService);
  });

  describe('confirmación de compra', () => {
    it('va al comprador con su número de pedido', async () => {
      await service.sendOrderConfirmation({ ...order(), items: [item()] });

      expect(sent[0].to).toBe('ana@ejemplo.mx');
      expect(sent[0].subject).toContain('#42');
    });

    it('los importes salen de las copias congeladas', async () => {
      await service.sendOrderConfirmation({ ...order(), items: [item()] });

      expect(sent[0].text).toContain('2 x Playera Kori (M / Negro)');
      expect(sent[0].text).toContain('$1,198.00 MXN');
    });

    it('con envío incluido lo dice, no pone $0.00', async () => {
      await service.sendOrderConfirmation({ ...order(), items: [item()] });

      expect(sent[0].text).toContain('Envío:    incluido');
      expect(sent[0].text).not.toContain('$0.00');
    });

    it('con envío cobrado muestra el importe', async () => {
      await service.sendOrderConfirmation({
        ...order({ shippingCents: 15_000, totalCents: 134_800 }),
        items: [item()],
      });

      expect(sent[0].text).toContain('Envío:    $150.00 MXN');
    });

    it('incluye la dirección de envío', async () => {
      await service.sendOrderConfirmation({ ...order(), items: [item()] });

      expect(sent[0].text).toContain('Av. Insurgentes Sur 1234');
      expect(sent[0].text).toContain('CP 06700');
    });

    it('sin nombre no saluda en vacío', async () => {
      await service.sendOrderConfirmation({
        ...order({ customerName: null }),
        items: [item()],
      });

      expect(sent[0].text).toMatch(/^Hola,/);
    });
  });

  describe('aviso de envío', () => {
    const fulfillment = (overrides: Record<string, unknown> = {}) =>
      ({
        trackingCode: 'ABC123',
        trackingUrl: 'https://rastreo.mx/ABC123',
        shipmentMethodName: 'Estafeta',
        ...overrides,
      }) as never;

    it('incluye la guía y el enlace', async () => {
      await service.sendShippingNotification({
        ...order(),
        items: [item()],
        fulfillmentOrders: [fulfillment()],
      });

      expect(sent[0].subject).toContain('en camino');
      expect(sent[0].text).toContain('ABC123');
      expect(sent[0].text).toContain('https://rastreo.mx/ABC123');
    });

    it('con varios paquetes los enumera', async () => {
      // Enseñar un solo rastreo a alguien que recibirá dos cajas es mentirle.
      await service.sendShippingNotification({
        ...order(),
        items: [item()],
        fulfillmentOrders: [
          fulfillment(),
          fulfillment({ trackingCode: 'XYZ789', trackingUrl: null }),
        ],
      });

      expect(sent[0].text).toContain('Paquete 1');
      expect(sent[0].text).toContain('Paquete 2');
      expect(sent[0].text).toContain('XYZ789');
    });

    it('sin rastreo todavía, lo dice en vez de dejar un hueco', async () => {
      await service.sendShippingNotification({
        ...order(),
        items: [item()],
        fulfillmentOrders: [],
      });

      expect(sent[0].text).toContain('estará disponible');
    });
  });

  describe('petición de producción manual', () => {
    it('va al admin con todo lo necesario para colocarlo', async () => {
      await service.sendManualFulfillmentRequest({
        ...order(),
        items: [item()],
      });

      expect(sent[0].to).toBe('xaviermg2504@gmail.com');
      expect(sent[0].subject).toContain('#42');
      expect(sent[0].text).toContain('KORI-TEE-BLK-M');
      expect(sent[0].text).toContain('uid_m');
      expect(sent[0].text).toContain('https://kori.mx/print.png');
      expect(sent[0].text).toContain('Av. Insurgentes Sur 1234');
      expect(sent[0].text).toContain('$1,198.00 MXN');
    });

    it('si falta un dato lo dice en vez de omitirlo', async () => {
      await service.sendManualFulfillmentRequest({
        ...order(),
        items: [item({ printFileUrl: null })],
      });

      expect(sent[0].text).toContain('(sin capturar)');
    });

    it('sin ADMIN_ALERT_EMAIL lanza, para que el job reintente', async () => {
      const sinAdmin = new OrderEmailsService({
        send: () => Promise.resolve(),
        alertRecipient: '',
      } as unknown as EmailService);

      await expect(
        sinAdmin.sendManualFulfillmentRequest({ ...order(), items: [item()] }),
      ).rejects.toThrow('ADMIN_ALERT_EMAIL');
    });
  });
});
