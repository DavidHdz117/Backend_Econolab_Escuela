# Edición administrativa escolar — 6 de noviembre de 2026

El módulo /school conserva autenticación y perfil del servidor y crea un espacio privado por usuario. No consulta ni modifica las tablas de estudios, pacientes, resultados, servicios del laboratorio o cortes anteriores. AppModule registra SchoolModule de forma aditiva.

## Persistencia
SchoolService crea school_workspace con clave primaria user_id y FK a user(id) ON DELETE CASCADE. El estado JSONB contiene catálogo genérico, actividades y consentimiento del aviso Aula. Las operaciones usan transacciones y SELECT FOR UPDATE con user_id parametrizado. No se activa synchronize ni se borran tablas existentes. Cada cuenta comienza con tres ejemplos genéricos y cero actividades.

## Contratos
- GET /api/school/workspace
- POST /api/school/catalog: name, description, priceCents
- PATCH /api/school/catalog/:id: active
- POST /api/school/activities: itemId, quantity, date (AAAA-MM-DD)
- DELETE /api/school/activities/:id: conserva la actividad cancelada
- GET /api/school/cuts?from=AAAA-MM-DD&to=AAAA-MM-DD: requiere rol admin
- DELETE /api/school/workspace: reinicia sólo el espacio propio, conserva consentimiento
- GET /api/school/privacy/notice
- GET/PATCH /api/school/privacy/preferences
- GET /api/school/privacy y /api/school/privacy/account-deletion: HTML público

Los importes se guardan en centavos enteros y cada actividad conserva el importe histórico. No se procesan pagos. Límites: 100 servicios, 500 actividades, cantidad de 1 a 1000 y consultas de hasta 366 días. Las cuentas y sus sesiones siguen usando los módulos de autenticación existentes; DELETE /api/account elimina también el espacio por cascada.

## Verificación realizada
- Compilación Nest.
- Ocho pruebas unitarias del nuevo módulo.
- scripts/school-smoke.cjs: 19 comprobaciones HTTP con PostgreSQL local y estrategia JWT real; autenticación, aislamiento, rol, DTO, consentimiento, cancelaciones y total exacto.
- Diez escrituras simultáneas sin pérdida de registros.
- Eliminación de usuario ficticio y verificación de cascada.
El script rechaza bases remotas y nombres que no terminen en _test. No carga .env ni usa credenciales del servidor publicado.

Ejecutar después de npm run build y con PostgreSQL de pruebas disponible:
SCHOOL_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/econolab_school_test node scripts/school-smoke.cjs

La revisión de Google Play de la aplicación móvil es independiente de estas pruebas y no se garantiza su aprobación.

