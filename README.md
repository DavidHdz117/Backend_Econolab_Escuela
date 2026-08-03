# ECONOLAB - Entrega final de extraccion de conocimiento
Este repositorio concentra la entrega practica del proyecto final de la materia
de extraccion de conocimiento en bases de datos aplicada al sistema ECONOLAB.
La rubrica pide al menos dos soluciones; esta entrega documenta **tres**
propuestas integradas con datos, notebooks, artefactos y aplicacion web:

1. `Clustering` de estudios para segmentacion operativa del catalogo.
2. `Regresion` para estimar el precio normal de un estudio individual.
3. `Clasificacion` para pronosticar el resultado final de una orden.

## Integrantes
20230005 Kristofer Josafat Tapia Hernández
20230009 Jesús David Saldaña Hernández

## Descripcion breve
- `02_Base_Datos/` contiene el respaldo anonimo, el esquema del modulo de
  clustering y el diccionario de datos.
- `03_Datos_Sinteticos/` contiene los scripts SQL usados para aumentar el
  volumen de datos de entrenamiento.
- `04_ETL/` contiene las consultas SQL que producen los datasets analiticos.
- `05_Datasets/` contiene los CSV finales y archivos intermedios de cada
  propuesta.
- `06_Notebooks/` contiene las tres libretas `.ipynb` ya ejecutadas.
- `07_Modelos/` contiene los artefactos `.pkl` y `.json` usados por el sistema.
- `01_Reporte/` contiene el reporte final en Word, PDF y HTML.
- `08_Aplicacion_Web/` documenta la integracion y la URL local.
- `09_Evidencias/` contiene capturas y archivos de apoyo.

El backend ejecutable vive en esta misma carpeta `Backend_Econolab_Escuela`.
El frontend ejecutable del workspace vive en la carpeta hermana
`../Frontend_Econolab_Escuela`. La carpeta `08_Aplicacion_Web/` conserva la
documentacion de integracion pedida por la rubrica.

## Propuestas incluidas
Clustering Agrupar estudios con comportamiento operativo similar. Estudio individual activo `05_Datasets/clustering_estudios.csv` `06_Notebooks/01_clustering_estudios.ipynb` `07_Modelos/clustering_estudios_model.pkl`

Regresion Estimar el precio normal de un estudio. Estudio individual activo `05_Datasets/02_regresion_estudios_dataset.csv` `06_Notebooks/02_regresion_precio_estudios.ipynb` `07_Modelos/regression_price_model.pkl`
Clasificacion Pronosticar si una orden termina a tiempo, retrasada o cancelada. Orden historica de servicio `05_Datasets/03_clasificacion_resultado_servicios.csv` `06_Notebooks/03_clasificacion_resultado_servicio.ipynb` `07_Modelos/classification_service_outcome_model.pkl`

## Requisitos
Para reproducir la entrega desde cero se recomienda:

- Windows con PowerShell, porque varios comandos de apoyo estan en `.ps1`.
- Node.js 20 o superior.
- npm 10 o superior.
- Python 3.10 o superior.
- PostgreSQL con utilidad `psql`.
- Paquetes de Python:
  `jupyter`, `pandas`, `numpy`, `scikit-learn`, `matplotlib`, `nbformat`,
  `nbclient`.

## Instalacion local
### 1. Backend
Desde la carpeta del backend:
```powershell
npm install
```

### 2. Frontend
Desde la carpeta del frontend:
```powershell
cd ..\Frontend_Econolab_Escuela
npm install
```

### 3. Python para notebooks
Desde cualquier terminal con Python disponible:
```powershell
python -m pip install jupyter pandas numpy scikit-learn matplotlib nbformat nbclient
```

## Configuracion local
### Backend
Usa `.env.example` como base:
```powershell
Copy-Item .env.example .env
```

Ajusta al menos estas variables para ambiente local:
- `NODE_ENV=development`
- `DATABASE_SSL=false`
- `COOKIE_SECURE=false`
- `APP_ENABLE_HSTS=false`
- `CORS_ORIGINS=http://localhost:5173`
- `FRONTEND_URL=http://localhost:5173`
- `GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback`
- Credenciales reales de PostgreSQL en `DATABASE_*`
- Secretos locales para `JWT_SECRET`, `CSRF_SECRET_SALT` y, si aplica,
  `GMAIL_*` y `GOOGLE_*`

### Frontend
En `../Frontend_Econolab_Escuela` crea un archivo `.env.local` con:
```powershell
@'
NEXT_PUBLIC_API_URL=http://localhost:3000/api
API_URL=http://localhost:3000/api
'@ | Set-Content .env.local
```

## Restauracion de la base de datos
La base para evaluacion se restaura con los archivos de `02_Base_Datos/`.
**Nunca** ejecutes esta restauracion sobre una base productiva, porque el
respaldo vuelve a crear el esquema `operativo`.

```powershell
psql -h <host> -U <usuario> -d <base_vacia> -f 02_Base_Datos/respaldo_analitico_anonimizado.sql
psql -h <host> -U <usuario> -d <base_vacia> -f 02_Base_Datos/02_esquema_modulo_clustering.sql
```

