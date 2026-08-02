-- ============================================================================
-- ECONOLAB - HISTORIAL PARA EL PRONÓSTICO DE RESULTADO DE SERVICIOS
-- PostgreSQL / transaccional / idempotente
--
-- Lote reservado: ECO-ML-000001 ... ECO-ML-000500
--
-- El script crea o actualiza exactamente 500 órdenes históricas y reconstruye
-- únicamente los ítems de ese lote. Los IDs de las órdenes se conservan en
-- ejecuciones posteriores gracias al UPSERT por folio.
--
-- Distribución objetivo:
--   300 completed_on_time (60 %): status=completed y completedAt<=deliveryAt
--   150 delayed           (30 %): status=delayed y completedAt>deliveryAt
--    50 cancelled         (10 %): status=cancelled y completedAt IS NULL
--
-- IMPORTANTE: son datos de demostración para entrenar el clasificador; no
-- representan atenciones clínicas reales.
-- ============================================================================

BEGIN;

-- Evita una carga parcial o una rotación distinta a la solicitada.
DO $guard$
DECLARE
  active_patient_count integer;
  active_doctor_count integer;
  usable_study_count integer;
  foreign_reserved_folio_count integer;
BEGIN
  SELECT COUNT(*)
  INTO active_patient_count
  FROM operativo.patients
  WHERE "isActive" = true;

  SELECT COUNT(*)
  INTO active_doctor_count
  FROM operativo.doctors
  WHERE "isActive" = true;

  SELECT COUNT(*)
  INTO usable_study_count
  FROM operativo.studies
  WHERE "isActive" = true
    AND status = 'active'::operativo.studies_status_enum
    AND type = 'study'::operativo.studies_type_enum
    AND "normalPrice" > 0;

  SELECT COUNT(*)
  INTO foreign_reserved_folio_count
  FROM operativo.service_orders AS service
  WHERE service.folio ~ '^ECO-ML-[0-9]{6}$'
    AND REPLACE(service.folio, 'ECO-ML-', '')::integer BETWEEN 1 AND 500
    AND service.notes IS DISTINCT FROM
      'Historial de demostración para entrenamiento del pronóstico de servicios.';

  IF active_patient_count <> 53 THEN
    RAISE EXCEPTION
      'Carga cancelada: se esperaban exactamente 53 pacientes activos y existen %.',
      active_patient_count;
  END IF;

  IF active_doctor_count <> 72 THEN
    RAISE EXCEPTION
      'Carga cancelada: se esperaban exactamente 72 médicos activos y existen %.',
      active_doctor_count;
  END IF;

  IF usable_study_count < 6 THEN
    RAISE EXCEPTION
      'Carga cancelada: se requieren al menos 6 estudios individuales activos con precio normal positivo y existen %.',
      usable_study_count;
  END IF;

  IF foreign_reserved_folio_count <> 0 THEN
    RAISE EXCEPTION
      'Carga cancelada: % folios ECO-ML-000001...ECO-ML-000500 ya pertenecen a órdenes ajenas al lote.',
      foreign_reserved_folio_count;
  END IF;
END;
$guard$;

-- Catálogos ordenados: la rotación es estable aunque los IDs no sean continuos.
CREATE TEMP TABLE seed_ml_active_patients ON COMMIT DROP AS
SELECT
  id,
  ROW_NUMBER() OVER (ORDER BY id) AS rotation_number
FROM operativo.patients
WHERE "isActive" = true;

CREATE UNIQUE INDEX seed_ml_active_patients_rotation_idx
  ON seed_ml_active_patients(rotation_number);

CREATE TEMP TABLE seed_ml_active_doctors ON COMMIT DROP AS
SELECT
  id,
  ROW_NUMBER() OVER (ORDER BY id) AS rotation_number
FROM operativo.doctors
WHERE "isActive" = true;

CREATE UNIQUE INDEX seed_ml_active_doctors_rotation_idx
  ON seed_ml_active_doctors(rotation_number);

CREATE TEMP TABLE seed_ml_active_studies ON COMMIT DROP AS
SELECT
  id,
  name,
  "normalPrice",
  "difPrice",
  "specialPrice",
  "hospitalPrice",
  "otherPrice",
  ROW_NUMBER() OVER (ORDER BY id) AS rotation_number
FROM operativo.studies
WHERE "isActive" = true
  AND status = 'active'::operativo.studies_status_enum
  AND type = 'study'::operativo.studies_type_enum
  AND "normalPrice" > 0;

