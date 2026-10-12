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
import { SignalService } from '../signal/signal.service';

@Controller('admin/signal')
@UseGuards(JwtAuthGuard)
@UseInterceptors(NoCacheInterceptor)
export class AdminSignalController {
  constructor(private readonly signalService: SignalService) {}

  @Get()
  findSignups(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.signalService.findAll(page, limit);
  }

  @Delete(':id')
  deleteSignup(@Param('id', ParseUUIDPipe) id: string) {
    return this.signalService.remove(id);
  }
}
