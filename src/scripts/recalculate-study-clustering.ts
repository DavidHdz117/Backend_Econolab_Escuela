import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { StudyClusteringService } from '../study-clustering/study-clustering.service';

function periodMonthsFromArgs() {
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith('--periodMonths='));
  const rawValue =
    argument?.split('=', 2)[1] ?? process.env.CLUSTERING_PERIOD_MONTHS ?? '6';
  const periodMonths = Number(rawValue);

  if (
    !Number.isInteger(periodMonths) ||
    periodMonths < 1 ||
    periodMonths > 24
  ) {
    throw new Error('periodMonths debe ser un entero entre 1 y 24.');
  }

  return periodMonths;
}

async function main() {
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const periodMonths = periodMonthsFromArgs();
    const clusteringService = application.get(StudyClusteringService);

    // PUNTO DONDE SE USA EL MODELO: este comando llama al servicio que consulta
    // la BD, crea el dataset, ejecuta K-Means y almacena los resultados.
    const result = await clusteringService.recalculate({ periodMonths });
    process.stdout.write(
      `${JSON.stringify(
        {
          message: 'Clustering recalculado y almacenado correctamente.',
          run: result.run,
          technicalDetails: {
            selectedK: result.technicalDetails.selectedK,
            silhouetteScore: result.technicalDetails.silhouetteScore,
            daviesBouldinScore:
              result.technicalDetails.daviesBouldinScore,
            artifact: result.technicalDetails.artifact,
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await application.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`No fue posible recalcular el clustering: ${message}\n`);
  process.exitCode = 1;
});
