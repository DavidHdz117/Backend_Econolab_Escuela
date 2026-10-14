# QR en los PDF de resultados

Los PDF incluyen códigos QR reales sin depender de `LAB_QR_URL`, `LAB_QR_BASE_URL` ni `LAB_QR_PATH`:

| Documento | Código | Lector en la PWA |
| --- | --- | --- |
| Resultado individual | `econolab:study:ID` del estudio, no del resultado | Estudios → Escanear QR |
| Resultado consolidado | Un QR de estudio junto a cada encabezado | Estudios → Escanear QR |
| Pie del resultado consolidado | `econolab:service:ID` del servicio completo | Servicios → Escanear recibo |

Los códigos se generan en PNG de 360 píxeles, con margen de cuatro módulos y corrección M. Se imprimen con texto debajo para conservar la lectura. El QR contiene únicamente tipo e identificador; la consulta conserva la autenticación existente. Su función es localizar un registro, no certificar la autenticidad del PDF.

Archivos: `src/common/utils/pwa-qr.util.ts`, `src/results/results.service.ts` y `src/results/results.service.spec.ts`.

Para actualizar el proceso que sirve PDFs:

```powershell
npm run build
npm run start
```

En desarrollo puede usarse `npm run start:dev`. Genera nuevamente el PDF después de actualizar; los archivos ya descargados no cambian.

Validación sin base de datos:

```powershell
npm test -- --runInBand results.service.spec.ts
```

Las cuatro pruebas generan documentos reales con repositorios ficticios. Opcionalmente, definir `ECONOLAB_QR_EVIDENCE_DIR` guarda los PDF de demostración en un directorio local. En la verificación se renderizaron tres PDF y se decodificaron sus siete QR, además de probar el QR del servicio dentro del lector real de la PWA.
