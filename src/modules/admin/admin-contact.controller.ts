import {
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ContactService } from '../contact/contact.service';

/**
 * La bandeja de los mensajes del formulario de GKY.
 *
 * Solo lectura y borrado: contestar se hace desde el correo, que es donde ya
 * llega cada mensaje con su `replyTo` puesto. Montar un cliente de correo
 * dentro del panel sería reconstruir mal algo que ya funciona.
 */
@Controller('admin/contact')
@UseGuards(JwtAuthGuard)
@UseInterceptors(NoCacheInterceptor)
export class AdminContactController {
  constructor(private readonly contactService: ContactService) {}

  @Get()
  findMessages(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.contactService.findAll(page, limit);
  }

  @Delete(':id')
  deleteMessage(@Param('id', ParseUUIDPipe) id: string) {
    return this.contactService.remove(id);
  }
}