CREATE UNIQUE INDEX seed_ml_active_studies_rotation_idx
  ON seed_ml_active_studies(rotation_number);

-- Planeación determinista de las 500 órdenes.
-- Primero se crean X con variación y traslape; después se calcula un riesgo con
-- ruido determinista no observable por el modelo. Así Y no es una copia obvia
-- de una sola X y la evaluación no resulta artificialmente perfecta.
CREATE TEMP TABLE seed_ml_planned_orders ON COMMIT DROP AS
WITH numbered AS (
  SELECT
    sequence_number,
    'ECO-ML-' || LPAD(sequence_number::text, 6, '0') AS folio
  FROM generate_series(1, 500) AS sequence_number
),
features AS (
  SELECT
    numbered.*,
    1 + MOD(sequence_number * 7, 6) AS item_count,
    8 + MOD(sequence_number * 11, 65) AS promised_lead_hours,
    (MOD(sequence_number * 13, 4) * 5)::numeric(5, 2)
      AS courtesy_percent,
    CASE MOD(sequence_number * 3, 7)
      WHEN 0 THEN 'Matriz'
      WHEN 1 THEN 'Matriz - Centro'
      WHEN 2 THEN 'SUCURSAL CENTRO'
      WHEN 3 THEN 'SUCURSAL NORTE'
      ELSE 'SUCURSAL SUR'
    END AS branch_name
  FROM numbered
),
risk AS (
  SELECT
    features.*,
    item_count * 7
      - promised_lead_hours * 0.45
      + courtesy_percent * 0.35
      + CASE branch_name
          WHEN 'SUCURSAL NORTE' THEN 8
          WHEN 'SUCURSAL SUR' THEN 5
          ELSE 0
        END
      -- Ruido estable: representa factores operativos no capturados en X.
      + (MOD(sequence_number * 97, 101) - 50) * 0.25 AS risk_score
  FROM features
),
ranked AS (
  SELECT
    risk.*,
    ROW_NUMBER() OVER (
      ORDER BY risk_score DESC, sequence_number ASC
    ) AS risk_position
  FROM risk
),
labeled AS (
  SELECT
    ranked.*,
    CASE
      WHEN risk_position <= 50 THEN 'cancelled'
      WHEN risk_position <= 200 THEN 'delayed'
      ELSE 'completed_on_time'
    END AS outcome
  FROM ranked
),
registered AS (
  SELECT
    labeled.*,
    -- Fecha fija: volver a ejecutar el seed produce exactamente las mismas X.
    TIMESTAMP '2026-07-01 00:00:00'
      - (3 + MOD(sequence_number * 7, 240)) * INTERVAL '1 day'
      + MAKE_INTERVAL(
          hours => 7 + MOD(sequence_number * 5, 12),
          mins => MOD(sequence_number * 11, 60)
        ) AS created_at
  FROM labeled
),
sampled AS (
  SELECT
    registered.*,
    created_at + MAKE_INTERVAL(
      mins => 20 + MOD(sequence_number * 17, 101)
    ) AS sample_at
  FROM registered
),
scheduled AS (
  SELECT
    sampled.*,
    sample_at + MAKE_INTERVAL(hours => promised_lead_hours) AS delivery_at
  FROM sampled
)
SELECT
  scheduled.sequence_number,
  scheduled.folio,
  patient.id AS patient_id,
  doctor.id AS doctor_id,
  scheduled.branch_name,
  scheduled.created_at,
  scheduled.sample_at,
  scheduled.delivery_at,
  CASE scheduled.outcome
    WHEN 'completed_on_time' THEN
      scheduled.delivery_at
        - MAKE_INTERVAL(hours => 1 + MOD(scheduled.sequence_number, 8))
    WHEN 'delayed' THEN
      scheduled.delivery_at
        + MAKE_INTERVAL(hours => 2 + MOD(scheduled.sequence_number, 24))
    ELSE NULL
  END AS completed_at,
  CASE scheduled.outcome
    WHEN 'completed_on_time' THEN
      'completed'::operativo.service_orders_status_enum
    WHEN 'delayed' THEN
      'delayed'::operativo.service_orders_status_enum
    ELSE 'cancelled'::operativo.service_orders_status_enum
  END AS status,
  scheduled.outcome,
  scheduled.item_count,
  scheduled.courtesy_percent
FROM scheduled
INNER JOIN seed_ml_active_patients AS patient
  ON patient.rotation_number = 1 + MOD(scheduled.sequence_number - 1, 53)
