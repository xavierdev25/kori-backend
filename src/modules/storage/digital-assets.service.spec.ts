import { sanitizeFilename } from './digital-assets.service';

describe('sanitizeFilename', () => {
  it('un salto de linea no puede inyectar cabeceras', () => {
    // El nombre acaba dentro de un Content-Disposition.
    const sucio = 'kit\r\nX-Inyectado: si.zip';

    expect(sanitizeFilename(sucio)).not.toContain('\r');
    expect(sanitizeFilename(sucio)).not.toContain('\n');
  });

  it('los acentos se transliteran en vez de romper la cabecera', () => {
    // Una cabecera HTTP solo admite ASCII, y "Otoño" no es rebuscado aqui.
    expect(sanitizeFilename('Otoño.zip')).toBe('Otono.zip');
  });

  it('quita comillas y barras', () => {
    expect(sanitizeFilename('a"b/c\\d.zip')).toBe('abcd.zip');
  });

  it('un nombre que queda vacio cae a uno por defecto', () => {
    expect(sanitizeFilename('///')).toBe('descarga.zip');
    expect(sanitizeFilename('日本語')).toBe('descarga.zip');
  });

  it('se acota la longitud', () => {
    expect(sanitizeFilename('x'.repeat(400)).length).toBeLessThanOrEqual(100);
  });
});
