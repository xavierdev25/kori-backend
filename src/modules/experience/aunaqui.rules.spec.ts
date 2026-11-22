import { TOPES, VACIO, cerrar, sumar } from './aunaqui.rules';

describe('aunaqui.rules: sumar', () => {
  it('suma metros y récord, y abre la canción de los 1,000 m', () => {
    let p = { ...VACIO };
    for (let i = 0; i < 10; i++)
      p = sumar(p, { recorridos: 100, metros: (i + 1) * 100 });
    expect(p.recorridos).toBe(1000);
    expect(p.record).toBe(1000);
    expect(p.abiertas).toContain('pista-2');
    expect(p.logros).toContain('mil');
  });

  it('topa lo imposible de un solo envío', () => {
    const p = sumar(VACIO, {
      recorridos: 999_999,
      metros: 999_999_999,
      estrellas: 1000,
    });
    expect(p.recorridos).toBe(TOPES.recorridosPorEnvio);
    expect(p.record).toBe(TOPES.metrosPorCarrera);
    expect(p.estrellas).toBeLessThanOrEqual(TOPES.estrellasPorEnvio);
  });

  it('no deja juntar más estrellas que las que caben en lo recorrido', () => {
    let p = { ...VACIO };
    for (let i = 0; i < 20; i++) p = sumar(p, { estrellas: 5 });
    expect(p.estrellas).toBe(TOPES.estrellasDeGracia);
  });

  it('solo guarda ids que existen, una vez cada uno', () => {
    const p = sumar(VACIO, {
      paginas: ['p01', 'p01', 'p99', '<script>', 7],
      encuentros: ['iglesia', 'dragon'],
    });
    expect(p.paginas).toEqual(['p01']);
    expect(p.encuentros).toEqual(['iglesia']);
    expect(p.abiertas).toContain('pista-5');
  });

  it('una canción abierta no se vuelve a cerrar', () => {
    const p = cerrar({ ...VACIO, abiertas: ['pista-6'] });
    expect(p.abiertas).toContain('pista-6');
  });

  it('valores raros cuentan como cero', () => {
    const p = sumar(VACIO, {
      recorridos: -50,
      metros: 'mucho',
      estrellas: NaN,
    });
    expect(p).toMatchObject({ recorridos: 0, record: 0, estrellas: 0 });
  });
});
