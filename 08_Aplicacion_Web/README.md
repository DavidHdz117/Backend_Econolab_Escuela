# Aplicación web e integración de los modelos

El código fuente funcional se mantiene en las carpetas `../backend` y `../frontend`. Al generar el ZIP final se conserva esa copia ejecutable en la raíz —para que funcionen las rutas reproducibles hacia `04_ETL`–`07_Modelos`— y se incluye un espejo dentro de `08_Aplicacion_Web` para respetar la estructura de la rúbrica. Se excluyen `node_modules`, `.next`, `dist`, secretos y repositorios `.git`.

Los comandos se ejecutan desde la copia `backend`/`frontend` de la raíz del ZIP; el espejo de esta carpeta es solo para revisión de la entrega.

## Dónde se usa cada modelo

| Solución | Modelo/backend | Endpoint | Interfaz |
|---|---|---|---|
| Clustering | `backend/src/study-clustering` | `/api/study-clustering/analysis` | `frontend/src/app/admin/clustering/page.tsx` |
| Regresión | `backend/src/studies/models/study-estimation.model.ts` | `/api/studies/estimate` | `frontend/src/components/estudios/StudyEstimationPanel.tsx` |
| Clasificación | `backend/src/services/models/service-outcome-prediction.model.ts` | `/api/services/outcome-prediction` | `frontend/src/components/servicios/AgregarServicioModal.tsx` |

Los controladores reciben la petición, los servicios preparan las variables y los modelos cargan los artefactos ya entrenados. La guía `../GUIA_CODIGO_TRES_PROPUESTAS_ML.md` señala las secciones que conviene mostrar durante la exposición.

## URL local

`http://localhost:5173`

El sistema requiere una cuenta autorizada; no se incluyen credenciales en la entrega.

## Tecnologías y versiones principales

| Capa | Tecnología |
|---|---|
| Backend | Node.js 20 o superior (validado con 25.9), NestJS 11, TypeScript 5.7, TypeORM 0.3.25 y `pg` 8.16.3. |
| Base de datos | PostgreSQL; esquema relacional `operativo`. |
| Frontend | Next.js 16.1.5, React 19.1 y TypeScript 5. |
| Analítica | Python 3.10 o superior (validado con 3.14), scikit-learn 1.8, pandas 3.0, NumPy 2.4 y Matplotlib 3.10. |

Los rangos reproducibles están en `backend/package.json`, `frontend/package.json` y `06_Notebooks/requirements.txt`; los `package-lock.json` conservan la resolución exacta de npm.

## Arquitectura de inferencia

```text
Formulario o módulo administrativo
        │ JSON con datos del negocio
        ▼
Next.js / React ──► API NestJS ──► servicio prepara X
                                      │
                                      ▼
                         artefacto entrenado y versionado
                                      │
                                      ▼
                          resultado JSON interpretable
```

La inferencia y el entrenamiento están separados: las peticiones HTTP nunca
ajustan parámetros ni vuelven a consultar el dataset de entrenamiento. NestJS
carga el artefacto existente, valida su versión, transforma la entrada con los
parámetros guardados y ejecuta el cálculo. PostgreSQL solo participa durante el
ETL, el recálculo administrativo de clustering y la preparación de datos del
caso cuando corresponde.

## Contratos de entrada y respuesta

Todas las rutas requieren JWT; clustering requiere además rol administrador.
NestJS valida los DTO y responde errores HTTP estructurados. Los casos sin un
artefacto utilizable se muestran de forma explícita y nunca se sustituyen por
un número fijo o aleatorio.

| Solución | Entrada de negocio | Respuesta JSON principal | Casos no válidos o no disponibles |
|---|---|---|---|
| Regresión | `{ type, method, parameterCount }` | `{ message, data: { suggestedNormalPrice, priceRange, model, warnings } }` | `400` para paquetes o DTO inválido; `503` si falta o es incompatible el JSON. |
| Clasificación | `{ branchName, sampleAt, deliveryAt, courtesyPercent, items }` | `{ message, data: { available, predictedOutcome, label, confidence, probabilities, model } }` | El DTO inválido produce `400`; datos insuficientes o artefacto ausente producen `available:false` con una explicación, sin impedir registrar la orden. |
| Clustering | Sin entrada en `GET /analysis`; periodo y corte en recálculo | `{ run, profiles, studies, findings, technicalDetails, dataQuality }` | `404` si aún no existe una ejecución; `400` para periodo/corte inválido; acceso no autorizado según JWT/rol. |

El frontend no pide al usuario variables internas, columnas codificadas ni
centroides: calcula o envía únicamente datos que ya existen en los formularios.
Los tipos exactos están en `frontend/src/features/studies/api/studies.ts`,
`frontend/src/features/services/api/services.ts` y
`frontend/src/components/study-clustering/StudyClusteringSection.tsx`.

## Carga y actualización controlada

| Solución | Dónde se carga | Cómo se actualiza cuando cambian los datos |
|---|---|---|
| Regresión | `StudyEstimationModel`, desde `backend/ml-artifacts/regression_price_model.json`. | `npm run regression:export` y ejecución completa de `06_Notebooks/02_regresion_precio_estudios.ipynb`; reiniciar backend para recargar. |
| Clasificación | `ServiceOutcomePredictionModel`, desde `backend/ml/classification/artifacts/classification_service_outcome_model.json`. | `npm run classification:notebook`; el flujo extrae, entrena, evalúa y sincroniza el JSON; reiniciar backend. |
| Clustering | `StudyClusteringService`, desde `operativo.study_clustering_runs.data_quality.modelArtifact`. | `npm run clustering:recalculate -- --periodMonths=6`; el administrador consulta luego la última ejecución completada. |

Antes de promover una actualización deben compararse las métricas con el
artefacto anterior, revisar la proporción real/sintética y conservar la versión
previa para reversión. La guía `../GUIA_CODIGO_TRES_PROPUESTAS_ML.md` identifica
la extracción, entrenamiento, carga y llamada exacta de cada solución.
