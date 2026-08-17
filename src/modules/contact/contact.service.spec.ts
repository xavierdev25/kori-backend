import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { ContactService } from './contact.service';
import type { CreateContactMessageDto } from './dto/create-contact-message.dto';

function montar() {
  // Tipado en vez de `jest.fn()` a secas: sin el tipo, leer `mock.calls[0][0]`
  // es acceso sobre `any` y el lint lo rechaza — con razón, porque una
  // aserción sobre `any` pasa aunque el dato no sea el que se cree.
  const create = jest
    .fn<Promise<{ id: string }>, [{ data: Record<string, unknown> }]>()
    .mockResolvedValue({ id: 'msg-1' });
  const enqueueStandalone = jest.fn().mockResolvedValue(undefined);

  const service = new ContactService(
    {
      get: () => 'pepper-de-pruebas-con-mas-de-32-caracteres',
    } as unknown as ConfigService,
    { enqueueStandalone } as never,
    { contactMessage: { create } } as never,
  );

  return { create, enqueueStandalone, service };
}

const mensaje: CreateContactMessageDto = {
  email: 'alguien@example.com',
  message: 'mi descarga no llegó',
  name: 'Alguien',
};

describe('ContactService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('guarda el mensaje antes de encolar el correo', async () => {
    // El orden es la razón de que la tabla exista: si se encolara primero y
    // guardar fallara, el correo saldría hablando de un mensaje que no está.
    const { create, enqueueStandalone, service } = montar();
    const orden: string[] = [];

    create.mockImplementation(() => {
      orden.push('guardar');
      return Promise.resolve({ id: 'msg-1' });
    });
    enqueueStandalone.mockImplementation(() => {
      orden.push('encolar');
      return Promise.resolve();
    });

    await service.receive(mensaje, '203.0.113.10');

    expect(orden).toEqual(['guardar', 'encolar']);
  });

  it('si el encolado falla, el mensaje NO se pierde', async () => {
    // Este es el caso que justifica todo: alguien escribe porque su compra
    // falló, y justo entonces es cuando más probable es que algo esté roto.
    // El mensaje ya está en la base; decirle que no se pudo le haría escribir
    // otra vez.
    const { create, enqueueStandalone, service } = montar();
    enqueueStandalone.mockRejectedValue(new Error('base caída'));

    await expect(service.receive(mensaje)).resolves.toEqual({ received: true });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('la IP se guarda hasheada, nunca en claro', async () => {
    const { create, service } = montar();

    await service.receive(mensaje, '203.0.113.10');

    const guardado = create.mock.calls[0][0];

    expect(guardado.data['ipHash']).toBeTruthy();
    expect(String(guardado.data['ipHash'])).not.toContain('203.0.113');
  });

  it('sin idioma indicado se guarda español', async () => {
    const { create, service } = montar();

    await service.receive(mensaje);

    const guardado = create.mock.calls[0][0];

    expect(guardado.data['locale']).toBe('es');
  });

  it('la clave de deduplicación usa el id del mensaje', async () => {
    // Dos pasadas de la cola sobre el mismo mensaje no pueden mandar el correo
    // dos veces.
    const { enqueueStandalone, service } = montar();

    await service.receive(mensaje);

    expect(enqueueStandalone).toHaveBeenCalledWith(
      'SEND_CONTACT_MESSAGE',
      'msg-1',
      { contactMessageId: 'msg-1' },
    );
  });
});
