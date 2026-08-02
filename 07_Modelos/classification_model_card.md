# Model card - clasificacion del resultado de servicios

## Proposito

Pronostica `completed_on_time`, `delayed` o `cancelled` al registrar o
consultar una orden activa. Es apoyo administrativo: no cambia estados, no
bloquea servicios y no toma decisiones clinicas.

## Datos y trazabilidad

- Unidad: una orden historica.
- CSV canonico: `05_Datasets/03_clasificacion_resultado_servicios.csv`.
- Y: `outcome`.
- X: promisedLeadHours, registrationHour, registrationWeekday, itemCount, totalQuantity, distinctStudyCount, packageComponentCount, subtotalAmount, courtesyPercent, discountAmount, totalAmount, branchName, dominantPriceType.
- Solo auditoria, nunca X: ID, folio, fechas de creacion/actualizacion e `is_synthetic`.
- Periodo elegible: 2025-11-01T14:07:00.000Z a 2026-07-31T18:03:00.000Z.
- SHA-256 del CSV: `c863ad7b0cc9f91a18bd32a00f0a497b2918e9908a08890d81ff451f96cd1f44`.
- Calidad: 2000 filas aceptadas y 0 rechazadas.
- Procedencia: 1988 sinteticas y 12 reales.

## Modelo y validacion

- Regresion logistica multinomial.
- Holdout temporal con 1600 filas de train y 400 de test.
- Accuracy: 0.765.
- Accuracy baseline: 0.5925.
- Macro F1: 0.7249.

| Clase | Precision | Recall | F1 | Soporte |
| --- | ---: | ---: | ---: | ---: |
| completed_on_time | 0.8578 | 0.8397 | 0.8486 | 237 |
| delayed | 0.6893 | 0.5635 | 0.6201 | 126 |
| cancelled | 0.5538 | 0.973 | 0.7059 | 37 |
