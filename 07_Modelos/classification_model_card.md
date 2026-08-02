# Model card - clasificacion del resultado de servicios

## Proposito

Pronostica `completed_on_time`, `delayed` o `cancelled` al registrar o consultar
una orden activa. Es apoyo administrativo: no cambia estados, no bloquea
servicios y no toma decisiones clinicas.

## Datos y trazabilidad

- Unidad: una orden historica.
- CSV canonico: `05_Datasets/03_clasificacion_resultado_servicios.csv`.
- Artefacto serializado: `07_Modelos/classification_service_outcome_model.pkl`.
- Metadatos JSON: `07_Modelos/classification_service_outcome_model.json`.
- Y: `outcome`.
- X: promisedLeadHours, registrationHour, registrationWeekday, itemCount, totalQuantity, distinctStudyCount, packageComponentCount, subtotalAmount, courtesyPercent, discountAmount, totalAmount, branchName, dominantPriceType.
- Solo auditoria, nunca X: ID, folio, fechas e `is_synthetic`.
- Periodo elegible: 2025-11-01T14:07:00+00:00 a 2026-07-31T18:03:00+00:00.
- SHA-256 del CSV: `5e7ad7a98908c3505c53c86f882c3cbff71f679198a0e7d5468f49984661b2a2`.

## Modelo y validacion

- Regresion logistica multinomial.
- Holdout temporal con 1600 filas de train y 400 de test.
- Accuracy: 0.795.
- Accuracy baseline: 0.5925.
- Macro F1: 0.7649.

