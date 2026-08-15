import { buildAllowedOrigins, isOriginAllowed } from './cors-origins';

describe('orígenes permitidos', () => {
  const permitidos = buildAllowedOrigins([
    'https://insecurekori.com',
    'https://panel.insecurekori.com',
  ]);

  describe('construir la lista', () => {
    it('la barra final de la variable de entorno no cuenta', () => {
      // El fallo real: copiar la URL de la barra del navegador se lleva la
      // barra final, y entonces ningún navegador coincide jamás.
      expect(buildAllowedOrigins(['https://insecurekori.com/'])).toEqual([
        'https://insecurekori.com',
      ]);
    });

    it('los espacios sobrantes tampoco', () => {
      expect(buildAllowedOrigins(['  https://insecurekori.com  '])).toEqual([
        'https://insecurekori.com',
      ]);
    });

    it('lo vacío o ausente se descarta, no se cuela como origen ""', () => {
      expect(buildAllowedOrigins([undefined, '', '   '])).toEqual([]);
    });
  });

  describe('decidir si pasa', () => {
    it('el origen configurado pasa', () => {
      expect(isOriginAllowed('https://insecurekori.com', permitidos)).toBe(
        true,
      );
      expect(
        isOriginAllowed('https://panel.insecurekori.com', permitidos),
      ).toBe(true);
    });

    it('cualquier otro no', () => {
      expect(isOriginAllowed('https://otracosa.com', permitidos)).toBe(false);
    });

    it('un subdominio parecido no cuela', () => {
      // Que acabe igual no lo hace tuyo: insecurekori.com.malo.net.
      expect(
        isOriginAllowed('https://insecurekori.com.malo.net', permitidos),
      ).toBe(false);
    });

    it('http no vale si lo configurado es https', () => {
      expect(isOriginAllowed('http://insecurekori.com', permitidos)).toBe(
        false,
      );
    });

    it('sin Origin pasa: curl, Stripe y los sondeos de salud', () => {
      expect(isOriginAllowed(undefined, permitidos)).toBe(true);
    });

    it('con la lista vacía, ningún navegador pasa', () => {
      expect(isOriginAllowed('https://insecurekori.com', [])).toBe(false);
    });
  });
});
