# Reporte práctico

Esta carpeta contiene el informe exigido por la rúbrica en dos formatos:

- `Reporte_Practico_ECONOLAB.docx` para edición en Word;
- `Reporte_Practico_ECONOLAB.pdf` como versión de lectura;
- `Reporte_Practico_ECONOLAB.html` como fuente reproducible;
- `generar_reporte.ps1` para reconstruir ambos archivos desde los artefactos,
  métricas y evidencias actuales.

El informe se limita a la parte práctica de extracción de conocimiento y está
organizado con las seis fases de CRISP-DM para las tres soluciones. Los valores
del modelo se leen desde `07_Modelos`; no se transcriben desde una ejecución
distinta.

La copia incluida en el repositorio conserva `PENDIENTE` en los datos que el
proyecto no permite inferir. Al ejecutar `generar_entrega_practica.ps1`, la
portada se vuelve a generar con los nombres, matrículas, grupo y equipo que se
proporcionen al empaquetador.

Para regenerar manualmente una versión preliminar:

```powershell
.\01_Reporte\generar_reporte.ps1
```

Las dependencias del generador se instalan con
`pip install -r 01_Reporte/requirements.txt`; Google Chrome o Microsoft Edge
exporta el HTML resuelto a PDF sin abrir una interfaz. Las capturas autenticadas
que aún no existan se representan con un recuadro claramente marcado; después
de guardarlas con los nombres de `09_Evidencias/README.md`, basta ejecutar de
nuevo el generador.
