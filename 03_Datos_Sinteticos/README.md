# Datos sintéticos utilizados

La base de ECONOLAB todavía no contiene suficiente historial real para
entrenar y evaluar las soluciones. Por ello se incluyen dos procesos
reproducibles de generación. En la entrega académica estos registros **no se
presentan como reales**.

## Catálogo de estudios para regresión y clustering

- Script entregable: `01_seed_catalogo_estudios.sql` (copia sincronizada de
  `backend/sql/seed-study-estimation-training.sql`).
- Lote identificable: códigos `ECN-CAT-000001` a `ECN-CAT-001000`.
- Cantidad: 1,000 estudios y sus parámetros relacionados.
- Reglas: precios, método, tipo de muestra, duración, procesamiento especial y
  cantidad de parámetros se generan mediante fórmulas deterministas.
- Uso: cada estudio es una observación de regresión y clustering.

En la extracción se genera la columna de auditoría `is_synthetic`. Esta
columna permite calcular la proporción, pero nunca se usa como variable X ni
como entrada de K-Means.

Con el corte del 21 de julio de 2026:

- regresión: 1,000 de 1,048 filas son sintéticas (`95.42 %`);
- clustering: 1,000 de 1,048 estudios individuales son sintéticos (`95.42 %`).

## Historial de servicios para clasificación

- Script entregable: `02_seed_historial_servicios.sql` (copia sincronizada de
  `backend/sql/seed-service-outcome-training.sql`).
- Lote identificable: folios `ECO-ML-000001` a `ECO-ML-000500`.
- Cantidad: 500 órdenes relacionadas con pacientes, médicos, estudios e
  ítems existentes.
- Clases: conclusión en tiempo, retraso y cancelación.
- Uso: cada orden histórica válida es una observación de clasificación.

El script utiliza una fecha de referencia y reglas deterministas. Las variables
operativas contienen solapamiento entre clases para evitar que la predicción
se reduzca a una regla perfecta. La columna de auditoría `is_synthetic` se
exporta al CSV, pero no es una variable predictora.

Con el corte del 21 de julio de 2026, 500 de las 512 filas clasificables son
sintéticas (`97.66 %`) y 12 provienen del historial anterior (`2.34 %`).

## Reproducibilidad y relaciones

Los scripts:

- se ejecutan dentro de transacciones;
- usan folios y códigos reservados para evitar duplicados;
- pueden ejecutarse nuevamente sobre el mismo lote;
- conservan las llaves foráneas y relaciones de la base;
- incluyen verificaciones que abortan ante datos incompletos;
- no crean un CSV manual aislado de PostgreSQL.

Los pacientes y médicos no se exportan a los datasets analíticos. De esta
forma, las libretas y artefactos no contienen nombres, teléfonos, correos ni
otra información personal.

## Limitación obligatoria al interpretar métricas

Las métricas obtenidas sirven para comprobar el proceso técnico y la
integración. Debido a la alta proporción sintética, no deben interpretarse como
rendimiento productivo. Antes de usar los modelos para decisiones reales se
deberán acumular más observaciones reales, volver a entrenar y evaluar por
separado el subconjunto real.
