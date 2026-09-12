/**
 * Lo que hace falta para que Jest pueda cargar `sanitize-html`.
 *
 * Desde la 2.17.6 depende de `htmlparser2@12`, que se publica solo como ESM,
 * igual que cinco paquetes mas de su arbol. Node 22 sabe hacer `require()` de
 * un ESM desde la 22.12 —y por eso la aplicacion compilada funciona sin
 * tocar nada—, pero Jest no usa el `require` de Node: resuelve los modulos
 * con su propio registro, y ahi un `import` suelto es un error de sintaxis.
 *
 * La alternativa era quedarse en 2.17.5, que es lo que se hizo la vez
 * anterior. Ya no vale: los dos avisos de seguridad que quedan son fallos del
 * propio `sanitize-html`, no de sus dependencias, asi que no hay nada que
 * parchear por debajo.
 *
 * Vive en un archivo aparte porque lo necesitan las dos configuraciones —las
 * pruebas unitarias y las de extremo a extremo—, y tenerlo escrito dos veces
 * es garantizar que un dia solo se actualice una.
 */

/**
 * La lista se saca recorriendo el arbol de `sanitize-html` y quedandose con
 * los que declaran `"type": "module"` sin salida CommonJS. Si al subir la
 * libreria aparece uno nuevo, Jest falla nombrandolo: se anade aqui.
 */
const SOLO_ESM = [
  'htmlparser2',
  'domhandler',
  'domutils',
  'domelementtype',
  'dom-serializer',
  'entities',
];

/**
 * Se ignora todo `node_modules` MENOS esos seis.
 *
 * El patron mira la ruta entera y no solo un tramo: con pnpm, un paquete vive
 * en `.pnpm/nombre@version/node_modules/nombre/…`, o sea que `node_modules`
 * aparece dos veces. Una excepcion escrita como `node_modules/(?!htmlparser2)`
 * la cazaria la segunda aparicion y no serviria de nada.
 */
const transformIgnorePatterns = [
  `^(?!.*[\\\\/]\\.pnpm[\\\\/](${SOLO_ESM.join('|')})@).*[\\\\/]node_modules[\\\\/]`,
];

/**
 * `commonjs` + `node` solo para las pruebas: el proyecto compila con
 * `nodenext`, pero ts-jest tiene que dejar estos paquetes en CommonJS para
 * que el registro de Jest pueda con ellos. `allowJs` es lo que le permite
 * tocar los `.js` de node_modules, que por defecto ni mira.
 */
const transform = {
  '^.+\\.(t|j)s$': [
    'ts-jest',
    {
      tsconfig: {
        allowJs: true,
        module: 'commonjs',
        moduleResolution: 'node',
        resolvePackageJsonExports: false,
        resolvePackageJsonImports: false,
      },
    },
  ],
};

module.exports = { transform, transformIgnorePatterns };
