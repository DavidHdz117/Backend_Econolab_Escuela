-- ============================================================================
-- ECONOLAB: normalizacion de registros heredados de prueba (IDs 32 a 38)
-- PostgreSQL
--
-- Alcance deliberadamente limitado:
--   * Solo modifica los IDs 32, 33, 34, 35, 36, 37 y 38.
--   * No modifica los IDs 29-31 ni 39-58, que ya son registros reales.
--   * Conserva el tipo actual y packageStudyIds. Esto es importante para el
--     ID 34, que ya es un paquete y conserva sus estudios relacionados.
--   * Conserva los study_details existentes; el ID 35 ya contiene glucosa,
--     urea y creatinina, por lo que se normaliza como una quimica de 3 elementos.
--
-- El script es idempotente: acepta tanto el codigo heredado como el codigo
-- definitivo y produce siempre los mismos datos.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE econolab_legacy_study_normalization (
  id integer PRIMARY KEY,
  legacy_code varchar(50) NOT NULL,
  final_code varchar(50) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  description text NOT NULL,
  duration_minutes integer NOT NULL,
  normal_price numeric(10, 2) NOT NULL,
  dif_price numeric(10, 2) NOT NULL,
  special_price numeric(10, 2) NOT NULL,
  hospital_price numeric(10, 2) NOT NULL,
  other_price numeric(10, 2) NOT NULL,
  method varchar(150) NOT NULL,
  sample_type varchar(50) NOT NULL,
  requires_special_processing boolean NOT NULL,
  indicator varchar(150) NOT NULL
) ON COMMIT DROP;

INSERT INTO econolab_legacy_study_normalization (
  id,
  legacy_code,
  final_code,
  name,
  description,
  duration_minutes,
  normal_price,
  dif_price,
  special_price,
  hospital_price,
  other_price,
  method,
  sample_type,
  requires_special_processing,
  indicator
)
VALUES
  (
    32,
    '0001',
    'GLU-PP01',
    'Glucosa posprandial',
    'Medición de glucosa en suero dos horas después de ingerir alimentos para evaluar la respuesta metabólica.',
    60,
    110.00,
    100.00,
    95.00,
    90.00,
    105.00,
    'Enzimático colorimétrico',
    'serum',
    false,
    'Química clínica'
  ),
  (
    33,
    '01',
    'INS-AY01',
    'Insulina sérica en ayuno',
    'Cuantificación de insulina en suero para apoyar la evaluación del metabolismo de la glucosa y la resistencia a la insulina.',
    120,
    390.00,
    360.00,
    340.00,
    325.00,
    375.00,
    'Quimioluminiscencia',
    'serum',
    false,
    'Endocrinología'
  ),
  (
    34,
    'PAQ202604220001',
    'PAQ-MET01',
    'Paquete metabólico de ácido úrico y albúmina',
    'Paquete que integra la medición de ácido úrico y albúmina para una revisión metabólica y nutricional básica.',
    90,
    240.00,
    220.00,
    205.00,
    195.00,
    230.00,
    'Paquete de estudios',
    'serum',
    false,
    'Química clínica'
  ),
  (
    35,
    'EST202604220001',
    'QS003',
    'Química sanguínea de 3 elementos',
    'Perfil bioquímico que incluye glucosa, urea y creatinina para apoyar la evaluación del metabolismo y la función renal.',
    60,
    190.00,
    175.00,
    160.00,
    150.00,
    180.00,
    'Espectrofotometría',
    'serum',
    false,
    'Química clínica'
  ),
  (
    36,
    'EST202604220002',
    'DDIM01',
    'Dímero D cuantitativo',
    'Cuantificación de Dímero D en plasma citratado como apoyo en la evaluación de procesos trombóticos y fibrinolíticos.',
    120,
    420.00,
    390.00,
    365.00,
    350.00,
    405.00,
    'Inmunoturbidimetría',
    'plasma',
    true,
    'Coagulación'
  ),
  (
    37,
    'EST202604220003',
    'EXFAR01',
    'Cultivo de exudado faríngeo',
    'Cultivo microbiológico de exudado faríngeo para identificar microorganismos y orientar el antibiograma cuando corresponda.',
    2880,
    360.00,
    335.00,
    310.00,
    295.00,
    345.00,
    'Cultivo microbiológico',
    'swab',
    true,
    'Microbiología'
  ),
  (
    38,
    'EST202604220004',
    'COVPCR01',
    'Detección de SARS-CoV-2 por RT-PCR',
    'Detección cualitativa de material genético de SARS-CoV-2 mediante RT-PCR en una muestra de exudado respiratorio.',
    1440,
    950.00,
    900.00,
    850.00,
    820.00,
    920.00,
    'RT-PCR',
    'swab',
    true,
    'Biología molecular'
  );

