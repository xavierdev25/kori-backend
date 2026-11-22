import { enZonaEvento } from './event-zone';

describe('enZonaEvento', () => {
  it('los municipios del área metropolitana de Guadalajara, como se escriban', () => {
    for (const ciudad of [
      'Guadalajara',
      'zapopan',
      'TONALA',
      'Tlaquepaque',
      'San Pedro Tlaquepaque',
      'Tlajomulco',
      'GDL',
      'guadalajara, jal.',
      '  El   Salto ',
    ]) {
      expect(enZonaEvento('MX', 'Jalisco', ciudad)).toBe(true);
    }
  });

  it('el estado tiene que ser Jalisco (con o sin acento ni mayúsculas)', () => {
    expect(enZonaEvento('MX', 'jalisco', 'Zapopan')).toBe(true);
    expect(enZonaEvento('MX', 'Nuevo León', 'Guadalajara')).toBe(false);
  });

  it('fuera de México o fuera de la zona, no', () => {
    expect(enZonaEvento('US', 'Jalisco', 'Guadalajara')).toBe(false);
    expect(enZonaEvento('MX', 'Jalisco', 'Puerto Vallarta')).toBe(false);
    expect(enZonaEvento('MX', 'Jalisco', 'Zapopanito')).toBe(false);
  });

  it('sin ubicación completa, no', () => {
    expect(enZonaEvento(null, 'Jalisco', 'Guadalajara')).toBe(false);
    expect(enZonaEvento('MX', null, 'Guadalajara')).toBe(false);
    expect(enZonaEvento('MX', 'Jalisco', '')).toBe(false);
  });
});
