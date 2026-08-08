import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import { REFRESH_TOKEN_TTL_DAYS } from './auth.constants';
import { LoginDto } from './dto/login.dto';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  accessTokenTtlMs: number;
  refreshTokenTtlMs: number;
  expiresIn: string;
  user: AuthenticatedUser;
}

/**
 * Hash bcrypt de descarte. Cuando el correo no existe se compara igualmente
 * contra este valor para que el tiempo de respuesta sea el mismo que con un
 * usuario real: si no, la diferencia de latencia revela qué correos existen.
 */
const DUMMY_BCRYPT_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.9Zx1Qk1nGZ9pXhF0k1PjXKZ8xGJt0LC';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<IssuedSession> {
    const identifier = dto.email ?? dto.username;

    if (!identifier) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const user = await this.prismaService.user.findUnique({
      where: { email: identifier },
    });

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_BCRYPT_HASH,
    );

    // Un usuario desactivado se trata igual que uno inexistente: no se le
    // confirma al atacante que la cuenta existe.
    if (!user || !user.isActive || !passwordMatches) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    return this.issueSession(user);
  }

  /**
   * Rotación: el refresh usado se revoca y se emite uno nuevo. Si llega uno ya
   * revocado significa que alguien está reutilizando un token robado, así que
   * se cierran todas las sesiones del usuario.
   */
  async refresh(rawRefreshToken: string | undefined): Promise<IssuedSession> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Sesion no valida');
    }

    const tokenHash = this.hashRefreshToken(rawRefreshToken);
    const stored = await this.prismaService.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Sesion no valida');
    }

    if (stored.revokedAt) {
      this.logger.warn(
        `Refresh token ya revocado reutilizado (usuario ${stored.userId}). Se cierran todas sus sesiones.`,
      );

      await this.revokeAllSessions(stored.userId);
      throw new UnauthorizedException('Sesion no valida');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Sesion expirada');
    }

    if (!stored.user.isActive) {
      await this.revokeAllSessions(stored.userId);
      throw new UnauthorizedException('Sesion no valida');
    }

    await this.prismaService.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueSession(stored.user);
  }

  /** Idempotente: cerrar sesión dos veces no es un error. */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    await this.prismaService.refreshToken.updateMany({
      where: {
        tokenHash: this.hashRefreshToken(rawRefreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async findActiveUserById(id: string): Promise<AuthenticatedUser | null> {
    const user = await this.prismaService.user.findUnique({ where: { id } });

    if (!user || !user.isActive) {
      return null;
    }

    return { id: user.id, email: user.email, role: user.role };
  }

  /**
   * Comparación en tiempo constante para secretos compartidos (webhooks).
   * Vive aquí para que exista un único sitio donde se comparan secretos.
   */
  static safeCompare(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);

    if (bufferA.length !== bufferB.length) {
      return false;
    }

    return timingSafeEqual(bufferA, bufferB);
  }

  private async issueSession(user: User): Promise<IssuedSession> {
    const expiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
      this.configService.get<string>('JWT_EXPIRES_IN') ??
      '15m';

    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      // El tipo de `expiresIn` en jsonwebtoken es un literal de plantilla que
      // una variable de entorno no puede satisfacer estáticamente.
      { expiresIn: expiresIn as JwtSignOptions['expiresIn'] },
    );

    // Token opaco, no JWT: así se puede revocar de verdad. Solo se guarda su
    // hash, de modo que filtrar la tabla no permite suplantar a nadie.
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshTokenTtlMs = REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY;

    await this.prismaService.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTokenTtlMs),
      },
    });

    return {
      accessToken,
      refreshToken,
      accessTokenTtlMs: this.parseDurationToMs(expiresIn),
      refreshTokenTtlMs,
      expiresIn,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prismaService.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashRefreshToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /** Convierte "15m" / "2h" / "7d" a milisegundos, para el maxAge de la cookie. */
  private parseDurationToMs(duration: string): number {
    const match = /^(\d+)\s*([smhd])?$/.exec(duration.trim());

    if (!match) {
      return 15 * 60 * 1000;
    }

    const amount = Number(match[1]);
    const unitMultipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: MS_PER_DAY,
    };

    return amount * (unitMultipliers[match[2] ?? 's'] ?? 1000);
  }
}
