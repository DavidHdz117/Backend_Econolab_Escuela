# Respaldo analítico anonimizado

`respaldo_analitico_anonimizado.sql` contiene las tablas fuente necesarias
para reconstruir los datasets de las propuestas:

- `operativo.studies`;
- `operativo.study_details`;
- `operativo.service_orders`;
- `operativo.service_order_items`.

El respaldo omite por diseño pacientes, médicos, usuarios, notas y datos de
contacto. Los folios reales se sustituyen por consecutivos; únicamente se
conserva el prefijo reservado `ECO-ML-` para auditar qué órdenes son
sintéticas. Los nombres y códigos de estudios no identifican personas y se
conservan para la trazabilidad del catálogo.

## Generación reproducible

Desde la raíz del proyecto:

```powershell
node 04_ETL/exportar_respaldo_analitico_anonimizado.js
```

El programa lee la conexión desde `backend/.env`, pero no copia credenciales
al respaldo. También actualiza `volumen_fuentes.json` con los conteos del mismo
corte.

`validacion_restauracion.json` registra la prueba realizada en un esquema
temporal aislado: restauró las ocho tablas, ejecutó los tres ETL y comprobó la
seudonimización antes de retirar el esquema temporal.

## Restauración

El SQL elimina y vuelve a crear el esquema `operativo`; por lo tanto debe
ejecutarse **solamente en una base vacía destinada a evaluación**, nunca sobre
la base productiva:

```powershell
psql -h <host> -U <usuario> -d <base_vacia> -f 02_Base_Datos/respaldo_analitico_anonimizado.sql
psql -h <host> -U <usuario> -d <base_vacia> -f 02_Base_Datos/02_esquema_modulo_clustering.sql
```

El segundo archivo crea las tablas donde la aplicación persiste ejecuciones,
perfiles y asignaciones de K-Means. El diccionario legible de campos, tipos,
llaves y privacidad está en `diccionario_datos_analiticos.md`.

Este es un respaldo analítico para reproducir ETL, notebooks y artefactos. El
código completo de la aplicación conserva sus entidades y migraciones dentro
de `backend/src` y `backend/sql`.
