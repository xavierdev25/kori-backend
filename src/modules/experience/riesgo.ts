import { normalizar } from './event-zone';

/**
 * Una carta que habla de hacerse daño no se publica (la página le muestra a
 * quien la escribió dónde pedir ayuda). Es la segunda barrera: la página ya
 * la detiene antes de enviarla, y la moderación humana revisa todas las
 * públicas. Misma lista que `hayRiesgo` en el frontend.
 */
const RIESGO =
  /suicid|matarme|quitarme la vida|me quiero morir|quiero morirme|no quiero vivir|ya no quiero estar aqui|hacerme dano|cortarme|lastimarme|kill myself|want to die|end my life|hurt myself/;

export const hayRiesgo = (texto: string): boolean =>
  RIESGO.test(normalizar(texto));