INNER JOIN seed_ml_active_doctors AS doctor
  ON doctor.rotation_number = 1 + MOD(scheduled.sequence_number - 1, 72);

CREATE UNIQUE INDEX seed_ml_planned_orders_folio_idx
  ON seed_ml_planned_orders(folio);

-- Conserva el ID de cualquier orden del lote que ya exista.
INSERT INTO operativo.service_orders (
  folio,
  patient_id,
  doctor_id,
  "branchName",
  "sampleAt",
  "deliveryAt",
  "completedAt",
  status,
  "subtotalAmount",
  "courtesyPercent",
  "discountAmount",
  "totalAmount",
  notes,
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  folio,
  patient_id,
  doctor_id,
  branch_name,
  sample_at,
  delivery_at,
  completed_at,
  status,
  0::numeric(10, 2),
  courtesy_percent,
  0::numeric(10, 2),
  0::numeric(10, 2),
  'Historial de demostración para entrenamiento del pronóstico de servicios.',
  true,
  created_at,
  COALESCE(completed_at, created_at + INTERVAL '2 hours')
FROM seed_ml_planned_orders
ON CONFLICT (folio) DO UPDATE SET
  patient_id = EXCLUDED.patient_id,
  doctor_id = EXCLUDED.doctor_id,
  "branchName" = EXCLUDED."branchName",
  "sampleAt" = EXCLUDED."sampleAt",
  "deliveryAt" = EXCLUDED."deliveryAt",
  "completedAt" = EXCLUDED."completedAt",
  status = EXCLUDED.status,
  "subtotalAmount" = EXCLUDED."subtotalAmount",
  "courtesyPercent" = EXCLUDED."courtesyPercent",
  "discountAmount" = EXCLUDED."discountAmount",
  "totalAmount" = EXCLUDED."totalAmount",
  notes = EXCLUDED.notes,
  "isActive" = EXCLUDED."isActive",
  "createdAt" = EXCLUDED."createdAt",
  "updatedAt" = EXCLUDED."updatedAt";

CREATE TEMP TABLE seed_ml_saved_orders ON COMMIT DROP AS
SELECT
  service.id AS service_order_id,
  service."isActive" AS is_active,
  planned.*
FROM seed_ml_planned_orders AS planned
INNER JOIN operativo.service_orders AS service
  ON service.folio = planned.folio;

CREATE UNIQUE INDEX seed_ml_saved_orders_id_idx
  ON seed_ml_saved_orders(service_order_id);

-- Única reconstrucción destructiva: ítems de los 500 folios reservados.
-- Ninguna orden ajena al lote participa en esta operación.
DELETE FROM operativo.service_order_items AS item
USING seed_ml_saved_orders AS saved
WHERE item.service_order_id = saved.service_order_id;

-- Cada orden recibe de 1 a 6 estudios distintos, individuales y activos.
-- El precio se toma de la columna real correspondiente del catálogo; si una
-- tarifa secundaria vale cero, se utiliza el precio normal del mismo estudio.
WITH study_pool_size AS (
  SELECT COUNT(*)::integer AS total
  FROM seed_ml_active_studies
),
selected_items AS (
  SELECT
    saved.service_order_id,
    saved.sequence_number,
    item_number,
    study.id AS study_id,
    study.name AS study_name,
    study."normalPrice",
    study."difPrice",
    study."specialPrice",
    study."hospitalPrice",
    study."otherPrice",
    CASE MOD(saved.sequence_number * 3 + item_number, 5)
      WHEN 0 THEN 'normal'
      WHEN 1 THEN 'dif'
      WHEN 2 THEN 'special'
      WHEN 3 THEN 'hospital'
      ELSE 'other'
    END AS price_type
  FROM seed_ml_saved_orders AS saved
  CROSS JOIN LATERAL generate_series(1, saved.item_count) AS item_number
  CROSS JOIN study_pool_size
  INNER JOIN seed_ml_active_studies AS study
    ON study.rotation_number = 1 + MOD(
      (saved.sequence_number - 1) * 17 + (item_number - 1) * 37,
      study_pool_size.total
    )
),
priced_items AS (
  SELECT
    selected_items.*,
    CASE price_type
      WHEN 'dif' THEN COALESCE(NULLIF("difPrice", 0), "normalPrice")
      WHEN 'special' THEN COALESCE(NULLIF("specialPrice", 0), "normalPrice")
      WHEN 'hospital' THEN COALESCE(NULLIF("hospitalPrice", 0), "normalPrice")
      WHEN 'other' THEN COALESCE(NULLIF("otherPrice", 0), "normalPrice")
      ELSE "normalPrice"
    END::numeric(10, 2) AS unit_price
  FROM selected_items
)
INSERT INTO operativo.service_order_items (
  service_order_id,
  study_id,
  "studyNameSnapshot",
  source_package_id,
  source_package_name_snapshot,
  "priceType",
  "unitPrice",
  quantity,
  "discountPercent",
  "subtotalAmount"
)
SELECT
  service_order_id,
  study_id,
  study_name,
  NULL,
  NULL,
  price_type,
  unit_price,
  1,
  0::numeric(5, 2),
  unit_price
FROM priced_items;

-- Recalcula los importes de cabecera a partir de los ítems recién creados.
WITH item_totals AS (
  SELECT
    saved.service_order_id,
    ROUND(SUM(item."subtotalAmount"), 2)::numeric(10, 2) AS subtotal_amount
  FROM seed_ml_saved_orders AS saved
  INNER JOIN operativo.service_order_items AS item
    ON item.service_order_id = saved.service_order_id
  GROUP BY saved.service_order_id
),
calculated_totals AS (
  SELECT
    saved.service_order_id,
    item_totals.subtotal_amount,
    ROUND(
      item_totals.subtotal_amount * saved.courtesy_percent / 100,
      2
    )::numeric(10, 2) AS discount_amount
  FROM seed_ml_saved_orders AS saved
  INNER JOIN item_totals
    ON item_totals.service_order_id = saved.service_order_id
)
UPDATE operativo.service_orders AS service
SET
  "subtotalAmount" = calculated.subtotal_amount,
  "discountAmount" = calculated.discount_amount,
  "totalAmount" = (
    calculated.subtotal_amount - calculated.discount_amount
  )::numeric(10, 2)
FROM calculated_totals AS calculated
WHERE service.id = calculated.service_order_id;

-- Guardas finales: cualquier inconsistencia revierte la transacción completa.
DO $verification$
DECLARE
  order_count integer;
  distinct_order_id_count integer;
  active_order_count integer;
  completed_on_time_count integer;
  delayed_count integer;
  cancelled_count integer;
  invalid_outcome_count integer;
  covered_patient_count integer;
  covered_doctor_count integer;
  missing_patient_count integer;
  missing_doctor_count integer;
  actual_item_count integer;
  expected_item_count integer;
  invalid_item_count integer;
  invalid_item_total_count integer;
  invalid_order_total_count integer;
BEGIN
  SELECT
    COUNT(*),
    COUNT(DISTINCT service_order_id),
    COUNT(*) FILTER (WHERE is_active = true),
    COUNT(DISTINCT patient_id),
    COUNT(DISTINCT doctor_id)
  INTO
    order_count,
    distinct_order_id_count,
    active_order_count,
    covered_patient_count,
    covered_doctor_count
  FROM seed_ml_saved_orders;

  IF order_count <> 500
    OR distinct_order_id_count <> 500
    OR active_order_count <> 500 THEN
    RAISE EXCEPTION
      'Verificación fallida: órdenes=%, IDs distintos=%, activas=% (esperado 500/500/500).',
      order_count,
      distinct_order_id_count,
      active_order_count;
  END IF;

  SELECT COUNT(*)
  INTO missing_patient_count
  FROM seed_ml_active_patients AS patient
  WHERE NOT EXISTS (
    SELECT 1
    FROM seed_ml_saved_orders AS saved
    WHERE saved.patient_id = patient.id
  );

  SELECT COUNT(*)
  INTO missing_doctor_count
  FROM seed_ml_active_doctors AS doctor
  WHERE NOT EXISTS (
    SELECT 1
    FROM seed_ml_saved_orders AS saved
    WHERE saved.doctor_id = doctor.id
  );

  IF covered_patient_count <> 53
    OR covered_doctor_count <> 72
    OR missing_patient_count <> 0
    OR missing_doctor_count <> 0 THEN
    RAISE EXCEPTION
      'Verificación fallida: pacientes cubiertos=% (faltan %), médicos cubiertos=% (faltan %).',
      covered_patient_count,
      missing_patient_count,
      covered_doctor_count,
      missing_doctor_count;
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE service.status = 'completed'::operativo.service_orders_status_enum
        AND service."completedAt" IS NOT NULL
        AND service."completedAt" <= service."deliveryAt"
    ),
    COUNT(*) FILTER (
      WHERE service.status = 'delayed'::operativo.service_orders_status_enum
        AND service."completedAt" IS NOT NULL
        AND service."completedAt" > service."deliveryAt"
    ),
    COUNT(*) FILTER (
      WHERE service.status = 'cancelled'::operativo.service_orders_status_enum
        AND service."completedAt" IS NULL
    ),
    COUNT(*) FILTER (
      WHERE service."sampleAt" IS NULL
        OR service."deliveryAt" IS NULL
        OR service."deliveryAt" <= service."sampleAt"
        OR service."isActive" <> true
        OR NOT (
          (
            service.status = 'completed'::operativo.service_orders_status_enum
            AND service."completedAt" IS NOT NULL
            AND service."completedAt" <= service."deliveryAt"
          )
          OR (
            service.status = 'delayed'::operativo.service_orders_status_enum
            AND service."completedAt" IS NOT NULL
            AND service."completedAt" > service."deliveryAt"
          )
          OR (
            service.status = 'cancelled'::operativo.service_orders_status_enum
            AND service."completedAt" IS NULL
          )
        )
    )
  INTO
    completed_on_time_count,
    delayed_count,
    cancelled_count,
    invalid_outcome_count
  FROM operativo.service_orders AS service
  INNER JOIN seed_ml_saved_orders AS saved
    ON saved.service_order_id = service.id;

  IF completed_on_time_count <> 300
    OR delayed_count <> 150
    OR cancelled_count <> 50
    OR invalid_outcome_count <> 0 THEN
    RAISE EXCEPTION
      'Verificación fallida: en tiempo=%, retrasadas=%, canceladas=%, inválidas=% (esperado 300/150/50/0).',
      completed_on_time_count,
      delayed_count,
      cancelled_count,
      invalid_outcome_count;
  END IF;

  SELECT COUNT(*)
  INTO actual_item_count
  FROM seed_ml_saved_orders AS saved
  INNER JOIN operativo.service_order_items AS item
    ON item.service_order_id = saved.service_order_id;

  SELECT COALESCE(SUM(item_count), 0)::integer
  INTO expected_item_count
  FROM seed_ml_saved_orders;

  IF actual_item_count <> expected_item_count THEN
    RAISE EXCEPTION
      'Verificación fallida: se esperaban % ítems y se encontraron %.',
      expected_item_count,
      actual_item_count;
  END IF;

  SELECT COUNT(*)
  INTO invalid_item_count
  FROM operativo.service_order_items AS item
  INNER JOIN seed_ml_saved_orders AS saved
    ON saved.service_order_id = item.service_order_id
  LEFT JOIN operativo.studies AS study
    ON study.id = item.study_id
  WHERE study.id IS NULL
    OR study."isActive" <> true
    OR study.status <> 'active'::operativo.studies_status_enum
    OR study.type <> 'study'::operativo.studies_type_enum
    OR item.quantity <> 1
    OR item."unitPrice" <= 0
    OR item."discountPercent" <> 0
    OR item."subtotalAmount" <> item."unitPrice"
    OR item.source_package_id IS NOT NULL
    OR item.source_package_name_snapshot IS NOT NULL;

  SELECT COUNT(*)
  INTO invalid_item_total_count
  FROM (
    SELECT saved.service_order_id
    FROM seed_ml_saved_orders AS saved
    INNER JOIN operativo.service_order_items AS item
      ON item.service_order_id = saved.service_order_id
    GROUP BY saved.service_order_id, saved.item_count
    HAVING COUNT(*) <> saved.item_count
      OR COUNT(DISTINCT item.study_id) <> saved.item_count
  ) AS invalid_items;

  SELECT COUNT(*)
  INTO invalid_order_total_count
  FROM operativo.service_orders AS service
  INNER JOIN seed_ml_saved_orders AS saved
    ON saved.service_order_id = service.id
  INNER JOIN (
    SELECT
      item.service_order_id,
      ROUND(SUM(item."subtotalAmount"), 2) AS item_subtotal
    FROM operativo.service_order_items AS item
    INNER JOIN seed_ml_saved_orders AS item_saved
      ON item_saved.service_order_id = item.service_order_id
    GROUP BY item.service_order_id
  ) AS totals
    ON totals.service_order_id = service.id
  WHERE ABS(service."subtotalAmount" - totals.item_subtotal) > 0.01
    OR ABS(
      service."discountAmount"
      - ROUND(service."subtotalAmount" * service."courtesyPercent" / 100, 2)
    ) > 0.01
    OR ABS(
      service."totalAmount"
      - (service."subtotalAmount" - service."discountAmount")
    ) > 0.01;

  IF invalid_item_count <> 0
    OR invalid_item_total_count <> 0
    OR invalid_order_total_count <> 0 THEN
    RAISE EXCEPTION
      'Verificación fallida: ítems inválidos=%, cantidades inválidas=%, totales inválidos=%.',
      invalid_item_count,
      invalid_item_total_count,
      invalid_order_total_count;
  END IF;
