# Perfil autenticado para Econolab móvil

Solicitud del propietario del 6 de octubre de 2026: completar la consulta y edición del perfil. Este cambio amplía el backend existente y reutiliza su tabla User, su JWT, la revocación y sus guards. HU06 móvil #7; consulta #28, edición #29 en Josafock/Econolab-Movil. No cambia el esquema ni crea otra API o base de datos.

## Contratos

- `GET /api/users/me`: Bearer obligatorio, rol admin o recepcionista. Devuelve exclusivamente `{ id, nombre, email, rol }` del usuario identificado por el JWT y leído desde la base existente.
- `PATCH /api/users/me`: mismos guards. Acepta `nombre` y/o `email`; si se cambia el correo, requiere `current_password`. Devuelve `{ message: "Perfil actualizado", usuario: { id, nombre, email, rol } }` después de persistir y volver a leer.
- Nombre: trim, 2–50 caracteres, sin `<` ni `>`. Correo: trim y minúsculas, formato válido, hasta 50 caracteres. Estos límites coinciden con las columnas reales; no se amplían silenciosamente.
- ID, rol, password, confirmed, token y demás campos están rechazados por el ValidationPipe existente. Nunca se reciben IDs en la ruta o cuerpo para elegir otra cuenta. El update solo escribe los campos personales autorizados.
- Correo ya registrado: 409, incluyendo una carrera detectada por el índice único de PostgreSQL. Contraseña incorrecta: 401; sin contraseña para correo nuevo o cuerpo vacío: 400. La comprobación del correo existente ignora mayúsculas.

El cambio de correo no envía emails ni acredita la propiedad del correo nuevo. Requiere la contraseña vigente; se conserva el mecanismo existente de confirmación de cuenta. La aplicación explica que el nuevo correo se usa en futuros logins. La sesión actual sigue siendo válida; el JWT y la identidad firmada del login no se reescriben desde la interfaz.

## Verificación

Build Nest aprobado. 22 pruebas nuevas del servicio y DTO, incluyendo campos protegidos, límites, normalización, contraseña y conflicto concurrente. Se ejecutaron las siete suites del backend: 52 pruebas aprobadas con `PYTHONIOENCODING=utf-8` y `PYTHONUTF8=1` para las pruebas Python existentes en Windows. El modelo de clasificación existente reporta su fallback TypeScript por incompatibilidad de su pickle; no se modificó ese módulo.

El HTTP real de los módulos Users/Auth, con la base existente y el esquema sincronizado desactivado, aprobó acceso anónimo rechazado, lectura de campos públicos, rechazo de campos protegidos, cambio de nombre, contraseña para cambiar correo, persistencia, login con el correo nuevo, restauración y revocación. Solo se modificó temporalmente la cuenta independiente autorizada, que se restauró. La prueba no envió correos ni ejecutó jobs.

El workflow `profile.yml` instala desde lockfile, revisa el código nuevo, ejecuta sus pruebas y compila Nest. También valida los cambios en `main` y admite ejecución manual; las comprobaciones siguen activas después de integrar el PR.

El propietario autorizó explícitamente integrar el backend el 6 de octubre. El PR1 quedó integrado en `main` mediante el commit `933215a`; los PR y la rama `main` del móvil se conservan sin merges. El despliegue publicado requiere actualizar el servicio existente de Render. No se da por publicado solamente porque pase la prueba local o porque el PR esté integrado.
