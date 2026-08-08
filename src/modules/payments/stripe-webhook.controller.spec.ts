import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import Stripe from 'stripe';

import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';

/**
 * Estos tests firman los webhooks con el algoritmo real de Stripe
 * (`generateTestHeaderString` del propio SDK), no con un mock. Si la
 * verificación se rompiera, aquí se vería.
 */
describe('StripeWebhookController', () => {
  const WEBHOOK_SECRET = 'whsec_secreto_de_prueba';

  let stripeService: StripeService;
  let paymentsService: {
    claimEvent: jest.Mock;
    markEventProcessed: jest.Mock;
    handlePaymentSucceeded: jest.Mock;
    handleSessionExpired: jest.Mock;
  };
  let controller: StripeWebhookController;

  const buildRequest = (payload: object, secret = WEBHOOK_SECRET) => {
    const body = JSON.stringify(payload);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret,
    });

    return {
      request: { rawBody: Buffer.from(body) } as RawBodyRequest<Request>,
      signature,
    };
  };

  const eventPayload = (type: string, object: unknown) => ({
    id: 'evt_1',
    object: 'event',
    type,
    data: { object },
  });

  beforeEach(() => {
    stripeService = new StripeService({
      get: (key: string) =>
        ({
          STRIPE_SECRET_KEY: 'sk_test_x',
          STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        })[key],
    } as unknown as ConfigService);

    paymentsService = {
      claimEvent: jest.fn().mockResolvedValue(true),
      markEventProcessed: jest.fn().mockResolvedValue(undefined),
      handlePaymentSucceeded: jest.fn().mockResolvedValue(undefined),
      handleSessionExpired: jest.fn().mockResolvedValue(undefined),
    };

    controller = new StripeWebhookController(
      stripeService,
      paymentsService as unknown as PaymentsService,
    );
  });

  describe('verificación de firma', () => {
    it('acepta una firma válida', async () => {
      const { request, signature } = buildRequest(
        eventPayload('payment_intent.succeeded', { id: 'pi_1', metadata: {} }),
      );

      await expect(controller.handle(request, signature)).resolves.toEqual({
        received: true,
      });
      expect(paymentsService.handlePaymentSucceeded).toHaveBeenCalled();
    });

    it('rechaza una firma inválida', async () => {
      const { request } = buildRequest(
        eventPayload('payment_intent.succeeded', {}),
      );

      await expect(
        controller.handle(request, 't=1,v1=firmafalsa'),
      ).rejects.toThrow(BadRequestException);
      expect(paymentsService.claimEvent).not.toHaveBeenCalled();
    });

    it('rechaza una firma hecha con OTRO secreto', async () => {
      const { request, signature } = buildRequest(
        eventPayload('payment_intent.succeeded', {}),
        'whsec_secreto_del_atacante',
      );

      await expect(controller.handle(request, signature)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si el cuerpo fue manipulado después de firmar', async () => {
      const { signature } = buildRequest(
        eventPayload('payment_intent.succeeded', { id: 'pi_1' }),
      );
      const manipulado = {
        rawBody: Buffer.from(
          JSON.stringify(
            eventPayload('payment_intent.succeeded', { id: 'pi_HACKEADO' }),
          ),
        ),
      } as RawBodyRequest<Request>;

      await expect(controller.handle(manipulado, signature)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sin cabecera de firma responde 400', async () => {
      const { request } = buildRequest(
        eventPayload('payment_intent.succeeded', {}),
      );

      await expect(controller.handle(request, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sin cuerpo crudo responde 400 (rawBody mal configurado)', async () => {
      const { signature } = buildRequest(
        eventPayload('payment_intent.succeeded', {}),
      );

      await expect(
        controller.handle({} as RawBodyRequest<Request>, signature),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('idempotencia y despacho', () => {
    it('un evento duplicado devuelve 200 sin procesar', async () => {
      paymentsService.claimEvent.mockResolvedValue(false);
      const { request, signature } = buildRequest(
        eventPayload('payment_intent.succeeded', { id: 'pi_1' }),
      );

      await expect(controller.handle(request, signature)).resolves.toEqual({
        received: true,
      });
      expect(paymentsService.handlePaymentSucceeded).not.toHaveBeenCalled();
    });

    it('checkout.session.completed NO dispara producción', async () => {
      // Con OXXO o SPEI la sesión se completa al emitir el voucher, días antes
      // de que llegue el dinero. Producir aquí sería imprimir sin cobrar.
      const { request, signature } = buildRequest(
        eventPayload('checkout.session.completed', { id: 'cs_1' }),
      );

      await controller.handle(request, signature);

      expect(paymentsService.handlePaymentSucceeded).not.toHaveBeenCalled();
      expect(paymentsService.handleSessionExpired).not.toHaveBeenCalled();
    });

    it('checkout.session.expired cancela el pedido', async () => {
      const { request, signature } = buildRequest(
        eventPayload('checkout.session.expired', { id: 'cs_1' }),
      );

      await controller.handle(request, signature);

      expect(paymentsService.handleSessionExpired).toHaveBeenCalled();
    });

    it('un fallo al procesar devuelve 200 y se registra el error', async () => {
      // Devolver 5xx haría que Stripe reintentase, pero el evento ya está
      // registrado y el reintento se descartaría como duplicado. Lo repara el
      // barrido, no el reintento.
      paymentsService.handlePaymentSucceeded.mockRejectedValue(
        new Error('base de datos caída'),
      );
      const { request, signature } = buildRequest(
        eventPayload('payment_intent.succeeded', { id: 'pi_1' }),
      );

      await expect(controller.handle(request, signature)).resolves.toEqual({
        received: true,
      });
      expect(paymentsService.markEventProcessed).toHaveBeenCalledWith(
        'evt_1',
        'base de datos caída',
      );
    });
  });
});