END;
$verification$;

COMMIT;

-- ============================================================================
-- CONSULTAS DE VERIFICACIÓN
-- ============================================================================

WITH batch AS (
  SELECT 'ECO-ML-' || LPAD(number::text, 6, '0') AS folio
  FROM generate_series(1, 500) AS number
)
SELECT
  COUNT(*) AS training_orders,
  COUNT(*) FILTER (
    WHERE service.status = 'completed'
      AND service."completedAt" <= service."deliveryAt"
  ) AS completed_on_time,
  COUNT(*) FILTER (
    WHERE service.status = 'delayed'
      AND service."completedAt" > service."deliveryAt"
  ) AS delayed,
  COUNT(*) FILTER (
    WHERE service.status = 'cancelled'
      AND service."completedAt" IS NULL
  ) AS cancelled,
  COUNT(DISTINCT service.patient_id) AS active_patients_used,
  COUNT(DISTINCT service.doctor_id) AS active_doctors_used,
  MIN(service."createdAt") AS oldest_order,
  MAX(service."createdAt") AS newest_order
FROM batch
INNER JOIN operativo.service_orders AS service
  ON service.folio = batch.folio;

WITH batch AS (
  SELECT 'ECO-ML-' || LPAD(number::text, 6, '0') AS folio
  FROM generate_series(1, 500) AS number
),
item_counts AS (
  SELECT
    service.id,
    COUNT(item.id) AS item_count
  FROM batch
  INNER JOIN operativo.service_orders AS service
    ON service.folio = batch.folio
  INNER JOIN operativo.service_order_items AS item
    ON item.service_order_id = service.id
  GROUP BY service.id
)
SELECT
  SUM(item_count) AS training_items,
  MIN(item_count) AS minimum_items_per_order,
  ROUND(AVG(item_count), 2) AS average_items_per_order,
  MAX(item_count) AS maximum_items_per_order
