-- ==========================================================================
-- ETL DE REGRESION: PostgreSQL -> una fila de dataset por estudio
-- ==========================================================================
-- X: `parameter_count`, `duration_minutes`, `method`, `sample_type`
-- y `requires_special_processing`.
-- Y: `normal_price`.
-- `study_id`, `study_code`, `study_name` e `is_synthetic` se conservan para
-- trazabilidad; el entrenador no usa esos identificadores como variables X.

SELECT
  study.id AS study_id,
  study.code AS study_code,
  study.name AS study_name,
  (
    study.code ~* '^ECN-CAT-'
    OR study.code ~* '^MLTRAIN-[0-9]{6}$'
    OR UPPER(TRIM(COALESCE(study.indicator, ''))) = 'DATOS SINTETICOS'
  ) AS is_synthetic,
  study.type::text AS type,
  COALESCE(NULLIF(BTRIM(study.method), ''), 'sin_metodo') AS method,
  study."durationMinutes" AS duration_minutes,
  COALESCE(NULLIF(BTRIM(study."sampleType"), ''), 'unknown') AS sample_type,
  study."requiresSpecialProcessing" AS requires_special_processing,
  COUNT(detail.id) FILTER (
    WHERE detail."isActive" = true
      AND detail."dataType" = 'parameter'
  )::integer AS parameter_count,
  study."normalPrice" AS normal_price
FROM operativo.studies AS study
LEFT JOIN operativo.study_details AS detail
  ON detail.study_id = study.id
WHERE study."isActive" = true
  AND study.status = 'active'
  AND study.type = 'study'
GROUP BY
  study.id,
  study.code,
  study.name,
  study.indicator,
  study.type,
  study.method,
  study."durationMinutes",
  study."sampleType",
  study."requiresSpecialProcessing",
  study."normalPrice"
ORDER BY study.id;
