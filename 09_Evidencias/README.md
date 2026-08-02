# Evidencias funcionales que deben capturarse

Esta carpeta define seis pruebas reproducibles: dos por solución. Para cada caso se debe guardar una captura de la entrada y otra del resultado, sin mostrar datos personales. Las capturas finales dependen de que backend y frontend estén encendidos y de iniciar sesión con una cuenta autorizada.

## Caso 1 — Clustering: consulta y comparación

1. Abrir `/admin/clustering`.
2. Mostrar el `k` seleccionado, silueta y Davies–Bouldin.
3. Abrir dos perfiles y comparar precio, demanda y horas de entrega.
4. Evidencia esperada: los nombres operativos y acciones de ambos segmentos son distintos.

Archivos sugeridos: `01_clustering_resumen.png` y `02_clustering_comparacion.png`.

## Caso 2 — Clustering: estudio atípico

1. Usar el filtro de atípicos del mismo módulo.
2. Abrir un estudio marcado y mostrar sus variables respecto de los promedios de su grupo.
3. Evidencia esperada: se identifica para revisión administrativa, sin crear una categoría médica.

Archivos sugeridos: `03_clustering_atipico_lista.png` y `04_clustering_atipico_detalle.png`.

## Caso 3 — Regresión: estimar y aplicar precio

1. Ir a Estudios → Agregar estudio.
2. Elegir tipo `study`, método `ELISA` y capturar 8 parámetros.
3. Calcular la estimación y pulsar **Usar precio sugerido**.
4. Evidencia esperada: el precio se copia al formulario y sigue siendo editable.

Archivos sugeridos: `05_regresion_estimacion.png` y `06_regresion_precio_aplicado.png`.

## Caso 4 — Regresión: entrada distinta

1. En el mismo formulario, cambiar método y cantidad de parámetros.
2. Volver a calcular.
3. Evidencia esperada: cambia la sugerencia, se muestra el rango y la cantidad de muestras de train/test.

Archivos sugeridos: `07_regresion_segunda_entrada.png` y `08_regresion_segundo_resultado.png`.

## Caso 5 — Clasificación: pronóstico durante el registro

1. Ir a Servicios → Agregar servicio.
2. Seleccionar paciente, médico y estudios.
3. Evidencia esperada: aparece una clase probable, confianza y probabilidades; el sistema aclara que es apoyo administrativo.

Archivos sugeridos: `09_clasificacion_entrada.png` y `10_clasificacion_pronostico.png`.

## Caso 6 — Clasificación: cambio de contexto

1. Modificar los estudios, la fecha de entrega o el porcentaje de cortesía disponible en el formulario.
2. Esperar la nueva evaluación.
3. Evidencia esperada: se recalcula la distribución de probabilidades sin bloquear el registro del servicio.

Archivos sugeridos: `11_clasificacion_segunda_entrada.png` y `12_clasificacion_segundo_resultado.png`.

## Lista de comprobación antes de entregar

- La barra de direcciones o el título de la sección permite reconocer la pantalla.
- No aparece nombre, teléfono, correo, CURP ni otro dato identificable.
- La entrada y la salida son legibles.
- Se capturan mensajes de limitación y no solo el número predicho.
- Las doce imágenes se abren correctamente dentro del ZIP.
