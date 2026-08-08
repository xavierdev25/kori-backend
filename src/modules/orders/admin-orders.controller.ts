import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminOrdersQueryDto } from './dto/admin-orders-query.dto';
import { OrdersService } from './orders.service';

/**
 * Ventas: solo lectura en el v1, y solo para ADMIN según tu §4.
 *
 * No hay ningún endpoint de escritura a propósito: un pedido solo cambia de
 * estado por un webhook del cobro o del proveedor, nunca a mano desde el
 * panel. Y no existe DELETE — el trigger de la base de datos lo impediría
 * igualmente.
 */
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseInterceptors(NoCacheInterceptor)
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findOrders(@Query() query: AdminOrdersQueryDto) {
    return this.ordersService.findOrders(query);
  }

  @Get(':id')
  findOrderById(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOrderById(id);
  }
}

/** `/admin/stats` va en su propia ruta, tal como está en tu §4. */
@Controller('admin/stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseInterceptors(NoCacheInterceptor)
export class AdminStatsController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  getStats(@Query() query: AdminOrdersQueryDto) {
    return this.ordersService.getStats(query);
  }
}