FROM item_counts;

WITH batch AS (
  SELECT 'ECO-ML-' || LPAD(number::text, 6, '0') AS folio
  FROM generate_series(1, 500) AS number
),
patient_usage AS (
  SELECT service.patient_id, COUNT(*) AS order_count
  FROM batch
  INNER JOIN operativo.service_orders AS service
    ON service.folio = batch.folio
  GROUP BY service.patient_id
),
doctor_usage AS (
  SELECT service.doctor_id, COUNT(*) AS order_count
  FROM batch
  INNER JOIN operativo.service_orders AS service
    ON service.folio = batch.folio
  GROUP BY service.doctor_id
)
SELECT
  (SELECT COUNT(*) FROM patient_usage) AS patients_covered,
  (SELECT MIN(order_count) FROM patient_usage) AS minimum_orders_per_patient,
  (SELECT MAX(order_count) FROM patient_usage) AS maximum_orders_per_patient,
  (SELECT COUNT(*) FROM doctor_usage) AS doctors_covered,
  (SELECT MIN(order_count) FROM doctor_usage) AS minimum_orders_per_doctor,
  (SELECT MAX(order_count) FROM doctor_usage) AS maximum_orders_per_doctor;

-- ============================================================================
-- LIMPIEZA OPCIONAL (NO SE EJECUTA)
-- Descomenta el bloque completo únicamente si deseas retirar este lote.
-- Nunca elimina órdenes fuera de ECO-ML-000001 ... ECO-ML-000500.
-- ============================================================================

-- BEGIN;
-- WITH batch AS (
--   SELECT 'ECO-ML-' || LPAD(number::text, 6, '0') AS folio
--   FROM generate_series(1, 500) AS number
-- )
-- DELETE FROM operativo.service_order_items AS item
-- USING operativo.service_orders AS service, batch
-- WHERE item.service_order_id = service.id
--   AND service.folio = batch.folio;
--
-- WITH batch AS (
--   SELECT 'ECO-ML-' || LPAD(number::text, 6, '0') AS folio
--   FROM generate_series(1, 500) AS number
-- )
-- DELETE FROM operativo.service_orders AS service
-- USING batch
-- WHERE service.folio = batch.folio;
-- COMMIT;
