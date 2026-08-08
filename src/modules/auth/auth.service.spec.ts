import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const validPassword = 'admin-password-for-test';
  /** expect.any() no está tipado; se acota una vez aquí. */
  const anyDate = expect.any(Date) as unknown as Date;
  const anySha256 = expect.stringMatching(
    /^[a-f0-9]{64}$/,
  ) as unknown as string;

  let prisma: {
    user: { findUnique: jest.Mock };
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync'>>;
  let service: AuthService;
  let user: User;

  beforeEach(() => {
    user = {
      id: 'user-1',
      email: 'artista@kori.mx',
      passwordHash: bcrypt.hashSync(validPassword, 10),
      role: 'ADMIN',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    jwtService = { signAsync: jest.fn().mockResolvedValue('access-token') };

    const configService = {
      get: jest.fn((key: string) => ({ JWT_EXPIRES_IN: '15m' })[key]),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
  });

  describe('login', () => {
    it('emite tokens con credenciales validas', async () => {
      const session = await service.login({
        email: 'artista@kori.mx',
        password: validPassword,
      });

      expect(session.accessToken).toBe('access-token');
      expect(session.user).toEqual({
        id: 'user-1',
        email: 'artista@kori.mx',
        role: 'ADMIN',
      });
      // El refresh es opaco y aleatorio, nunca un JWT.
      expect(session.refreshToken).toEqual(expect.any(String));
      expect(session.refreshToken.split('.')).toHaveLength(1);
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('el rol viaja en el token de acceso', async () => {
      await service.login({ email: user.email, password: validPassword });

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', role: 'ADMIN' }),
        expect.anything(),
      );
    });

    it('acepta el campo heredado username', async () => {
      await expect(
        service.login({ username: 'artista@kori.mx', password: validPassword }),
      ).resolves.toMatchObject({ accessToken: 'access-token' });
    });

    it('rechaza una contrasena incorrecta', async () => {
      await expect(
        service.login({ email: user.email, password: 'incorrecta' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza un usuario inexistente sin filtrar que no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nadie@kori.mx', password: validPassword }),
      ).rejects.toThrow(new UnauthorizedException('Credenciales invalidas'));
    });

    it('rechaza un usuario desactivado', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });

      await expect(
        service.login({ email: user.email, password: validPassword }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('no emite sesion sin identificador', async () => {
      await expect(service.login({ password: validPassword })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refresh', () => {
    it('rota el token: revoca el usado y emite uno nuevo', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user,
      });

      const session = await service.refresh('un-refresh-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: anyDate },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(session.accessToken).toBe('access-token');
    });

    it('el token se busca por hash, nunca en claro', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('secreto-en-claro')).rejects.toThrow(
        UnauthorizedException,
      );

      const [firstCall] = prisma.refreshToken.findUnique.mock.calls as [
        [{ where: { tokenHash: string } }],
      ];
      const where = firstCall[0].where;
      expect(where.tokenHash).not.toBe('secreto-en-claro');
      expect(where.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('reutilizar un token revocado cierra TODAS las sesiones', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user,
      });

      await expect(service.refresh('token-robado')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: anyDate },
      });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rechaza un token caducado', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1),
        user,
      });

      await expect(service.refresh('caducado')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rechaza sin token', async () => {
      await expect(service.refresh(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revoca el token presentado', async () => {
      await service.logout('un-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: anySha256,
          revokedAt: null,
        },
        data: { revokedAt: anyDate },
      });
    });

    it('sin token no falla', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });
});
