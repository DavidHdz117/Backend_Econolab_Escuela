# Cortes por fecha para la app móvil

Solicitud del 20 de octubre de 2026. Trazabilidad móvil: HU04 #4, dashboard #22, menú #23 y acceso a módulo #24. La planeación mantiene HU04 en Sprint 3; esta ampliación posterior no modifica su Sprint, fechas ni estado.

## Contrato

`GET /api/cash-cuts?fromDate=2026-10-20&toDate=2026-10-20&page=1&limit=20&branchName=Centro`

JWT y rol **admin** obligatorios. Recepción recibe 403 y una sesión anónima, expirada o revocada recibe 401. El periodo admite fechas reales AAAA-MM-DD, ordenadas e inclusivas, hasta 366 días. La página es positiva, el límite máximo es 100 y la sucursal opcional se compara por nombre exacto tras recortar espacios.

La respuesta contiene `period`, `accounting`, `summary`, `daily`, `data` y `meta`. El resumen siempre abarca todo el periodo; solo `data` se pagina. Los importes son textos decimales con dos posiciones, para conservar centavos. El reporte lee únicamente folio, fecha, sucursal, estado e importes: no incorpora pacientes, médicos, notas ni resultados.

`summary` y cada día tienen `totalCount`, `serviceCount`, `cancelledCount`, `subtotalAmount`, `discountAmount`, `totalAmount` y `cancelledAmount`. Las órdenes activas canceladas se muestran aparte y se excluyen del neto; las órdenes dadas de baja no se incluyen. No se unen los estudios de una orden al calcular los totales, para evitar duplicarla por cada ítem.

La fecha es la del registro del servicio en **America/Mexico_City**. El sistema existente almacena `createdAt` como timestamp sin zona en UTC. Los límites locales se convierten a UTC; se usa un intervalo desde medianoche inclusive hasta medianoche del día posterior exclusiva. El resumen, los días y el detalle se leen con una transacción REPEATABLE READ.

## Alcance contable

Actualmente ServiceOrder registra importes de servicios, pero no tiene cobros, abonos, método de pago, retiros ni arqueos de efectivo. Por eso la respuesta declara `accounting: { basis: "service-registration", paymentsTracked: false }` y la interfaz identifica los importes como registrados, sin confirmar efectivo recibido. No se generan pagos retrospectivos ni se equipara automáticamente el estado completed con pagado.

Es una consulta de importes vigentes; no guarda cierres inmutables ni bloquea la edición de las órdenes. No altera contratos existentes de servicios ni agrega tablas, columnas, migraciones, API independiente o base de datos.

## Validación

21 pruebas nuevas de fechas, centavos, proyección pública, paginación, instantánea, cancelaciones, DTO y permisos. Regresión completa del backend: 77 pruebas en diez suites; build y lint del código nuevo aprobados. El workflow Cash cuts CI valida esta capacidad antes de integrarla.

El smoke de desarrollo ejecuta los controladores reales y compara el resultado con una lectura independiente de la base: valores exactos en centavos, cancelados, límites de fecha, paginación, sucursal vacía, anonimato y revocación. Usa una cuenta independiente y no escribe servicios o importes. No constituye un cierre de Sprint ni genera tags.
