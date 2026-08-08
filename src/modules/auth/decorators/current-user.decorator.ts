import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../auth.service';

/** Usuario autenticado que dejó JwtStrategy.validate() en la petición. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>()
      .user,
);
