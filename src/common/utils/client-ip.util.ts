import type { Request } from 'express';

export function getClientIp(req: Request): string | undefined {
  return req.ip ?? undefined;
}