Notas importantes:
- El respaldo ya contiene las tablas fuente anonimizadas necesarias para
  reconstruir los datasets.
- El diccionario de campos esta en
  `02_Base_Datos/diccionario_datos_analiticos.md`.
- La validacion de restauracion quedo registrada en
  `02_Base_Datos/validacion_restauracion.json`.

## Datos sinteticos
Si restauras el respaldo incluido, normalmente **no necesitas** volver a cargar
los datos sinteticos porque ya forman parte del corte entregado. Si deseas
reconstruirlos sobre otra base de trabajo, ejecuta:

```powershell
psql -h <host> -U <usuario> -d <base> -f 03_Datos_Sinteticos/01_seed_catalogo_estudios.sql
psql -h <host> -U <usuario> -d <base> -f 03_Datos_Sinteticos/02_seed_historial_servicios.sql
```

La explicacion de volumen, reglas y limitaciones esta en
`03_Datos_Sinteticos/README.md`.

## Orden de ejecucion recomendado
Si solo quieres revisar la entrega, puedes abrir directamente:

1. `01_Reporte/Reporte_Practico_ECONOLAB.pdf`
2. `06_Notebooks/*.ipynb`
3. `07_Modelos/`
4. `09_Evidencias/`

Si quieres reproducir el proyecto desde cero, sigue este orden:

1. Instalar dependencias de backend, frontend y Python.
2. Restaurar la base vacia con `02_Base_Datos/`.
3. Cargar datos sinteticos solo si estas trabajando sobre otra base distinta al
   respaldo incluido.
4. Regenerar datasets y artefactos de regresion:

```powershell
npm run regression:export
npm run regression:notebook
```

5. Regenerar evidencia y artefacto de clasificacion:

```powershell
npm run classification:notebook
```

6. Regenerar evidencia y artefacto academico de clustering:

```powershell
npm run clustering:notebook
```

7. Si quieres recalcular el clustering que usa el modulo web administrativo,
   ejecuta ademas:

```powershell
npm run clustering:recalculate -- --periodMonths=6
```

## Puesta en marcha de la aplicacion web
### Backend
Desde la carpeta del backend:

```powershell
npm run start:dev
```

La API queda disponible en:

```text
http://localhost:3000/api
```

### Frontend
Desde la carpeta del frontend:

```powershell
npm run dev
```

La interfaz queda disponible en:

```text
http://localhost:5173
```

El archivo `08_Aplicacion_Web/URL_Sistema.txt` declara la ejecucion local. No
se incluyen credenciales de acceso en esta entrega.

## Prueba minima de las tres propuestas
### Regresion
1. Ejecuta `npm run regression:notebook`.
2. Verifica que exista `07_Modelos/regression_price_model.pkl`.
3. Revisa la libreta `06_Notebooks/02_regresion_precio_estudios.ipynb`.
4. En la aplicacion, el flujo se integra con el estimador de estudios y con el
   endpoint `POST /api/studies/estimate`.

### Clasificacion
1. Ejecuta `npm run classification:notebook`.
2. Verifica que exista `07_Modelos/classification_service_outcome_model.pkl`.
3. Revisa la libreta `06_Notebooks/03_clasificacion_resultado_servicio.ipynb`.
4. En la aplicacion, el flujo se integra con el alta de servicios y con el
   endpoint `POST /api/services/outcome-prediction`.

### Clustering
1. Ejecuta `npm run clustering:notebook`.
2. Verifica que existan
   `07_Modelos/clustering_estudios_model.pkl` y
   `05_Datasets/clustering_estudios_asignaciones.csv`.
3. Revisa la libreta `06_Notebooks/01_clustering_estudios.ipynb`.
4. Si deseas probar el modulo web administrativo, ejecuta
   `npm run clustering:recalculate -- --periodMonths=6` y consulta
   `GET /api/study-clustering/analysis`.

## Pruebas tecnicas disponibles
El backend incluye pruebas automatizadas de NestJS:

```powershell
npm run test
npm run test:e2e
```

La evidencia academica principal de modelos se conserva en las tres libretas ya
ejecutadas y en los artefactos de `07_Modelos/`.

## Archivos clave para el revisor
- `01_Reporte/Reporte_Practico_ECONOLAB.docx`
- `01_Reporte/Reporte_Practico_ECONOLAB.pdf`
- `02_Base_Datos/README.md`
- `03_Datos_Sinteticos/README.md`
- `06_Notebooks/01_clustering_estudios.ipynb`
- `06_Notebooks/02_regresion_precio_estudios.ipynb`
- `06_Notebooks/03_clasificacion_resultado_servicio.ipynb`
- `07_Modelos/README.md`
- `08_Aplicacion_Web/README.md`
- `09_Evidencias/`

## Observaciones finales
- Las tres propuestas usan datos reales y sinteticos, y esa condicion esta
  documentada en los datasets y en `03_Datos_Sinteticos/README.md`.
- Las libretas ya fueron ejecutadas y guardadas sin rutas privadas del equipo.
- Los artefactos `.pkl` de `07_Modelos/` son parte de la entrega academica.
- El reporte final y la aplicacion web describen el mismo conjunto de tres
  propuestas.
