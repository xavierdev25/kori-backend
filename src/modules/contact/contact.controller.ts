import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  /**
   * Más estrecho que el alta en la lista de correos: escribir a soporte es un
   * acto deliberado y nadie manda tres mensajes distintos en un minuto. Frena
   * el uso del formulario como buzón de spam sin estorbar a quien escribe de
   * verdad.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 2, ttl: 300_000 } })
  send(@Body() dto: CreateContactMessageDto, @Req() request: Request) {
    return this.contactService.receive(dto, request.ip);
  }
}
