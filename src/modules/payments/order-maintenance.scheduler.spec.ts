import { ConfigService } from '@nestjs/config';

import { OutboxService } from '../outbox/outbox.service';
import { OrderMaintenanceScheduler } from './order-maintenance.scheduler';
import { OrderReconciliationService } from './order-reconciliation.service';

const DIEZ_MINUTOS = 10 * 60 * 1000;
const UN_DIA = 24 * 60 * 60 * 1000;

describe('OrderMaintenanceScheduler', () => {
  let config: Record<string, string | undefined>;
  let reconciliation: { run: jest.Mock; purgarSinCobro: jest.Mock };
  let outbox: { purgarCompletados: jest.Mock };
  let scheduler: OrderMaintenanceScheduler;

  const montar = () =>
    new OrderMaintenanceScheduler(
      { get: (clave: string) => config[clave] } as unknown as ConfigService,
      outbox as unknown as OutboxService,
      reconciliation as unknown as OrderReconciliationService,
    );

  beforeEach(() => {
    jest.useFakeTimers();
    config = {};
    reconciliation = {
      run: jest.fn().mockResolvedValue({}),
      purgarSinCobro: jest.fn().mockResolvedValue(0),
    };
    outbox = { purgarCompletados: jest.fn().mockResolvedValue(0) };
    scheduler = montar();
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('concilia cada diez minutos', async () => {
    scheduler.onModuleInit();

    expect(reconciliation.run).not.toHaveBeenCalled();

    // La variante asincrona vacia las microtareas entre tic y tic. Con la
    // sincrona, el `await` de dentro del guard de solapamiento no llega a
    // resolverse y la segunda pasada se ve bloqueada por la primera.
    await jest.advanceTimersByTimeAsync(DIEZ_MINUTOS);
    expect(reconciliation.run).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(DIEZ_MINUTOS * 2);
    expect(reconciliation.run).toHaveBeenCalledTimes(3);
  });

  it('purga una vez al dia, no en cada conciliacion', async () => {
    scheduler.onModuleInit();

    await jest.advanceTimersByTimeAsync(DIEZ_MINUTOS * 6);
    expect(reconciliation.purgarSinCobro).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(UN_DIA);
    expect(reconciliation.purgarSinCobro).toHaveBeenCalledTimes(1);
    expect(outbox.purgarCompletados).toHaveBeenCalledTimes(1);
  });

  it('se puede apagar por configuracion', () => {
    // Para dejarlo solo en manos del cron externo sin tocar codigo.
    config['ORDER_MAINTENANCE_SCHEDULER'] = 'false';
    scheduler = montar();
    scheduler.onModuleInit();

    jest.advanceTimersByTime(UN_DIA);

    expect(reconciliation.run).not.toHaveBeenCalled();
    expect(reconciliation.purgarSinCobro).not.toHaveBeenCalled();
  });

  it('ignora un intervalo por debajo del minuto', () => {
    // Un valor absurdo en una variable de entorno no debe convertirse en un
    // martilleo a la base de datos y a Stripe.
    config['RECONCILIATION_INTERVAL_MS'] = '100';
    scheduler = montar();
    scheduler.onModuleInit();

    jest.advanceTimersByTime(1000);
    expect(reconciliation.run).not.toHaveBeenCalled();

    jest.advanceTimersByTime(DIEZ_MINUTOS);
    expect(reconciliation.run).toHaveBeenCalledTimes(1);
  });

  it('no arranca una pasada si la anterior sigue corriendo', async () => {
    // Conciliar habla con Stripe pedido por pedido. Si va lento, encadenar
    // pasadas sobre los mismos pedidos empeora justo lo que ya va mal.
    let terminar: () => void = () => {};
    reconciliation.run.mockReturnValue(
      new Promise<void>((resolve) => {
        terminar = resolve;
      }),
    );

    scheduler.onModuleInit();

    jest.advanceTimersByTime(DIEZ_MINUTOS * 3);
    expect(reconciliation.run).toHaveBeenCalledTimes(1);

    terminar();
    await Promise.resolve();

    jest.advanceTimersByTime(DIEZ_MINUTOS);
    expect(reconciliation.run).toHaveBeenCalledTimes(2);
  });

  it('un fallo al conciliar no tumba el proceso ni bloquea la siguiente', async () => {
    // Una excepcion dentro de un setInterval mata el proceso entero, y con el
    // la tienda. Por eso se traga y se registra.
    reconciliation.run
      .mockRejectedValueOnce(new Error('Stripe caido'))
      .mockResolvedValue({});

    scheduler.onModuleInit();

    jest.advanceTimersByTime(DIEZ_MINUTOS);
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(DIEZ_MINUTOS);
    expect(reconciliation.run).toHaveBeenCalledTimes(2);
  });

  it('un fallo al purgar no tumba el proceso', async () => {
    reconciliation.purgarSinCobro.mockRejectedValue(new Error('base caida'));

    scheduler.onModuleInit();
    jest.advanceTimersByTime(UN_DIA);
    await Promise.resolve();
    await Promise.resolve();

    expect(reconciliation.purgarSinCobro).toHaveBeenCalled();
  });

  it('los temporizadores no mantienen vivo el proceso', () => {
    // Sin unref(), un contenedor que recibe SIGTERM se queda colgado hasta que
    // alguien lo mata a la fuerza.
    const unref = jest.fn();
    jest
      .spyOn(global, 'setInterval')
      .mockReturnValue({ unref } as unknown as NodeJS.Timeout);

    scheduler.onModuleInit();

    expect(unref).toHaveBeenCalledTimes(2);
  });

  it('al apagarse deja de disparar', () => {
    scheduler.onModuleInit();
    scheduler.onModuleDestroy();

    jest.advanceTimersByTime(UN_DIA);

    expect(reconciliation.run).not.toHaveBeenCalled();
  });
});
