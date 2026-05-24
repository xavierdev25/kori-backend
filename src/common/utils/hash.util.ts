import { createHash, createHmac } from 'crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256OrNull(value?: string | null): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return sha256(normalized);
}

export function hmacSha256(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function hmacSha256OrNull(
  value: string | null | undefined,
  secret: string | null | undefined,
): string | null {
  const normalized = value?.trim();

  if (!normalized || !secret) {
    return null;
  }

  return hmacSha256(normalized, secret);
}
