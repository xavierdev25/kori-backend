/**
 * Comprueba que nada del codigo compilado exige un paquete que no estara en
 * produccion.
 *
 * Por que existe: el 16 de agosto de 2026 la API se paso seis horas en bucle
 * de reinicio con `Cannot find module '@nestjs/swagger'`. El fuente no lo
 * importaba en ninguna parte — lo inyectaba el plugin de `nest-cli.json` en
 * los ficheros ya compilados, y el paquete era dependencia de desarrollo. Cada
 * mitad era correcta por separado.
 *
 * Nada de lo que se pasaba antes de desplegar lo veia: los tests, el lint y el
 * build corren con las dependencias de desarrollo instaladas, asi que el
 * require se resolvia sin problema en todas partes menos donde importaba.
 * Esto mira lo unico que distingue a la imagen de produccion — que solo tiene
 * `dependencies`— sin necesidad de construirla.
 *
 * Solo mira `require(...)`, no `import(...)`: el import dinamico de Swagger en
 * main.ts es deliberado, vive dentro de un `if` que nunca se cumple en
 * produccion y por tanto nunca llega a resolverse.
 */
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { builtinModules } from "node:module";
import { basename, join } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;

/**
 * Los scripts que NO viajan a la imagen, segun `.dockerignore`.
 *
 * Se lee de ahi en vez de mantener otra lista: `.dockerignore` es lo que de
 * verdad decide que entra en la imagen, y dos listas que digan lo mismo acaban
 * diciendo cosas distintas. La prueba de carga, por ejemplo, usa `autocannon`
 * —dependencia de desarrollo— y se ejecuta desde fuera del contenedor.
 */
function scriptsQueNoViajan() {
  let ignorados = "";

  try {
    ignorados = readFileSync(join(raiz, ".dockerignore"), "utf8");
  } catch {
    return new Set();
  }

  const nombres = ignorados
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.startsWith("scripts/") && linea.endsWith(".ts"))
    .map((linea) => linea.slice("scripts/".length).replace(/\.ts$/, ".js"));

  return new Set(nombres);
}

const fueraDeLaImagen = scriptsQueNoViajan();
const paquete = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
const permitidos = new Set([
  ...Object.keys(paquete.dependencies ?? {}),
  ...builtinModules,
]);

/** "@nestjs/common/foo" -> "@nestjs/common"; "rxjs/operators" -> "rxjs" */
function nombreDelPaquete(especificador) {
  const partes = especificador.split("/");

  return especificador.startsWith("@")
    ? partes.slice(0, 2).join("/")
    : partes[0];
}

async function ficherosJs(directorio) {
  const encontrados = [];

  for (const entrada of await readdir(directorio, { withFileTypes: true })) {
    const ruta = join(directorio, entrada.name);

    if (entrada.isDirectory()) {
      encontrados.push(...(await ficherosJs(ruta)));
    } else if (entrada.name.endsWith(".js")) {
      encontrados.push(ruta);
    }
  }

  return encontrados;
}

const problemas = [];

// `dist/src` es lo que arranca el contenedor, y `dist/scripts` lo que se
// ejecuta a mano dentro de el —el alta de cuentas, por ejemplo—. Los dos
// corren con las dependencias de produccion, asi que los dos se comprueban.
//
// `dist/prisma.config.js` queda fuera a proposito: las migraciones corren en
// otra etapa de la imagen, que si tiene las dependencias de desarrollo.
const directorios = [join(raiz, "dist", "src"), join(raiz, "dist", "scripts")];
const aRevisar = [];

for (const directorio of directorios) {
  try {
    aRevisar.push(
      ...(await ficherosJs(directorio)).filter(
        (f) => !fueraDeLaImagen.has(basename(f)),
      ),
    );
  } catch {
    // `dist/scripts` no existe si no hay scripts que compilar: no es un fallo.
  }
}

for (const fichero of aRevisar) {
  const contenido = readFileSync(fichero, "utf8");

  for (const [, especificador] of contenido.matchAll(
    /require\(["']([^"'.][^"']*)["']\)/g,
  )) {
    const nombre = nombreDelPaquete(especificador);

    if (!permitidos.has(nombre) && !nombre.startsWith("node:")) {
      problemas.push(`${fichero.replace(raiz, "")}: ${nombre}`);
    }
  }
}

if (problemas.length > 0) {
  console.error(
    "El codigo compilado exige paquetes que no estaran en la imagen de produccion.\n" +
      "El contenedor arrancaria y moriria con MODULE_NOT_FOUND:\n",
  );
  for (const problema of [...new Set(problemas)].sort()) {
    console.error(`  ${problema}`);
  }
  console.error(
    "\nO se mueve el paquete a `dependencies`, o se deja de importar desde\n" +
      "codigo que acaba compilado (ojo con los plugins de nest-cli.json, que\n" +
      "inyectan requires que no estan en el fuente).",
  );
  process.exit(1);
}

console.log("OK: el codigo compilado solo exige dependencias de produccion.");
