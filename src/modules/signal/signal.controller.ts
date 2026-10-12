import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { CreateSignalSignupDto } from './dto/create-signal-signup.dto';
import { SignalService } from './signal.service';

@Controller('signal')
export class SignalController {
  constructor(private readonly signalService: SignalService) {}

  /**
   * Cinco por minuto y por IP: de sobra para quien se equivoca de correo y lo
   * corrige, poco para un script. Un poco más holgado que `/subscribers`
   * porque esta se va a promocionar en shows, donde mucha gente comparte la
   * misma red.
   */
  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  signUp(@Body() dto: CreateSignalSignupDto, @Req() request: Request) {
    return this.signalService.signUp(dto, request.ip);
  }
}
