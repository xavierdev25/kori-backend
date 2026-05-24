# kori-backend

Backend NestJS para el muro publico y dashboard privado de Kori.

## Requisitos

- Node.js compatible con NestJS 11
- pnpm
- PostgreSQL en Supabase
- Supabase Storage con un bucket publico llamado `notes`

## Configuracion

1. Crea `.env` tomando como base `.env.example`.
2. Genera el hash bcrypt para la contrasena funcional `diciembre2026`:

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('diciembre2026', 12).then(console.log)"
```

3. Usa el resultado en `ADMIN_PASSWORD_HASH`.
4. Define `JWT_SECRET` con un valor fuerte de al menos 32 caracteres.
5. Configura `LANDING_ORIGIN` y `DASHBOARD_ORIGIN` con los dominios reales permitidos.

## Prisma

```bash
pnpm install
pnpm run prisma:generate
pnpm run prisma:migrate:deploy
```

Para desarrollo local con una base de datos descartable:

```bash
pnpm run prisma:migrate:dev
```

## Ejecutar

```bash
pnpm run start:dev
```

El servicio escucha en `PORT`, por defecto `4000`.

## Tests

```bash
pnpm run test
pnpm run test:e2e
pnpm run build
```

## Probar endpoints

Health:

```bash
curl http://localhost:4000/health
```

Crear nota de texto:

```bash
curl -X POST http://localhost:4000/notes/text \
  -H "Content-Type: application/json" \
  -d '{"recipientName":"Kori","message":"Mensaje desde el inconsciente"}'
```

Listar muro publico:

```bash
curl http://localhost:4000/notes/public
```

Crear nota de dibujo:

```bash
curl -X POST http://localhost:4000/notes/drawing \
  -F "recipientName=Kori" \
  -F "file=@./drawing.png;type=image/png"
```

Login admin:

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"kori","password":"diciembre2026"}'
```

Listar notas admin:

```bash
curl http://localhost:4000/admin/notes \
  -H "Authorization: Bearer <token>"
```

Stats:

```bash
curl http://localhost:4000/admin/notes/stats \
  -H "Authorization: Bearer <token>"
```

Borrar nota:

```bash
curl -X DELETE http://localhost:4000/admin/notes/<id> \
  -H "Authorization: Bearer <token>"
```
