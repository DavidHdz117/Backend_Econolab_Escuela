# Model card — clasificación del resultado de servicios

## Propósito

Pronostica `completed_on_time`, `delayed` o `cancelled` al registrar o
consultar una orden activa. Es apoyo administrativo: no cambia estados, no
bloquea servicios y no toma decisiones clínicas.

## Datos y trazabilidad

- Unidad: una orden histórica.
- SQL: `04_ETL/03_clasificacion_extraer_dataset.sql`.
- CSV: `05_Datasets/03_clasificacion_resultado_servicios.csv`.
- Y: `outcome`, obtenida solo de estado y fechas finales.
- X: promisedLeadHours, registrationHour, registrationWeekday, itemCount, totalQuantity, distinctStudyCount, subtotalAmount, courtesyPercent, discountAmount, totalAmount, branchName, dominantPriceType.
- Solo auditoría, nunca X: ID, folio, fechas de creación/actualización e `is_synthetic`.
- Periodo elegible: 2025-11-01T14:07:00.000Z a 2026-06-28T13:00:00.000Z.
- SHA-256 del CSV: `41e6207feb0aeba5d2eb74674e2cf42de7d45a22c03fac8d2e62bdf4d2bce6ed`.
- Calidad: 512 filas aceptadas, 11 rechazadas y 0 IDs duplicados.
- Procedencia: 500 sintéticas y 12 reales (0.9766 sintético).

## EDA de variables X y decisiones

- El reporte JSON conserva estadísticos descriptivos, cardinalidad, proporción dominante y outliers IQR de cada X candidata.
- Se excluyen del artefacto las variables constantes o con al menos 99 % del mismo valor aprendidas en train: package_component_count.
- Los valores extremos IQR se conservan si son válidos operativamente; el escalado se aprende solo con train y se debe vigilar su deriva.

## Modelo y validación

- Regresión logística multinomial.
- Holdout temporal: las primeras 410 órdenes (2025-11-01T14:07:00.000Z a 2026-05-11T13:24:00.000Z) forman train y las 102 más recientes (2026-05-12T14:31:00.000Z a 2026-06-28T13:00:00.000Z) forman test.
- Las tres clases están presentes en train y test; no se estratifica ni se mezclan fechas futuras.
- Imputación, estandarización, one-hot y pesos del artefacto desplegado se aprenden solo con train.
- Desbalance tratado con pesos inversos por clase.
- Baseline: clase mayoritaria de train.

| Métrica | Clasificador | Baseline |
| --- | ---: | ---: |
| Accuracy | 0.7647 | 0.5588 |
| Macro F1 | 0.7146 | 0.239 |

| Clase | Precision | Recall | F1 | Soporte |
| --- | ---: | ---: | ---: | ---: |
| completed_on_time | 0.875 | 0.8596 | 0.8673 | 57 |
| delayed | 0.7 | 0.5833 | 0.6364 | 36 |
| cancelled | 0.5 | 0.8889 | 0.64 | 9 |

## Despliegue

El backend carga `classification_service_outcome_model.json` una vez y lo
conserva en memoria. Las solicitudes solo realizan inferencia; no reentrenan.

`npm run classification:train` regenera CSV, reporte, model card y artefacto.
`npm run classification:notebook` ejecuta la evidencia visual.

## Limitaciones

La proporción sintética actual es 0.9766. Las métricas
validan el prototipo, no garantizan desempeño productivo. Se requiere acumular
historial real, validar por periodo/sucursal, revisar falsos negativos y vigilar
deriva antes de usar el resultado para decisiones operativas.
