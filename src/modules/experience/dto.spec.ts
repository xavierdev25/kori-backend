import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateLetterDto } from './dto/letter.dto';
import { RunDto } from './dto/progress.dto';
import { RegisterExperienceDto } from './dto/register.dto';

async function validar<T extends object>(
  clase: new () => T,
  cuerpo: Record<string, unknown>,
) {
  const dto = plainToInstance(clase, cuerpo);
  const errores = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, campos: errores.map((e) => e.property) };
}

const REGISTRO = {
  email: 'Persona@Ejemplo.com ',
  country: 'mx',
  region: ' Jalisco ',
  city: '<b>Zapopan</b>',
  locale: 'es',
  ageConfirmed: true,
  privacyVersion: '2026-11-21',
};

describe('RegisterExperienceDto', () => {
  it('normaliza correo, país y texto antes de validar', async () => {
    const { dto, campos } = await validar(RegisterExperienceDto, REGISTRO);
    expect(campos).toEqual([]);
    expect(dto).toMatchObject({
      email: 'persona@ejemplo.com',
      country: 'MX',
      region: 'Jalisco',
      city: 'Zapopan',
    });
  });

  it('sin confirmar la edad no hay registro', async () => {
    const { campos } = await validar(RegisterExperienceDto, {
      ...REGISTRO,
      ageConfirmed: false,
    });
    expect(campos).toContain('ageConfirmed');
  });

  it('rechaza campos que no son del registro', async () => {
    const { campos } = await validar(RegisterExperienceDto, {
      ...REGISTRO,
      eventZone: true,
    });
    expect(campos).toContain('eventZone');
  });
});

describe('CreateLetterDto', () => {
  it('un nombre o apodo, sin apellidos, números ni @', async () => {
    for (const to of ['Ana', 'Ana María', "D'Angelo", 'Zoë']) {
      const { campos } = await validar(CreateLetterDto, { to, text: 'Hola.' });
      expect(campos).toEqual([]);
    }
    for (const to of ['Ana María López', 'ana2', '@ana', '']) {
      const { campos } = await validar(CreateLetterDto, { to, text: 'Hola.' });
      expect(campos).toContain('to');
    }
  });

  it('el texto queda como texto plano y con tope', async () => {
    const { dto } = await validar(CreateLetterDto, {
      to: 'Luis',
      text: '<img src=x onerror=alert(1)>hola',
    });
    expect(dto.text).toBe('hola');
    const { campos } = await validar(CreateLetterDto, {
      to: 'Luis',
      text: 'x'.repeat(1001),
    });
    expect(campos).toContain('text');
  });
});

describe('RunDto', () => {
  it('rechaza números negativos o fuera de tope', async () => {
    const { campos } = await validar(RunDto, { recorridos: -1, estrellas: 99 });
    expect(campos).toEqual(expect.arrayContaining(['recorridos', 'estrellas']));
  });
});
