import { normalizeLocale, t } from './email-messages';

describe('idioma de los correos', () => {
  describe('normalizeLocale', () => {
    it('se queda con la parte del idioma de una etiqueta completa', () => {
      // El navegador manda "es-MX" o "en-GB"; aquí solo importa el idioma.
      expect(normalizeLocale('es-MX')).toBe('es');
      expect(normalizeLocale('en-GB')).toBe('en');
      expect(normalizeLocale('en_US')).toBe('en');
    });

    it('no le importan las mayúsculas ni los espacios', () => {
      expect(normalizeLocale('  EN  ')).toBe('en');
    });

    it('un idioma que no sabemos escribir cae al español', () => {
      // Mandar un correo en un idioma inventado es peor que mandarlo en el
      // del artista.
      expect(normalizeLocale('fr')).toBe('es');
      expect(normalizeLocale('日本語')).toBe('es');
      expect(normalizeLocale('')).toBe('es');
      expect(normalizeLocale(null)).toBe('es');
      expect(normalizeLocale(undefined)).toBe('es');
    });
  });

  describe('textos', () => {
    it('los dos idiomas tienen todas las claves', () => {
      // Si a uno le faltara una, el correo saldría con un hueco.
      expect(Object.keys(t('es'))).toEqual(Object.keys(t('en')));
      expect(Object.keys(t('es').confirmation)).toEqual(
        Object.keys(t('en').confirmation),
      );
      expect(Object.keys(t('es').downloads)).toEqual(
        Object.keys(t('en').downloads),
      );
    });

    it('cada idioma escribe lo suyo', () => {
      expect(t('es').confirmation.subject(42)).toContain('confirmado');
      expect(t('en').confirmation.subject(42)).toContain('confirmed');
      expect(t('es').downloads.thanks).toContain('Gracias');
      expect(t('en').downloads.thanks).toContain('Thanks');
    });

    it('el saludo funciona con y sin nombre', () => {
      expect(t('es').confirmation.greeting('Ana')).toBe('Hola Ana,');
      expect(t('es').confirmation.greeting(null)).toBe('Hola,');
      expect(t('en').confirmation.greeting('Ana')).toBe('Hi Ana,');
      expect(t('en').confirmation.greeting(null)).toBe('Hi,');
    });

    it('un idioma desconocido devuelve los textos en español', () => {
      expect(t('fr').signature).toBe(t('es').signature);
      expect(t(undefined).confirmation.shipTo).toBe(
        t('es').confirmation.shipTo,
      );
    });
  });
});
