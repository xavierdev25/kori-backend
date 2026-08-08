import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'required_roles';

/**
 * Restringe una ruta a los roles indicados. Sin este decorador, basta con
 * estar autenticado.
 *
 *   @Roles('ADMIN')
 *   @Get('orders')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
