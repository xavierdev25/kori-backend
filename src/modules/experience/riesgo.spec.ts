import { hayRiesgo } from './riesgo';

describe('hayRiesgo', () => {
  it('detecta frases de hacerse daño, sin importar acentos ni mayúsculas', () => {
    for (const texto of [
      'Ya no quiero vivir',
      'a veces pienso en hacerme DAÑO',
      'quiero morirme',
      'pensé en el suicidio',
      'I want to die',
    ]) {
      expect(hayRiesgo(texto)).toBe(true);
    }
  });

  it('deja pasar una carta triste que no habla de eso', () => {
    expect(hayRiesgo('Te extraño cada diciembre. Ojalá vuelvas.')).toBe(false);
  });
});
