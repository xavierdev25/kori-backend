import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';

describe('AuthService', () => {
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync'>>;
  let service: AuthService;

  beforeEach(() => {
    const passwordHash = bcrypt.hashSync('diciembre2026', 10);
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          ADMIN_USERNAME: 'kori',
          ADMIN_PASSWORD_HASH: passwordHash,
          JWT_EXPIRES_IN: '2h',
        };

        return values[key];
      }),
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('access-token'),
    };

    service = new AuthService(
      configService as unknown as ConfigService,
      jwtService as unknown as JwtService,
    );
  });

  it('returns accessToken for valid credentials', async () => {
    await expect(
      service.login({
        username: 'kori',
        password: 'diciembre2026',
      }),
    ).resolves.toEqual({
      accessToken: 'access-token',
      expiresIn: '2h',
    });
  });

  it('throws UnauthorizedException for invalid password', async () => {
    await expect(
      service.login({
        username: 'kori',
        password: 'incorrecta',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException for invalid username', async () => {
    await expect(
      service.login({
        username: 'otro',
        password: 'diciembre2026',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
