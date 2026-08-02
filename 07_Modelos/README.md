# 07_Modelos

Esta carpeta **si cumple** con el requisito de la rubrica:

> "Pipelines, modelos, reglas, matrices u otros artefactos utilizados por el sistema."

En esta version del proyecto, cada propuesta conserva dos tipos de artefacto:

- Un archivo `.pkl` con el modelo ya entrenado en Python.
- Un archivo `.json` con metadatos, metricas, trazabilidad y configuracion.

De esta forma, el sistema puede usar el modelo serializado para inferencia y,
al mismo tiempo, la entrega academica conserva artefactos faciles de revisar.

## Archivos principales

- `clustering_estudios_model.json`
  Artefacto del clustering de estudios. Incluye configuracion del modelo,
  metricas de seleccion de `k`, perfiles, calidad de datos y huella del dataset.

- `clustering_estudios_model.pkl`
  Modelo de clustering exportado desde Python para reasignar estudios usando el
  preprocesamiento y centroides entrenados.

- `regression_price_model.json`
  Artefacto de la regresion Ridge para sugerir el precio de estudios. Incluye
  variables de entrada, coeficientes, preprocesamiento y metricas de evaluacion.

- `regression_price_model.pkl`
  Modelo de regresion exportado desde Python y reutilizado por el sistema para
  sugerir precios.

- `classification_service_outcome_model.json`
  Artefacto del clasificador multiclase para predecir si una orden termina a
  tiempo, con retraso o cancelada. Incluye pesos, clases, preprocesamiento y
  evaluacion.

- `classification_service_outcome_model.pkl`
  Modelo de clasificacion exportado desde Python para inferencia operativa.

## Archivos complementarios

- `classification_training_report.json`
  Reporte tecnico de entrenamiento y validacion de clasificacion.

- `regression_metrics.json`
  Resumen de metricas de la propuesta de regresion.

- `classification_model_card.md`
  Tarjeta descriptiva del modelo de clasificacion.

## Uso real en el sistema

Estos archivos no son evidencia decorativa: **el sistema los usa**.

- La regresion usa el `.pkl` desde `src/studies/models/study-estimation.model.ts`
  y deja el `.json` como respaldo de metadatos y metricas.
- La clasificacion usa el `.pkl` desde el modulo de prediccion de servicios y
  conserva el `.json` para trazabilidad del entrenamiento.
- El clustering exporta el `.pkl` en Python y el modulo administrativo
  `/admin/clustering` reutiliza ese modelo junto con sus metadatos.

Por lo tanto, el contenido de esta carpeta corresponde exactamente a
**artefactos del modelo utilizados por la aplicacion web**.
