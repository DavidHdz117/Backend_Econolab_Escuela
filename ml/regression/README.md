# Pipeline de regresión de estudios

Este directorio guarda la evidencia académica de la propuesta de regresión:

- `01_extract_regression_dataset.sql`: copia local del SQL de extracción.
- `data/`: dataset completo y particiones train/test.
- `artifacts/regression_price_model.json`: artefacto JSON que consume el backend.
- `notebooks/02_regresion_precio_estudios.ipynb`: copia local de la libreta.
- `reports/`: métricas y apoyos para la libreta.

La libreta oficial queda en `06_Notebooks/02_regresion_precio_estudios.ipynb`.
Su ejecución regenera el dataset, entrena el modelo y vuelve a dejar el mismo
archivo que `StudyEstimationModel` carga en tiempo de ejecución.

Si aún no se ha corrido el pipeline, `data/`, `artifacts/` y `reports/`
pueden contener solo archivos de marcador. Al ejecutar `npm run regression:export`,
`npm run regression:train` o `npm run regression:notebook`, esas carpetas se
rellenan con los archivos reales.
