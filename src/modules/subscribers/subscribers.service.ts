import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { hmacSha256OrNull } from '../../common/utils/hash.util';
import { PrismaService } from '../prisma/prisma.service';

export interface SubscribeResponse {
  subscribed: true;
  email: string;
}

export interface SubscriberRecord {
  id: string;
  email: string;
  createdAt: Date;
}

export interface PaginatedSubscribersResponse {
  data: SubscriberRecord[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const subscriberSelect = {
  id: true,
  email: true,
  createdAt: true,
} satisfies Prisma.SubscriberSelect;

@Injectable()
export class SubscribersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async subscribe(email: string, ip?: string): Promise<SubscribeResponse> {
    const pepper = this.configService.get<string>('HASH_PEPPER') ?? null;

    try {
      const subscriber = await this.prisma.subscriber.create({
        data: {
          email,
          ipHash: hmacSha256OrNull(ip, pepper),
        },
        select: subscriberSelect,
      });

      return { subscribed: true, email: subscriber.email };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ese correo ya está en la lista');
      }

      throw error;
    }
  }

  async findAll(
    page: number,
    limit: number,
  ): Promise<PaginatedSubscribersResponse> {
    const safePage = Math.max(Math.trunc(page), 1);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

    const [total, data] = await this.prisma.$transaction([
      this.prisma.subscriber.count(),
      this.prisma.subscriber.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: subscriberSelect,
      }),
    ]);

    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async remove(id: string): Promise<{ deleted: true; id: string }> {
    await this.prisma.subscriber.delete({ where: { id } }).catch((error) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return null; // ya no existe: borrar es idempotente
      }
      throw error;
    });

    return { deleted: true, id };
  }
}
