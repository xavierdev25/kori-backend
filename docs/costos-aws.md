# Costos de AWS: dónde está el gasto y cómo bajarlo

Revisión del 22 de noviembre de 2026, con los recursos y las métricas reales de
la cuenta (consultas de solo lectura: `describe-*` y CloudWatch). Cost Explorer
no está habilitado para el usuario `xavierdev25`, así que los montos son
**estimaciones con precios de lista de us-east-1** (bajo demanda, Linux). La
factura real puede variar por créditos, impuestos o capa gratuita: compárala en
*Billing → Bills*.

## Lo que paga kor! hoy

| Recurso | Qué es | USD/mes aprox. |
| --- | --- | ---: |
| EC2 `kori-api` | t4g.small (2 vCPU Graviton, 2 GB) | 12.26 |
| IPv4 pública | la IP elástica de `kori-api` | 3.65 |
| EBS | 8 GB gp3 de `kori-api` | 0.64 |
| RDS `kori-db` | db.t4g.micro, PostgreSQL 17.9, una zona, privada | 11.68 |
| Almacenamiento RDS | 20 GB gp3 (se usan ~1.6 GB) | 2.30 |
| ECR `kori-backend` | 44 imágenes, 7.1 GB, **sin política de limpieza** | 0.71 y creciendo |
| Performance Insights, backups, SSM | dentro de la capa gratuita | 0 |
| **Total** | | **≈ 31** |

Lo que ya está bien y no hay que tocar: no hay balanceador (ALB, desde 16
USD/mes), no hay NAT Gateway (desde 32 USD/mes), la base no es pública, todo es
Graviton (~20 % más barato que x86), el despliegue es por OIDC + SSM (sin claves
ni bastión) y la página va en Cloudflare (gratis, con CDN).

## Lo que dicen las métricas (últimos 14 días)

| | Promedio | Máximo |
| --- | ---: | ---: |
| CPU de `kori-api` | 0.9 % | 8.2 % |
| Créditos de CPU de `kori-api` | 576 (el tope: nunca los gasta) | |
| CPU de `kori-db` | 4 % | 35.5 % |
| Memoria libre de `kori-db` | 177 MB | |
| Conexiones a `kori-db` | 4 | 4 |

La EC2 está sobrada: con una t4g.micro (1 GB) basta. La base está bien
dimensionada: db.t4g.micro es la más chica que tiene sentido.

## El plan, por orden

### 1. Limpieza de ECR (automático con este PR) — ahorra ~0.6 USD/mes y frena el crecimiento

`deploy.yml` aplica `.github/ecr-lifecycle-policy.json` en cada despliegue: se
quedan las 15 imágenes más recientes (para volver atrás) y las sin etiqueta se
borran al día siguiente. Si el rol de despliegue no tiene
`ecr:PutLifecyclePolicy`, el paso avisa y no falla; se puede aplicar una vez a
mano:

```bash
aws ecr put-lifecycle-policy --repository-name kori-backend --lifecycle-policy-text file://.github/ecr-lifecycle-policy.json
```

### 2. Pasar `kori-api` a t4g.micro — ahorra ~6.1 USD/mes

La imagen ya trae `NODE_OPTIONS=--max-old-space-size=384` para caber en 1 GB.
Antes de cambiar, confirma la memoria real en la instancia (desde *Systems
Manager → Session Manager*):

```bash
free -m && docker stats --no-stream
```

Si el contenedor usa menos de ~400 MB, adelante. Conviene esperar a que pase el
pico de la promoción de diciembre. El cambio son 1–2 minutos sin servicio:
detener la instancia, *Actions → Instance settings → Change instance type →
t4g.micro*, arrancarla. La IP elástica se queda.

Recomendado también: un archivo de swap de 1 GB en la instancia, como colchón.

### 3. Comprometer un año — ahorra ~5 USD/mes más

- **RDS reservada** db.t4g.micro, 1 año, sin pago adelantado: ~30 % menos.
- **Compute Savings Plan** de 1 año sin pago adelantado por lo que cueste la
  EC2 que quede: ~20–30 % menos.

Hazlo **después** del paso 2, para no reservar una máquina que vas a cambiar.

### Resultado

| | USD/mes aprox. |
| --- | ---: |
| Hoy | 31 |
| Con 1 + 2 | 24.5 |
| Con 1 + 2 + 3 | **≈ 19–20** (−35 a −40 %) |

## Lo que NO conviene (y por qué)

- **Meter PostgreSQL en la misma EC2 para quitar RDS.** Se ahorrarían ~14 USD,
  pero la EC2 tendría que seguir siendo t4g.small para que quepan los dos, y
  perderías respaldos automáticos, recuperación a un punto en el tiempo y
  parches gestionados. La diferencia final contra el plan de arriba es de
  ~2–3 USD/mes: no vale el riesgo para una base con pedidos.
- **Lightsail.** El paquete con IPv4 y base gestionada sale en ~22–27 USD/mes:
  no mejora el plan de arriba.
- **Multi-AZ, réplicas de lectura, balanceador, Kubernetes.** Con 1 % de CPU no
  hay carga que lo justifique; duplicarían la factura.
- **Quitar la IP pública** (Cloudflare Tunnel). La instancia la sigue
  necesitando para salir a ECR, Stripe y Resend; sin ella habría que pagar un
  NAT Gateway, que cuesta 10 veces más.

## Confiabilidad: un cambio que no cuesta casi nada

`kori-db` guarda **1 día** de respaldos automáticos: si un error borra datos y
nadie lo nota en 24 horas, no hay forma de recuperarlos. Los respaldos son
gratis hasta el tamaño de la base (20 GB y se usan 1.6), así que subirlo a 7
días no cambia la factura:

```bash
aws rds modify-db-instance --db-instance-identifier kori-db --backup-retention-period 7 --apply-immediately
```

## Menos carga en el backend con Cloudflare (gratis)

Las lecturas públicas ya responden con `Cache-Control: public` (el archivo de
cartas: 60 s). Una regla de caché en Cloudflare las sirve desde el borde sin
tocar la EC2:

- *Caching → Cache Rules → Create rule*: `URI Path equals /experience/letters`
  y método `GET` → *Eligible for cache*, *Edge TTL: respect origin*.

Además el backend guarda el archivo 30 s en memoria y lo invalida al moderar.

## Fuera de kor!, en la misma cuenta

La cuenta también tiene `xavierdev-contact` (otra t4g.small con IP pública:
~16.5 USD/mes), `ai-cylinder-service` (1.4 GB en ECR, logs de ECS) y
`translogix`. No se tocaron. Si `xavierdev-contact` es un formulario de
contacto, como Lambda o un Worker de Cloudflare costaría prácticamente 0.

## Volver atrás un despliegue

Cada despliegue deja una imagen con la etiqueta del commit (se guardan las 15
últimas). Para volver a una, en la instancia:

```bash
cd /home/ec2-user && docker pull <registro>/kori-backend:<sha> && docker tag <registro>/kori-backend:<sha> <registro>/kori-backend:latest && docker compose up -d api
```

Las migraciones son aditivas por norma del proyecto, así que la versión
anterior funciona con el esquema nuevo.
