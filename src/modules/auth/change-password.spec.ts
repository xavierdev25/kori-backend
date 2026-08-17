import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';

const ACTUAL = 'la-de-reparto-47';
const NUEVA = 'cuatro-palabras-que-si-recuerdo';

function montar(overrides: Record<string, unknown> = {}) {
  const usuario = {
    id: 'u1',
    email: 'guillermo@ejemplo.com',
    role: 'ADMIN',
    isActive: true,
    passwordHash: bcrypt.hashSync(ACTUAL, 10),
    mustChangePassword: true,
    ...overrides,
  };

  // Tipados en vez de `jest.fn()` a secas: leer `mock.calls[0][0]` sobre
  // `any` lo rechaza el lint, y con razon — una asercion sobre `any` pasa
  // aunque el dato no sea el que se cree.
  const update = jest
    .fn<
      { __op: string },
      [{ data: { mustChangePassword: boolean; passwordHash: string } }]
    >()
    .mockReturnValue({ __op: 'update' });
  const updateMany = jest
    .fn<{ __op: string }, [unknown]>()
    .mockReturnValue({ __op: 'revocar' });
  const transaction = jest
    .fn<Promise<unknown[]>, [{ __op: string }[]]>()
    .mockResolvedValue([]);

  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(usuario), update },
    refreshToken: { updateMany },
    $transaction: transaction,
  };

  const service = new AuthService(
    prisma as never,
    { get: () => undefined, getOrThrow: () => 'x' } as never,
    { signAsync: jest.fn() } as never,
  );

  return { prisma, service, transaction, update, updateMany, usuario };
}

describe('AuthService.changePassword', () => {
  it('cambia la contraseña y baja la bandera', async () => {
    const { service, update, transaction } = montar();

    await service.changePassword('u1', ACTUAL, NUEVA);

    const datos = update.mock.calls[0][0];

    expect(datos.data.mustChangePassword).toBe(false);
    expect(await bcrypt.compare(NUEVA, datos.data.passwordHash)).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('exige la contraseña actual aunque ya haya sesion', async () => {
    // Sin esto, un portatil desbloqueado un minuto basta para quedarse con la
    // cuenta de otro.
    const { service, update } = montar();

    await expect(
      service.changePassword('u1', 'no-es-la-suya', NUEVA),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(update).not.toHaveBeenCalled();
  });

  it('no deja repetir la contraseña que ya tenia', async () => {
    // Repetirla dejaria viva la contraseña de reparto, que es justo de la que
    // hay que salir.
    const { service, update } = montar();

    await expect(
      service.changePassword('u1', ACTUAL, ACTUAL),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(update).not.toHaveBeenCalled();
  });

  it('revoca las demas sesiones al cambiarla', async () => {
    // Quien cambia su contraseña es porque cree que la anterior ya no es de
    // fiar. Dejar vivas las sesiones abiertas con ella vacia el gesto.
    const { service, updateMany } = montar();

    await service.changePassword('u1', ACTUAL, NUEVA);

    // Se mira la llamada en vez de usar `expect.any(Date)`: ese matcher
    // devuelve `any` y el lint lo rechaza dentro del objeto esperado.
    const llamada = updateMany.mock.calls[0][0] as {
      where: { revokedAt: null; userId: string };
      data: { revokedAt: Date };
    };

    expect(llamada.where).toEqual({ revokedAt: null, userId: 'u1' });
    expect(llamada.data.revokedAt).toBeInstanceOf(Date);
  });

  it('el guardado y la revocacion van en la misma transaccion', async () => {
    // Si se guardara la contraseña nueva y fallara la revocacion, quedarian
    // sesiones abiertas con la vieja y nadie se enteraria.
    const { service, transaction } = montar();

    await service.changePassword('u1', ACTUAL, NUEVA);

    const operaciones = transaction.mock.calls[0][0];

    expect(operaciones.map((o) => o.__op)).toEqual(['update', 'revocar']);
  });

  it('una cuenta desactivada no puede cambiarla', async () => {
    const { service } = montar({ isActive: false });

    await expect(
      service.changePassword('u1', ACTUAL, NUEVA),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
