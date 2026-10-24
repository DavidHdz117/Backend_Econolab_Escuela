# Sesiones móviles y privacidad

Implementación para las tareas existentes HU03, HU06, HU07 y HU08 del proyecto móvil. Se amplía la API actual; no se crea otra base ni otro backend.

## Contratos

- `POST /api/auth/login`: conserva el contrato web. Con `mobile: true` emite access JWT de 15 minutos, `refreshToken` opaco y `refreshExpiresAt` (máximo 30 días de sesión).
- `POST /api/auth/refresh`: recibe `{ refreshToken }`, lo consume una sola vez y devuelve una nueva pareja. Solo se persisten hashes SHA-256. Reutilizar un token consumido revoca la sesión completa; el resultado de la transacción se confirma antes de devolver 401.
- `POST /api/auth/mobile/logout`: revoca por la credencial de renovación, incluso con access JWT vencido. No usa cookies ni una contraseña almacenada.
- `GET/PATCH /api/users/me` siguen disponibles. `GET/PUT /api/profile` son aliases del perfil propio con la misma validación, autorización y confirmación de contraseña al cambiar correo.
- `GET /api/privacy/notice`: contenido del aviso y versión actual, sin autenticación.
- `GET /api/privacy`: aviso HTML público; `GET /api/privacy/account-deletion`: instrucciones de cancelación fuera de la app.
- `GET/PATCH /api/privacy/preferences`: preferencias del sujeto autenticado. Consentimiento explícito, versión y fecha, más dos finalidades opcionales apagadas por defecto. Los booleanos enviados como cadenas no se convierten en aceptación.
- `DELETE /api/account`: recibe contraseña actual y `confirmation: "ELIMINAR MI CUENTA"`; cancela exclusivamente al sujeto autenticado. El último administrador confirmado no puede eliminarse sin dejar otro responsable.

El borrado elimina la cuenta de acceso, sesiones, hashes de refresh, preferencias y logs de acceso asociados. **No elimina pacientes, servicios, estudios ni resultados clínicos.** Las solicitudes sobre esos expedientes deben atenderse por el laboratorio conforme a su aviso específico. No se ejecutó cancelación sobre usuarios reales como parte del desarrollo.

El alumno confirmó como contacto a Jesús David Saldaña Hernández, `20230009@uthh.edu.mx`. Se pueden sustituir mediante `PRIVACY_CONTROLLER` y `PRIVACY_SUPPORT_EMAIL`. Este aviso cubre la cuenta móvil y requiere revisión del responsable para sus procesos y datos reales; no se anuncia como certificación legal del laboratorio.

## Datos y despliegue

`MobileSchemaService` ejecuta una migración aditiva e idempotente al arrancar, dentro de transacción y con bloqueo de migración: crea `mobile_refresh_tokens` y `account_privacy`, sus FK e índice. No altera tablas existentes ni activa `synchronize` en producción. Necesita permiso para crear esas dos tablas en el esquema de la aplicación. Si no puede hacerlo, el arranque falla y debe revisarse el log del despliegue; no continuar con una app que anuncie contratos inexistentes.

Las sesiones antiguas siguen siendo JWT de 30 días. Las nuevas sesiones móviles usan access de 15 minutos y vencimiento absoluto de refresh de 30 días. Cambiar el rol o retirar la confirmación bloquea el acceso y la renovación. La rotación se serializa con bloqueo de fila en la sesión; el cliente debe agrupar 401 concurrentes para no reutilizar refresh.

Se retiró la asignación automática de administrador al registrarse, incluida la entrada con Google. Las cuentas nuevas quedan pendientes de asignación por un administrador existente. No se modificaron los roles de las cuentas ya existentes.

## Verificación

- `npm run build`.
- Pruebas existentes de perfil y validación.
- `npm run test:mobile-security`: prueba dinámica HTTP con NestJS real y PostgreSQL local; comprueba JWT, rotación, reutilización, concurrencia, logout, perfil y ARCO. La base debe terminar en `_test`, el host debe ser loopback y `NODE_ENV=test`. El script ignora `.env`, crea cuentas desechables y limpia esas cuentas al terminar. **Nunca apuntarlo a Render ni a una base de trabajo.**
- `.github/workflows/mobile-security.yml` levanta PostgreSQL de pruebas y conserva `reports/mobile-security/dast.json`.

La aplicación móvil debe desplegarse después de que estos endpoints estén disponibles. La publicación a Google Play y la aceptación de sus acuerdos corresponden al titular.
