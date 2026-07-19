-- ================================================================
-- ECONOLAB: dataset sintetico para el modelo de precio y duracion
-- PostgreSQL
--
-- Crea 1,000 estudios de entrenamiento y sus parametros.
-- Es idempotente: puede ejecutarse nuevamente sin duplicar registros.
-- Los registros quedan suspendidos y ocultos del catalogo operativo.
-- ================================================================

BEGIN;

WITH base AS (
  SELECT
    series_number,
    1 + ((series_number * 7) % 30) AS parameter_count,
    (ARRAY[
      'ENZIMATICO',
      'INMUNOENSAYO',
      'ESPECTROFOTOMETRIA',
      'COLORIMETRIA',
      'COAGULOMETRIA',
      'ELISA',
      'QUIMIOLUMINISCENCIA',
      'PCR'
    ])[1 + ((series_number - 1) % 8)] AS method
  FROM generate_series(1, 1000) AS series_number
),
features AS (
  SELECT
    *,
    CASE method
      WHEN 'ENZIMATICO' THEN 40
      WHEN 'INMUNOENSAYO' THEN 120
      WHEN 'ESPECTROFOTOMETRIA' THEN 70
      WHEN 'COLORIMETRIA' THEN 50
      WHEN 'COAGULOMETRIA' THEN 90
      WHEN 'ELISA' THEN 150
      WHEN 'QUIMIOLUMINISCENCIA' THEN 180
      WHEN 'PCR' THEN 350
    END AS price_method_effect,
    CASE method
      WHEN 'ENZIMATICO' THEN 15
      WHEN 'INMUNOENSAYO' THEN 60
      WHEN 'ESPECTROFOTOMETRIA' THEN 30
      WHEN 'COLORIMETRIA' THEN 20
      WHEN 'COAGULOMETRIA' THEN 45
      WHEN 'ELISA' THEN 90
      WHEN 'QUIMIOLUMINISCENCIA' THEN 120
      WHEN 'PCR' THEN 360
    END AS duration_method_effect
  FROM base
),
training_rows AS (
  SELECT
    *,
    GREATEST(
      50,
      ROUND((
        70
        + parameter_count * 22
        + price_method_effect
        + ((series_number * 37) % 51 - 25)
      ) / 10.0) * 10
    )::numeric(10, 2) AS normal_price,
    GREATEST(
      15,
      ROUND((
        15
        + parameter_count * 4
        + duration_method_effect
        + ((series_number * 13) % 21 - 10)
      ) / 15.0) * 15
    )::integer AS duration_minutes
  FROM features
)
INSERT INTO operativo.studies (
  name,
  code,
  description,
  "durationMinutes",
  "normalPrice",
  "difPrice",
  "specialPrice",
  "hospitalPrice",
  "otherPrice",
  "defaultDiscountPercent",
  method,
  indicator,
  "isActive",
  type,
  status,
  "packageStudyIds"
)
SELECT
  'ESTUDIO SINTETICO ML ' || LPAD(series_number::text, 6, '0'),
  'MLTRAIN-' || LPAD(series_number::text, 6, '0'),
  'Registro sintetico para entrenar el modelo. No usar en operacion.',
  duration_minutes,
  normal_price,
  ROUND(normal_price * 0.80, 2),
  ROUND(normal_price * 0.90, 2),
  ROUND(normal_price * 1.15, 2),
  ROUND(normal_price * 1.20, 2),
  0,
  method,
  'DATOS SINTETICOS',
  false,
  'study'::operativo.studies_type_enum,
  'suspended'::operativo.studies_status_enum,
  ARRAY[]::integer[]
FROM training_rows
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  "durationMinutes" = EXCLUDED."durationMinutes",
  "normalPrice" = EXCLUDED."normalPrice",
  "difPrice" = EXCLUDED."difPrice",
  "specialPrice" = EXCLUDED."specialPrice",
  "hospitalPrice" = EXCLUDED."hospitalPrice",
  "otherPrice" = EXCLUDED."otherPrice",
  "defaultDiscountPercent" = EXCLUDED."defaultDiscountPercent",
  method = EXCLUDED.method,
  indicator = EXCLUDED.indicator,
  "isActive" = EXCLUDED."isActive",
  type = EXCLUDED.type,
  status = EXCLUDED.status,
  "packageStudyIds" = EXCLUDED."packageStudyIds",
  "updatedAt" = NOW();

-- Cada estudio recibe entre 1 y 30 parametros.
WITH synthetic_studies AS (
  SELECT
    id,
    1 + ((REPLACE(code, 'MLTRAIN-', '')::integer * 7) % 30) AS parameter_count
  FROM operativo.studies
  WHERE code ~ '^MLTRAIN-[0-9]{6}$'
    AND indicator = 'DATOS SINTETICOS'
)
INSERT INTO operativo.study_details (
  study_id,
  parent_id,
  "dataType",
  name,
  "sortOrder",
  unit,
  "referenceValue",
  "isActive"
)
SELECT
  study.id,
  NULL,
  'parameter'::operativo.study_details_datatype_enum,
  'ML PARAMETRO ' || LPAD(parameter_number::text, 3, '0'),
  parameter_number,
  'unidad',
  'Rango de referencia sintetico',
  true
FROM synthetic_studies AS study
CROSS JOIN LATERAL generate_series(1, study.parameter_count) AS parameter_number
WHERE NOT EXISTS (
  SELECT 1
  FROM operativo.study_details AS detail
  WHERE detail.study_id = study.id
    AND detail."dataType" = 'parameter'::operativo.study_details_datatype_enum
    AND detail."sortOrder" = parameter_number
    AND detail.name LIKE 'ML PARAMETRO %'
);

COMMIT;

-- ================================================================
-- VERIFICACION: debe devolver 1,000 estudios.
-- ================================================================

SELECT
  COUNT(*) AS synthetic_studies,
  MIN("normalPrice") AS minimum_price,
  ROUND(AVG("normalPrice"), 2) AS average_price,
  MAX("normalPrice") AS maximum_price,
  MIN("durationMinutes") AS minimum_duration_minutes,
  ROUND(AVG("durationMinutes"), 2) AS average_duration_minutes,
  MAX("durationMinutes") AS maximum_duration_minutes
FROM operativo.studies
WHERE code ~ '^MLTRAIN-[0-9]{6}$'
  AND indicator = 'DATOS SINTETICOS';

SELECT COUNT(*) AS synthetic_parameters
FROM operativo.study_details AS detail
INNER JOIN operativo.studies AS study ON study.id = detail.study_id
WHERE study.code ~ '^MLTRAIN-[0-9]{6}$'
  AND study.indicator = 'DATOS SINTETICOS';

-- ================================================================
-- ROLLBACK MANUAL (ejecutar solo si se desea retirar el dataset).
-- Las lineas estan comentadas para evitar borrados accidentales.
-- ================================================================

-- BEGIN;
-- DELETE FROM operativo.study_details
-- WHERE study_id IN (
--   SELECT id
--   FROM operativo.studies
--   WHERE code ~ '^MLTRAIN-[0-9]{6}$'
--     AND indicator = 'DATOS SINTETICOS'
-- );
-- DELETE FROM operativo.studies
-- WHERE code ~ '^MLTRAIN-[0-9]{6}$'
--   AND indicator = 'DATOS SINTETICOS';
-- COMMIT;
