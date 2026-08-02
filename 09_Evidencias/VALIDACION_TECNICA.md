# Validación técnica reproducida el 21 de julio de 2026

## Aplicación

| Comprobación | Resultado |
|---|---|
| Backend `npm test -- --runInBand` | 5 suites, 30 pruebas, 0 fallos. |
| Backend `npm run build` | Correcto. |
| Frontend `npm run build` | Correcto; 46 rutas, incluidas `/admin/clustering`, `/estudios` y `/servicios`. |

## Notebooks

| Notebook | Celdas de código | Ejecutadas | Errores | 6 fases CRISP-DM |
|---|---:|---:|---:|---|
| Clustering | 10 | 10 | 0 | Sí |
| Regresión | 8 | 8 | 0 | Sí |
| Clasificación | 8 | 8 | 0 | Sí |

Los tres incluyen fundamento/referencias y no contienen rutas privadas `C:\Users\...`.

## Datos y artefactos

- Regresión: 1,048 filas, 0 duplicados; split 838/210, intersección 0; hash del CSV coincide con el JSON y ambas copias del artefacto son idénticas.
- Clasificación: 512 filas aceptadas, 0 duplicados; holdout temporal 410/102 por `source_created_at`, con train del `2025-11-01T14:07:00Z` al `2026-05-11T13:24:00Z` y test del `2026-05-12T14:31:00Z` al `2026-06-28T13:00:00Z`; las tres clases aparecen en ambas particiones, train es anterior a test y la intersección de IDs es 0. Accuracy `0.7647` frente al baseline `0.5588`; macro F1 `0.7146` frente a `0.2390`. Todos los folios son `ECO-REAL-*` o `ECO-ML-*`; el hash del CSV coincide con el JSON y ambas copias son idénticas.
- Clustering: 1,048 filas, 0 duplicados; run 5, huella `ccc1d2e53a54412fff2b0cd8753d925e6d6f90aa9c2e8746fe7f5321f703b92f`, 1,048 reasignaciones y 0 discrepancias.

## Base reconstruible

El respaldo se restauró en un esquema temporal aislado y se ejecutaron los tres ETL:

- regresión: 1,048 filas;
- clasificación: 523 extraídas y 512 aceptadas;
- clustering: 1,048 filas;
- tablas personales: 0;
- folios reales expuestos: 0.

Después de la comprobación se retiró el esquema temporal. El resultado estructurado está en `02_Base_Datos/validacion_restauracion.json`.

## Empaquetado seguro

Se ejecutó el empaquetador con datos ficticios exclusivamente para QA:

- 831 entradas;
- 0 archivos prohibidos;
- 0 archivos requeridos ausentes;
- sustitución de metadata del equipo correcta;
- tamaño de prueba: 3.73 MB.

El ZIP ficticio se retiró del workspace. El ZIP definitivo no se genera hasta recibir nombres, matrículas, grupo y equipo.
