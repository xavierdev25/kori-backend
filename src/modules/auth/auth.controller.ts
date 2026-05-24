import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
@UseInterceptors(NoCacheInterceptor)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
