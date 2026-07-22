# Pipeline de clasificación de servicios

Este directorio contiene la copia de despliegue. Las evidencias canónicas para
la rúbrica se generan también en `04_ETL`, `05_Datasets`, `06_Notebooks` y
`07_Modelos` de la raíz.

## Reproducir

Desde `backend`:

```powershell
npm run classification:train
npm run classification:notebook
```

`classification:train` ejecuta un SELECT de solo lectura, valida las filas,
exporta dataset completo/train/test, entrena con el periodo pasado, evalúa el
20 % cronológicamente más reciente, calcula baseline y métricas, y guarda el
artefacto JSON exacto que carga la aplicación. Imputación, escalado, one-hot y
pesos se aprenden únicamente con train.

El notebook ejecuta ese mismo comando en su primera celda. Por ello la libreta
no se limita a leer resultados antiguos: prepara, entrena, evalúa y guarda el
artefacto exacto antes de dibujar sus gráficas y casos.

## Archivos

- `01_extract_classification_dataset.sql`: extracción X/Y desde PostgreSQL.
- `build_notebook.py`: construcción reproducible de la libreta de evidencia.
- `data/`: CSV completo y particiones auditables.
- `artifacts/classification_service_outcome_model.json`: copia leída por Nest.
- `reports/classification_training_report.json`: calidad, split, métricas y
  procedencia real/sintética.
- `notebooks/03_clasificacion_resultado_servicio.ipynb`: copia de conveniencia;
  la versión de entrega está en `06_Notebooks`.

No hay credenciales en estos archivos. La conexión se toma del `.env` local,
que no debe incluirse en la entrega pública.
