-- ==========================================================================
-- ETL DE CLASIFICACION: PostgreSQL -> una fila de dataset por servicio
-- ==========================================================================
-- X: columnas de caracteristicas conocidas al registrar el servicio.
-- Y: `outcome`, calculada solo con el resultado historico (estado/fechas).
-- `order_id`, `source_folio`, `source_created_at`, `source_updated_at` e
-- `is_synthetic` se conservan para auditoria, pero el entrenador NO los utiliza
-- como variables del modelo. `source_created_at` ordena el holdout temporal.

WITH item_summary AS (
  SELECT
    item.service_order_id,
    COUNT(*)::integer AS item_count,
    COALESCE(SUM(GREATEST(item.quantity, 0)), 0)::integer AS total_quantity,
    COUNT(DISTINCT item.study_id)::integer AS distinct_study_count,
    COUNT(*) FILTER (
      WHERE item.source_package_id IS NOT NULL
    )::integer AS package_component_count
  FROM operativo.service_order_items AS item
  GROUP BY item.service_order_id
),
price_type_counts AS (
  SELECT
    item.service_order_id,
    item."priceType" AS price_type,
    SUM(GREATEST(item.quantity, 0)) AS quantity_count
  FROM operativo.service_order_items AS item
  GROUP BY item.service_order_id, item."priceType"
),
dominant_price_type AS (
  SELECT service_order_id, price_type
  FROM (
    SELECT
      service_order_id,
      price_type,
      ROW_NUMBER() OVER (
        PARTITION BY service_order_id
        ORDER BY quantity_count DESC, price_type ASC
      ) AS position
    FROM price_type_counts
  ) AS ranked
  WHERE position = 1
)
SELECT
  service.id AS order_id,
  CASE
    WHEN service.folio LIKE 'ECO-ML-%' THEN service.folio
    ELSE 'ECO-REAL-' || LPAD(service.id::text, 6, '0')
  END AS source_folio,
  service.folio LIKE 'ECO-ML-%' AS is_synthetic,
  service."createdAt" AS source_created_at,
  service."updatedAt" AS source_updated_at,

  -- ---------------------------- X ---------------------------------------
  EXTRACT(
    EPOCH FROM (
      service."deliveryAt" - COALESCE(service."sampleAt", service."createdAt")
    )
  ) / 3600.0 AS promised_lead_hours,
  EXTRACT(HOUR FROM service."createdAt")
    + EXTRACT(MINUTE FROM service."createdAt") / 60.0 AS registration_hour,
  EXTRACT(DOW FROM service."createdAt")::integer AS registration_weekday,
  items.item_count,
  items.total_quantity,
  items.distinct_study_count,
  items.package_component_count,
  service."subtotalAmount" AS subtotal_amount,
  service."courtesyPercent" AS courtesy_percent,
  service."discountAmount" AS discount_amount,
  service."totalAmount" AS total_amount,
  service."branchName" AS branch_name,
  dominant.price_type AS dominant_price_type,

  -- ---------------------------- Y ---------------------------------------
  CASE
    WHEN service.status = 'cancelled' THEN 'cancelled'
    WHEN service.status = 'delayed' THEN 'delayed'
    WHEN service.status = 'completed'
      AND service."completedAt" IS NOT NULL
      AND service."deliveryAt" IS NOT NULL
      AND service."completedAt" <= service."deliveryAt"
      THEN 'completed_on_time'
    WHEN service.status = 'completed'
      AND service."completedAt" IS NOT NULL
      AND service."deliveryAt" IS NOT NULL
      AND service."completedAt" > service."deliveryAt"
      THEN 'delayed'
    ELSE NULL
  END AS outcome
FROM operativo.service_orders AS service
LEFT JOIN item_summary AS items
  ON items.service_order_id = service.id
LEFT JOIN dominant_price_type AS dominant
  ON dominant.service_order_id = service.id
WHERE service."isActive" = true
  AND service.status IN ('completed', 'delayed', 'cancelled')
ORDER BY service.id;
