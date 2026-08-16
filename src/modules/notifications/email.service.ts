import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CircuitBreaker } from '../../common/resilience/circuit-breaker';
import { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  /**
   * La versión en texto plano. Obligatoria aunque haya HTML.
   *
   * No es un resto del pasado: un correo que solo lleva HTML puntúa peor en
   * los filtros de spam, y hay quien lee el correo en texto por elección o
   * por lector de pantalla. Va siempre, y dice lo mismo que el HTML.
   */
  text: string;
  /** Opcional: las alertas internas no necesitan maquetación. */
  html?: string;
}

/** Un envio que tarda mas que esto se da por perdido y el job reintenta. */
const RESEND_TIMEOUT_MS = 10_000;

/**
 * Único punto que habla con Resend.
 *
 * Igual que Stripe: sin `RESEND_API_KEY` el backend arranca, avisa por log y
 * los correos se registran en vez de enviarse. Así se puede desplegar la
 * tienda antes de tener el dominio verificado sin que nada reviente.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  /**
   * El correo no es urgente: la cola reintenta con espera creciente. Por eso
   * el descanso es largo — no tiene sentido machacar a un proveedor caído
   * cuando el trabajo va a reintentarse igualmente dentro de un rato.
   */
  private readonly breaker = new CircuitBreaker('el envío de correo', {
    failureThreshold: 5,
    resetMs: 60_000,
  });
  private readonly client: Resend | null;
  private readonly from: string;
  private readonly adminEmail: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');

    this.client = apiKey ? new Resend(apiKey) : null;
    this.from =
      this.configService.get<string>('RESEND_FROM_EMAIL') ??
      'Kori <onboarding@resend.dev>';
    this.adminEmail = this.configService.get<string>('ADMIN_ALERT_EMAIL') ?? '';
  }

  onModuleInit(): void {
    if (!this.client) {
      this.logger.warn(
        'RESEND_API_KEY no definido: los correos se escriben en el log en vez de enviarse.',
      );
      return;
    }

    if (this.from.includes('resend.dev')) {
      // Resend solo entrega desde un dominio verificado; con el remitente de
      // pruebas únicamente llegan correos a la propia cuenta.
      this.logger.warn(
        `RESEND_FROM_EMAIL sin dominio propio (${this.from}): solo se entregará a tu propia cuenta de Resend.`,
      );
    }

    if (!this.adminEmail) {
      this.logger.warn(
        'ADMIN_ALERT_EMAIL no definido: las alertas de pedidos fallidos no llegarán a nadie.',
      );
    }
  }

  get isEnabled(): boolean {
    return this.client !== null;
  }

  get alertRecipient(): string {
    return this.adminEmail;
  }

  /**
   * Lanza si el envío falla: el que llama es un job del outbox, y que lance es
   * justo lo que dispara el reintento con backoff. Tragarse el error dejaría
   * al comprador sin correo y sin rastro del fallo.
   */
  async send(message: EmailMessage): Promise<void> {
    if (!message.to) {
      throw new Error('El correo no tiene destinatario');
    }

    if (!this.client) {
      this.logger.log(
        `[correo simulado] para=${message.to} asunto="${message.subject}"`,
      );
      return;
    }

    // El SDK de Resend no expone timeout, asi que se corta desde fuera: un
    // envio colgado bloquearia la pasada entera de la cola. Y el
    // cortacircuitos evita esperar ese timeout una y otra vez cuando el
    // proveedor lleva un rato caido: la cola se atasca menos y los trabajos
    // se reintentan solos mas tarde.
    const { error } = await this.breaker.run(() =>
      this.withTimeout(
        this.client!.emails.send({
          from: this.from,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          to: message.to,
        }),
      ),
    );

    if (error) {
      throw new Error(`Resend rechazó el envío: ${error.message}`);
    }

    this.logger.log(`Correo enviado a ${this.mask(message.to)}`);
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Resend no respondio en ${RESEND_TIMEOUT_MS / 1000} s`,
                ),
              ),
            RESEND_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      // Sin esto el temporizador mantiene vivo el proceso hasta que vence.
      clearTimeout(timer);
    }
  }

  /** En los logs no se escribe el correo completo de un comprador. */
  private mask(email: string): string {
    const [user, domain] = email.split('@');

    return domain ? `${user.slice(0, 2)}***@${domain}` : '***';
  }
}
