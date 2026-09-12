/**
 * Las pruebas de extremo a extremo levantan la aplicacion entera, asi que
 * pasan por `sanitize-html` igual que las unitarias y necesitan el mismo
 * arreglo de ESM. Ver `jest.esm-cjs.cjs`.
 */
const { transform, transformIgnorePatterns } = require('../jest.esm-cjs.cjs');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.e2e-spec.ts$',
  transform,
  transformIgnorePatterns,
  setupFiles: ['./jest-e2e-setup.ts', './jest-silence-logger.ts'],
};
