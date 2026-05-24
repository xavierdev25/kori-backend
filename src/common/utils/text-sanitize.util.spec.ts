import { sanitizePlainText } from './text-sanitize.util';

describe('sanitizePlainText', () => {
  it('removes HTML tags', () => {
    expect(sanitizePlainText('<strong>hola</strong> kori')).toBe('hola kori');
  });

  it('removes scripts', () => {
    expect(sanitizePlainText('hola<script>alert("x")</script>')).toBe('hola');
  });

  it('keeps plain text', () => {
    expect(sanitizePlainText('mensaje simple')).toBe('mensaje simple');
  });
});
