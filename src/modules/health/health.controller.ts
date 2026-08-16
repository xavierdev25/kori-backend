import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { DigitalAssetsService } from '../storage/digital-assets.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly digitalAssetsService: DigitalAssetsService,
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'kori-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('liveness')
  getLiveness() {
    return {
      status: 'ok',
      service: 'kori-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readiness')
  async getReadiness() {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is not ready');
    }

    // Antes esto devolvia la cadena fija 'startup-validated', que no
    // comprobaba nada. El backend llevo dias diciendo que estaba listo
    // mientras el almacen de los drumkits no estaba configurado siquiera: no
    // se podia subir ni entregar un solo producto de pago, y la sonda decia
    // que todo bien. Ahora dice la verdad.
    const images = this.storageService.isReachable ? 'ok' : 'unavailable';
    const digitalAssets = this.digitalAssetsService.isConfigured
      ? 'ok'
      : 'not-configured';

    // Se responde 200 aunque un almacen este caido, a proposito. Devolver
    // 503 sacaria de servicio la API entera —pedidos, muro, panel— por algo
    // que solo afecta a una parte. Pero el cuerpo lo dice, y `degraded` es
    // lo que hay que vigilar.
    const degraded = images !== 'ok' || digitalAssets !== 'ok';

    return {
      status: degraded ? 'degraded' : 'ok',
      service: 'kori-backend',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'ok',
        images,
        digitalAssets,
      },
    };
  }
}
