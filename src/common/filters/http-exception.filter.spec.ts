import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  GlobalExceptionFilter,
  type ErrorEnvelope,
} from './http-exception.filter';

/** Un `ArgumentsHost` mínimo, con lo justo que el filtro toca. */
function contexto(path = '/admin/products/abc', method = 'PATCH') {
  const respuesta = {
    headersSent: false,
    statusCode: 0,
    body: undefined as ErrorEnvelope | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: ErrorEnvelope) {
      this.body = payload;
      return this;
    },
  };

  return {
    respuesta,
    host: {
      switchToHttp: () => ({
        getRequest: () => ({ method, path, requestId: 'req-1' }),
        getResponse: () => respuesta,
      }),
    },
  };
}

function prismaError(code: string, message = 'detalle interno de la base') {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '6.19.3',
  });
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    // El filtro registra los 500 a propósito; aquí solo estorba.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('errores de Prisma', () => {
    it('un registro que no existe es 404, no 500', () => {
      // Antes esto salía como "Internal server error" y mandaba a buscar una
      // avería del servidor donde solo había un id que ya no está.
      const { host, respuesta } = contexto();

      filter.catch(prismaError('P2025'), host as never);

      expect(respuesta.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(respuesta.body?.error.code).toBe('NOT_FOUND');
    });

    it('un valor duplicado es 409', () => {
      const { host, respuesta } = contexto();

      filter.catch(prismaError('P2002'), host as never);

      expect(respuesta.statusCode).toBe(HttpStatus.CONFLICT);
      expect(respuesta.body?.error.code).toBe('CONFLICT');
    });

    it('una clave foránea es 409 y lo explica', () => {
      const { host, respuesta } = contexto();

      filter.catch(prismaError('P2003'), host as never);

      expect(respuesta.statusCode).toBe(HttpStatus.CONFLICT);
      expect(respuesta.body?.error.message).toContain('dependen');
    });

    it('nunca reenvía el mensaje de Prisma', () => {
      // El de Prisma trae tabla, columna y a veces el valor que chocó: es un
      // mapa de la base de datos servido a quien pregunte.
      const { host, respuesta } = contexto();

      filter.catch(
        prismaError(
          'P2002',
          'Unique constraint failed on the fields: (`email`)',
        ),
        host as never,
      );

      const serializado = JSON.stringify(respuesta.body);

      expect(serializado).not.toContain('Unique constraint');
      expect(serializado).not.toContain('email');
    });

    it('un código que no conocemos sigue siendo 500', () => {
      // Si no se sabe qué pasó, no se puede prometer que sea culpa de quien
      // pregunta.
      const { host, respuesta } = contexto();

      filter.catch(prismaError('P9999'), host as never);

      expect(respuesta.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(respuesta.body?.error.message).toBe('Internal server error');
    });
  });

  describe('el resto', () => {
    it('respeta el estado y el mensaje de una HttpException', () => {
      const { host, respuesta } = contexto();

      filter.catch(
        new HttpException(
          'Ese correo ya está en la lista',
          HttpStatus.CONFLICT,
        ),
        host as never,
      );

      expect(respuesta.statusCode).toBe(HttpStatus.CONFLICT);
      expect(respuesta.body?.error.message).toBe(
        'Ese correo ya está en la lista',
      );
    });

    it('un error cualquiera no filtra su mensaje', () => {
      const { host, respuesta } = contexto();

      filter.catch(
        new Error('connect ECONNREFUSED 10.0.1.5:5432'),
        host as never,
      );

      expect(respuesta.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(JSON.stringify(respuesta.body)).not.toContain('10.0.1.5');
    });

    it('el envelope lleva el requestId para poder rastrearlo', () => {
      const { host, respuesta } = contexto();

      filter.catch(new Error('boom'), host as never);

      expect(respuesta.body).toMatchObject({
        success: false,
        error: { requestId: 'req-1', method: 'PATCH' },
      });
    });
  });
});
