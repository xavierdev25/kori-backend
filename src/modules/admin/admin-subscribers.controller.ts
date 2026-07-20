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
import { SubscribersService } from '../subscribers/subscribers.service';

@Controller('admin/subscribers')
@UseGuards(JwtAuthGuard)
@UseInterceptors(NoCacheInterceptor)
export class AdminSubscribersController {
  constructor(private readonly subscribersService: SubscribersService) {}

  @Get()
  findSubscribers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.subscribersService.findAll(page, limit);
  }

  @Delete(':id')
  deleteSubscriber(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscribersService.remove(id);
  }
}
