import { ServiceUnavailableException } from '@nestjs/common';

import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  const falla = () => Promise.reject(new Error('timeout'));
  const funciona = () => Promise.resolve('ok');

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('mientras todo va bien, no estorba', async () => {
    const breaker = new CircuitBreaker('prueba');

    await expect(breaker.run(funciona)).resolves.toBe('ok');
    expect(breaker.isOpen).toBe(false);
  });

  it('un fallo suelto no abre el circuito', async () => {
    const breaker = new CircuitBreaker('prueba', { failureThreshold: 3 });

    await expect(breaker.run(falla)).rejects.toThrow('timeout');
    expect(breaker.isOpen).toBe(false);
  });

  it('los fallos seguidos lo abren', async () => {
    const breaker = new CircuitBreaker('prueba', { failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await expect(breaker.run(falla)).rejects.toThrow('timeout');
    }

    expect(breaker.isOpen).toBe(true);
  });

  it('un éxito por el medio reinicia la cuenta', async () => {
    const breaker = new CircuitBreaker('prueba', { failureThreshold: 3 });

    await expect(breaker.run(falla)).rejects.toThrow();
    await expect(breaker.run(falla)).rejects.toThrow();
    await expect(breaker.run(funciona)).resolves.toBe('ok');
    await expect(breaker.run(falla)).rejects.toThrow();

    // Tres fallos en total, pero no seguidos: no debe abrirse.
    expect(breaker.isOpen).toBe(false);
  });

  it('abierto, ni siquiera llama al servicio', async () => {
    const breaker = new CircuitBreaker('prueba', { failureThreshold: 1 });
    await expect(breaker.run(falla)).rejects.toThrow();

    const operacion = jest.fn(funciona);
    await expect(breaker.run(operacion)).rejects.toThrow(
      ServiceUnavailableException,
    );

    // Esto es el patrón entero: la petición no espera el timeout, falla ya.
    expect(operacion).not.toHaveBeenCalled();
  });

  it('pasado el descanso deja pasar una para tantear', async () => {
    jest.useFakeTimers();
    const breaker = new CircuitBreaker('prueba', {
      failureThreshold: 1,
      resetMs: 1000,
    });

    await expect(breaker.run(falla)).rejects.toThrow();
    expect(breaker.isOpen).toBe(true);

    jest.advanceTimersByTime(1001);

    const operacion = jest.fn(funciona);
    await expect(breaker.run(operacion)).resolves.toBe('ok');

    expect(operacion).toHaveBeenCalled();
    expect(breaker.isOpen).toBe(false);
  });

  it('si el tanteo falla, vuelve a abrirse sin juntar más fallos', async () => {
    jest.useFakeTimers();
    const breaker = new CircuitBreaker('prueba', {
      failureThreshold: 5,
      resetMs: 1000,
    });

    for (let i = 0; i < 5; i++) {
      await expect(breaker.run(falla)).rejects.toThrow();
    }

    jest.advanceTimersByTime(1001);
    await expect(breaker.run(falla)).rejects.toThrow('timeout');

    // Ya se sabe que sigue mal: no tiene sentido dejar pasar cuatro más.
    expect(breaker.isOpen).toBe(true);
  });

  it('el mensaje de error dice qué servicio falla y qué hacer', async () => {
    const breaker = new CircuitBreaker('Backblaze', { failureThreshold: 1 });
    await expect(breaker.run(falla)).rejects.toThrow();

    await expect(breaker.run(funciona)).rejects.toThrow(/Backblaze/);
  });
});
