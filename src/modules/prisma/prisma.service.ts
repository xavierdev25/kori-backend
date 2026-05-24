import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      this.assertRuntimeEnvironment();
      await this.$connect();
      await this.$queryRaw`SELECT 1`;
      this.logger.log('PostgreSQL connection established successfully');
    } catch (error) {
      this.logger.error(this.getConnectionErrorMessage(error));
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('PostgreSQL connection closed');
  }

  private assertRuntimeEnvironment(): void {
    const databaseUrl = process.env.DATABASE_URL;
    const directUrl = process.env.DIRECT_URL;

    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is not available at runtime. Check .env loading.',
      );
    }

    if (!directUrl) {
      throw new Error(
        'DIRECT_URL is not available at runtime. Check .env loading.',
      );
    }

    const databaseTarget = this.getDatabaseTarget(databaseUrl);

    this.logger.log(
      `PostgreSQL runtime target resolved: ${databaseTarget.host}:${databaseTarget.port}`,
    );
  }

  private getDatabaseTarget(databaseUrl: string): {
    host: string;
    port: string;
  } {
    try {
      const parsedUrl = new URL(databaseUrl);

      return {
        host: parsedUrl.hostname,
        port: parsedUrl.port || '5432',
      };
    } catch {
      throw new Error(
        'DATABASE_URL is not a valid URL. Check .env formatting.',
      );
    }
  }

  private getConnectionErrorMessage(error: unknown): string {
    const sanitizedMessage = this.sanitizeSensitiveValues(
      this.toMessage(error),
    );
    const errorCode = this.getErrorCode(error);

    if (sanitizedMessage.includes('not available at runtime')) {
      return `PostgreSQL configuration failed: ${sanitizedMessage}`;
    }

    if (sanitizedMessage.includes('not a valid URL')) {
      return `PostgreSQL configuration failed: ${sanitizedMessage}`;
    }

    if (
      errorCode === 'P1000' ||
      /authentication failed|password authentication failed/i.test(
        sanitizedMessage,
      )
    ) {
      return `PostgreSQL authentication failed. Verify DATABASE_URL credentials. ${sanitizedMessage}`;
    }

    if (
      errorCode === 'P1001' ||
      /can't reach database server|enotfound|econnrefused|etimedout/i.test(
        sanitizedMessage,
      )
    ) {
      return `PostgreSQL host or port is unreachable. Verify DNS, TCP connectivity, and Session Pooler status. ${sanitizedMessage}`;
    }

    return `PostgreSQL initialization failed. ${sanitizedMessage}`;
  }

  private getErrorCode(error: unknown): string | undefined {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('errorCode' in error)
    ) {
      return undefined;
    }

    const errorCode = (error as { errorCode?: unknown }).errorCode;

    return typeof errorCode === 'string' ? errorCode : undefined;
  }

  private toMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private sanitizeSensitiveValues(message: string): string {
    const sensitiveValues = [
      process.env.DATABASE_URL,
      process.env.DIRECT_URL,
    ].filter((value): value is string => Boolean(value));

    return sensitiveValues.reduce(
      (sanitizedMessage, sensitiveValue) =>
        sanitizedMessage.replaceAll(sensitiveValue, '[redacted]'),
      message,
    );
  }
}
