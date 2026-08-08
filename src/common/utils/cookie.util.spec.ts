import { parseCookieHeader } from './cookie.util';

describe('parseCookieHeader', () => {
  it('lee varias cookies', () => {
    expect(parseCookieHeader('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('sin cabecera devuelve vacio', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('')).toEqual({});
  });

  it('decodifica valores escapados', () => {
    expect(parseCookieHeader('t=a%20b')).toEqual({ t: 'a b' });
  });

  it('un JWT sobrevive intacto', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abc-_123';

    expect(parseCookieHeader(`kori_access_token=${jwt}`)).toEqual({
      kori_access_token: jwt,
    });
  });

  it('ignora segmentos sin nombre', () => {
    expect(parseCookieHeader('=huerfano; valido=1; ;')).toEqual({
      valido: '1',
    });
  });

  it('gana la primera aparicion, como en el navegador', () => {
    expect(parseCookieHeader('a=primero; a=segundo')).toEqual({ a: 'primero' });
  });

  it('un valor mal codificado no rompe la peticion', () => {
    // '%zz' no es un escape valido: decodeURIComponent lanzaria.
    expect(parseCookieHeader('roto=%zz; bueno=1')).toEqual({
      roto: '%zz',
      bueno: '1',
    });
  });

  it('quita las comillas de un valor entrecomillado', () => {
    expect(parseCookieHeader('a="valor"')).toEqual({ a: 'valor' });
  });

  it('acepta valores vacios', () => {
    expect(parseCookieHeader('a=; b=2')).toEqual({ a: '', b: '2' });
  });
});
