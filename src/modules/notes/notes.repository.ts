import { Injectable } from '@nestjs/common';
import { Note, NoteType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export const publicNoteSelect = {
  id: true,
  type: true,
  recipientName: true,
  message: true,
  imageUrl: true,
  color: true,
  rotation: true,
  positionX: true,
  positionY: true,
  zIndex: true,
  createdAt: true,
} satisfies Prisma.NoteSelect;

export const adminNoteSelect = {
  ...publicNoteSelect,
  storagePath: true,
} satisfies Prisma.NoteSelect;

export type PublicNoteRecord = Prisma.NoteGetPayload<{
  select: typeof publicNoteSelect;
}>;

export type AdminNoteRecord = Prisma.NoteGetPayload<{
  select: typeof adminNoteSelect;
}>;

export interface CreateTextNoteRecord {
  recipientName: string;
  message: string;
  color: string;
  rotation: number;
  positionX: number;
  positionY: number;
  zIndex: number;
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface CreateDrawingNoteRecord {
  recipientName: string;
  imageUrl: string;
  storagePath: string;
  rotation: number;
  positionX: number;
  positionY: number;
  zIndex: number;
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface AdminNotesListOptions {
  type?: NoteType;
  search?: string;
  page: number;
  limit: number;
}

export interface AdminNotesPage {
  data: AdminNoteRecord[];
  total: number;
}

export interface NotesStats {
  total: number;
  totalText: number;
  totalDrawing: number;
}

@Injectable()
export class NotesRepository {
  constructor(private readonly prisma: PrismaService) {}

  createTextNote(data: CreateTextNoteRecord): Promise<PublicNoteRecord> {
    return this.prisma.note.create({
      data: {
        ...data,
        type: NoteType.TEXT,
      },
      select: publicNoteSelect,
    });
  }

  createDrawingNote(data: CreateDrawingNoteRecord): Promise<PublicNoteRecord> {
    return this.prisma.note.create({
      data: {
        ...data,
        type: NoteType.DRAWING,
      },
      select: publicNoteSelect,
    });
  }

  findPublicNotes(limit: number): Promise<PublicNoteRecord[]> {
    return this.prisma.note.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      select: publicNoteSelect,
    });
  }

  async findAdminNotes(
    options: AdminNotesListOptions,
  ): Promise<AdminNotesPage> {
    const where = this.buildAdminWhere(options);
    const skip = (options.page - 1) * options.limit;

    const [total, data] = await this.prisma.$transaction([
      this.prisma.note.count({ where }),
      this.prisma.note.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: options.limit,
        select: adminNoteSelect,
      }),
    ]);

    return { data, total };
  }

  findAdminNoteById(id: string): Promise<AdminNoteRecord | null> {
    return this.prisma.note.findUnique({
      where: { id },
      select: adminNoteSelect,
    });
  }

  findNoteById(id: string): Promise<Note | null> {
    return this.prisma.note.findUnique({
      where: { id },
    });
  }

  deleteNoteById(id: string): Promise<Note> {
    return this.prisma.note.delete({
      where: { id },
    });
  }

  async getStats(): Promise<NotesStats> {
    const [total, totalText, totalDrawing] = await this.prisma.$transaction([
      this.prisma.note.count(),
      this.prisma.note.count({ where: { type: NoteType.TEXT } }),
      this.prisma.note.count({ where: { type: NoteType.DRAWING } }),
    ]);

    return {
      total,
      totalText,
      totalDrawing,
    };
  }

  private buildAdminWhere(
    options: AdminNotesListOptions,
  ): Prisma.NoteWhereInput {
    const where: Prisma.NoteWhereInput = {};

    if (options.type) {
      where.type = options.type;
    }

    if (options.search) {
      where.OR = [
        {
          recipientName: {
            contains: options.search,
            mode: 'insensitive',
          },
        },
        {
          message: {
            contains: options.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    return where;
  }
}
