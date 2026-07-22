-- ==========================================================================
-- ETL DE CLUSTERING: PostgreSQL -> una fila de dataset por estudio
-- ==========================================================================
-- Parametros esperados por la consulta:
--   :periodStart  inicio del periodo historico (timestamp)
--   :periodEnd    fin del periodo historico (timestamp)
--
-- El clustering usa solo estudios activos e individuales. `study_id`, `code`,
-- `name`, `synthetic_request_count` e `is_synthetic` se conservan para
-- trazabilidad; el modelo usa como X las variables operativas restantes.

WITH active_studies AS (
  SELECT
    study.id,
    study.code,
    study.name,
    study."normalPrice" AS price,
    study."durationMinutes" / 60.0 AS delivery_hours,
    study."sampleType" AS sample_type,
    NULLIF(BTRIM(study.method), '') AS analysis_method,
    study."requiresSpecialProcessing" AS requires_special_processing,
    (study.code ~* '^ECN-CAT-') AS is_synthetic
  FROM operativo.studies AS study
  WHERE study."isActive" = true
    AND study.status = 'active'
    AND study.type = 'study'
    AND UPPER(TRIM(COALESCE(study.indicator, ''))) <> 'DATOS SINTETICOS'
    AND study.code !~* '^MLTRAIN-[0-9]{6}$'
),
parameter_counts AS (
  SELECT
    detail.study_id,
    COUNT(*)::integer AS parameter_count
  FROM operativo.study_details AS detail
  WHERE detail."isActive" = true
    AND detail."dataType" = 'parameter'
  GROUP BY detail.study_id
),
request_counts AS (
  SELECT
    item.study_id,
    COALESCE(SUM(item.quantity), 0)::integer AS request_count,
    COALESCE(
      SUM(
        CASE
          WHEN service.folio LIKE 'ECO-ML-%' THEN item.quantity
          ELSE 0
        END
      ),
      0
    )::integer AS synthetic_request_count
  FROM operativo.service_order_items AS item
  INNER JOIN operativo.service_orders AS service
    ON service.id = item.service_order_id
  WHERE service."createdAt" >= :periodStart
    AND service."createdAt" <= :periodEnd
    AND service."isActive" = true
    AND service.status <> 'cancelled'
  GROUP BY item.study_id
)
SELECT
  study.id AS study_id,
  study.code,
  study.name,
  study.price,
  study.delivery_hours,
  parameter.parameter_count,
  COALESCE(request.request_count, 0) AS request_count,
  COALESCE(request.synthetic_request_count, 0) AS synthetic_request_count,
  CASE
    WHEN study.sample_type = 'unknown' THEN NULL
    ELSE study.sample_type
  END AS sample_type,
  study.analysis_method,
  study.requires_special_processing,
  study.is_synthetic
FROM active_studies AS study
LEFT JOIN parameter_counts AS parameter
  ON parameter.study_id = study.id
LEFT JOIN request_counts AS request
  ON request.study_id = study.id
ORDER BY study.id;
