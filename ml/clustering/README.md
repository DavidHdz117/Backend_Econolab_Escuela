# Pipeline de clustering de estudios

Este directorio guarda la evidencia académica de la propuesta de clustering:

- `01_extract_clustering_dataset.sql`: copia local del SQL canónico de extracción.
- `data/clustering_estudios.csv`: snapshot del dataset.
- `artifacts/clustering_estudios_model.json`: artefacto JSON exportado.
- `notebooks/01_clustering_estudios.ipynb`: copia local de la libreta.
- `reports/clustering_estudios_metadata.json`: metadatos del corte y calidad.

La libreta oficial queda en `06_Notebooks/01_clustering_estudios.ipynb`.
Su ejecución vuelve a exportar el dataset y el artefacto que el backend puede
reutilizar cuando la huella del dataset coincide con la ejecución almacenada.

Si todavía no se ejecuta el pipeline, `data/`, `artifacts/` y `reports/`
pueden iniciar con archivos de marcador. Al correr `npm run clustering:export`
o `npm run clustering:notebook`, esas carpetas reciben el dataset y el artefacto
reales.
