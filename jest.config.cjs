/**
 * Sale de `package.json` para poder compartir el arreglo de ESM con la
 * configuracion de extremo a extremo: un JSON no puede importar nada.
 */
const { transform, transformIgnorePatterns } = require('./jest.esm-cjs.cjs');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform,
  transformIgnorePatterns,
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../test/jest-silence-logger.ts'],
};
