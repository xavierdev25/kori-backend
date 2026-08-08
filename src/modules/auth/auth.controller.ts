import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { parseCookieHeader } from '../../common/utils/cookie.util';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
  buildCookieOptions,
} from './auth.constants';
import { AuthService, type IssuedSession } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './auth.service';

@Controller('auth')
@UseInterceptors(NoCacheInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(dto);

    return this.completeSession(session, response);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.refresh(
      parseCookieHeader(request.headers.cookie)[REFRESH_TOKEN_COOKIE],
    );

    return this.completeSession(session, response);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(
      parseCookieHeader(request.headers.cookie)[REFRESH_TOKEN_COOKIE],
    );

    // maxAge 0 para que el navegador las borre con los mismos atributos con
    // los que se pusieron; si no coinciden, la cookie sobrevive.
    response.clearCookie(
      ACCESS_TOKEN_COOKIE,
      buildCookieOptions(this.configService, 0),
    );
    response.clearCookie(
      REFRESH_TOKEN_COOKIE,
      buildCookieOptions(this.configService, 0, REFRESH_TOKEN_COOKIE_PATH),
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser | undefined) {
    return user;
  }

  private completeSession(session: IssuedSession, response: Response) {
    response.cookie(
      ACCESS_TOKEN_COOKIE,
      session.accessToken,
      buildCookieOptions(this.configService, session.accessTokenTtlMs),
    );
    response.cookie(
      REFRESH_TOKEN_COOKIE,
      session.refreshToken,
      buildCookieOptions(
        this.configService,
        session.refreshTokenTtlMs,
        REFRESH_TOKEN_COOKIE_PATH,
      ),
    );

    return {
      // `accessToken` y `expiresIn` se siguen devolviendo en el cuerpo porque
      // el panel en producción los lee de ahí. La cookie es el camino nuevo;
      // este campo desaparece cuando el dashboard esté migrado.
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
    };
  }
}
