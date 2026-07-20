import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { CreateSubscriberDto } from './dto/create-subscriber.dto';
import { SubscribersService } from './subscribers.service';

@Controller('subscribers')
export class SubscribersController {
  constructor(private readonly subscribersService: SubscribersService) {}

  @Post()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  subscribe(@Body() dto: CreateSubscriberDto, @Req() request: Request) {
    return this.subscribersService.subscribe(dto.email, request.ip);
  }
}