-- Evita apropiarse de un codigo si ya pertenece a otro estudio.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM econolab_legacy_study_normalization AS desired
    INNER JOIN operativo.studies AS existing
      ON existing.code = desired.final_code
     AND existing.id <> desired.id
  ) THEN
    RAISE EXCEPTION
      'No se puede normalizar: al menos un codigo definitivo ya pertenece a otro estudio.';
  END IF;
END;
$$;

UPDATE operativo.studies AS study
SET
  name = desired.name,
  code = desired.final_code,
  description = desired.description,
  "durationMinutes" = desired.duration_minutes,
  "normalPrice" = desired.normal_price,
  "difPrice" = desired.dif_price,
  "specialPrice" = desired.special_price,
  "hospitalPrice" = desired.hospital_price,
  "otherPrice" = desired.other_price,
  "defaultDiscountPercent" = 0,
  method = desired.method,
  "sampleType" = desired.sample_type,
  "requiresSpecialProcessing" = desired.requires_special_processing,
  indicator = desired.indicator,
  "isActive" = true,
  status = 'active'::operativo.studies_status_enum,
  "updatedAt" = NOW()
FROM econolab_legacy_study_normalization AS desired
WHERE study.id = desired.id
  AND study.id BETWEEN 32 AND 38
  AND study.code IN (desired.legacy_code, desired.final_code);

-- Falla y revierte toda la transaccion si algun ID no existe o ya no conserva
-- su codigo heredado/definitivo esperado. Asi no se sobrescribe otro registro
-- que pudiera haber reutilizado uno de estos IDs.
DO $$
DECLARE
  normalized_count integer;
BEGIN
  SELECT COUNT(*)
  INTO normalized_count
  FROM operativo.studies AS study
  INNER JOIN econolab_legacy_study_normalization AS desired
    ON desired.id = study.id
   AND desired.final_code = study.code
  WHERE study.id BETWEEN 32 AND 38;

  IF normalized_count <> 7 THEN
    RAISE EXCEPTION
      'Normalizacion incompleta: se esperaban 7 registros y se encontraron %.',
      normalized_count;
  END IF;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICACION
-- Debe devolver 7 filas. El ID 34 debe seguir siendo package y conservar
-- packageStudyIds; los demas deben conservar su tipo y relaciones originales.
-- ============================================================================

SELECT
  id,
  name,
  code,
  description,
  "durationMinutes",
  "normalPrice",
  method,
  "sampleType",
  "requiresSpecialProcessing",
  indicator,
  "isActive",
  status,
  type,
  "packageStudyIds"
FROM operativo.studies
WHERE id BETWEEN 32 AND 38
ORDER BY id;

SELECT
  COUNT(*) AS normalized_studies,
  COUNT(*) FILTER (WHERE "isActive" AND status = 'active') AS active_studies,
  COUNT(*) FILTER (
    WHERE NULLIF(BTRIM(name), '') IS NOT NULL
      AND NULLIF(BTRIM(description), '') IS NOT NULL
      AND NULLIF(BTRIM(method), '') IS NOT NULL
      AND NULLIF(BTRIM(indicator), '') IS NOT NULL
      AND "sampleType" <> 'unknown'
  ) AS studies_with_complete_information
FROM operativo.studies
WHERE id BETWEEN 32 AND 38;
