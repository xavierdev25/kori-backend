import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';

import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const buildContext = (user: { role: UserRole } | undefined) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const buildGuard = (requiredRoles: UserRole[] | undefined) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as Reflector;

    return new RolesGuard(reflector);
  };

  it('deja pasar cuando la ruta no exige rol', () => {
    expect(
      buildGuard(undefined).canActivate(buildContext({ role: 'ARTIST' })),
    ).toBe(true);
  });

  it('deja pasar al rol exigido', () => {
    expect(
      buildGuard(['ADMIN']).canActivate(buildContext({ role: 'ADMIN' })),
    ).toBe(true);
  });

  it('ARTIST no entra a una ruta de solo ADMIN', () => {
    expect(() =>
      buildGuard(['ADMIN']).canActivate(buildContext({ role: 'ARTIST' })),
    ).toThrow(ForbiddenException);
  });

  it('acepta cualquiera de los roles listados', () => {
    const guard = buildGuard(['ARTIST', 'ADMIN']);

    expect(guard.canActivate(buildContext({ role: 'ARTIST' }))).toBe(true);
    expect(guard.canActivate(buildContext({ role: 'ADMIN' }))).toBe(true);
  });

  it('falla cerrado si no hay usuario en la peticion', () => {
    // Pasa si se olvida poner JwtAuthGuard delante: nunca debe dejar entrar.
    expect(() =>
      buildGuard(['ADMIN']).canActivate(buildContext(undefined)),
    ).toThrow(ForbiddenException);
  });

  it('una lista de roles vacia no restringe', () => {
    expect(buildGuard([]).canActivate(buildContext({ role: 'ARTIST' }))).toBe(
      true,
    );
  });
});
