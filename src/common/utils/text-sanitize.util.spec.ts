import { sanitizePlainText } from './text-sanitize.util';

describe('sanitizePlainText', () => {
  describe('quita el marcado', () => {
    it('deja el texto de una etiqueta normal y tira la etiqueta', () => {
      expect(sanitizePlainText('<strong>hola</strong> kori')).toBe('hola kori');
    });

    it('un script se va entero, contenido incluido', () => {
      expect(sanitizePlainText('hola<script>alert("x")</script>')).toBe('hola');
    });

    it('un atributo de evento no sobrevive', () => {
      expect(sanitizePlainText('<img src=x onerror=alert(1)>')).toBe('');
    });

    it('no toca lo que ya era texto', () => {
      expect(sanitizePlainText('mensaje simple')).toBe('mensaje simple');
    });
  });

  describe('devuelve texto plano, no HTML escapado', () => {
    // El fallo que lo motivo: alguien escribio `<3` en una notita y en el muro
    // salio `&lt;3`. Se guardaba escapado y se pintaba con textContent, asi que
    // la entidad se veia tal cual.
    it.each([
      ['<3', '<3'],
      ['te quiero <3', 'te quiero <3'],
      ['a & b', 'a & b'],
      ['5 > 3', '5 > 3'],
      ['3 < 5 > 1', '3 < 5 > 1'],
      ['100% & <3', '100% & <3'],
      ['<3 & <3', '<3 & <3'],
    ])('%s se guarda tal cual', (entrada, esperado) => {
      expect(sanitizePlainText(entrada)).toBe(esperado);
    });

    it('no queda ninguna entidad en la salida', () => {
      expect(sanitizePlainText('<3 & >')).not.toMatch(/&(amp|lt|gt);/);
    });
  });

  describe('desescapar no abre la puerta que cierra el sanitizador', () => {
    // Desescapar una sola vez dejaria `<script>` guardado en la base: la
    // primera pasada recibe el texto ya escapado y no ve ninguna etiqueta.
    it.each([
      '&lt;script&gt;alert(1)&lt;/script&gt;',
      '&amp;lt;script&amp;gt;',
      '&lt;img src=x onerror=alert(1)&gt;',
    ])('%s no acaba siendo una etiqueta', (entrada) => {
      expect(sanitizePlainText(entrada)).not.toMatch(/<[a-z/!]/i);
    });

    it('el texto que rodea a una etiqueta encubierta se conserva', () => {
      expect(sanitizePlainText('hola &lt;b&gt;mundo&lt;/b&gt;')).toBe(
        'hola mundo',
      );
    });
  });

  it('recorta los extremos', () => {
    expect(sanitizePlainText('  espacios  ')).toBe('espacios');
  });

  it('no rompe los emoji', () => {
    expect(sanitizePlainText('emoji 💖 ok')).toBe('emoji 💖 ok');
  });
});
