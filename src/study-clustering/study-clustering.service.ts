import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { In, Repository } from 'typeorm';
import {
  ServiceOrderItem,
  ServiceStatus,
} from '../services/entities/service-order.entity';
import {
  StudyDetail,
  StudyDetailType,
} from '../studies/entities/study-detail.entity';
import {
  Study,
  StudySampleType,
  StudyStatus,
  StudyType,
} from '../studies/entities/study.entity';
import { RecalculateStudyClusteringDto } from './dto/recalculate-study-clustering.dto';
import { UpdateStudyClusterProfileDto } from './dto/update-study-cluster-profile.dto';
import { StudyClusteringAssignment } from './entities/study-clustering-assignment.entity';
import { StudyClusteringProfile } from './entities/study-clustering-profile.entity';
import {
  StudyClusteringRun,
  StudyClusteringRunStatus,
} from './entities/study-clustering-run.entity';
import {
  StudyClusteringArtifact,
  StudyClusteringModel,
  StudyClusteringRow,
} from './models/study-clustering.model';
import {
  PublicClusteringFinding,
  StoredClusteringFinding,
} from './study-clustering.contract';

type RequestCountRow = {
  studyId: string;
  requestCount: string;
  syntheticRequestCount: string;
};
type StudyRequestCounts = {
  requestCount: number;
  syntheticRequestCount: number;
};
type StoredStudyClusteringArtifact = StudyClusteringArtifact & {
  generatedAt: string;
  trainingPeriod: { start: string; end: string; months: number };
  datasetFingerprintSha256: string;
  datasetComposition: {
    totalRows: number;
    realRows: number;
    syntheticRows: number;
    syntheticPercentage: number;
    totalRequestCount: number;
    syntheticRequestCount: number;
    syntheticRequestPercentage: number;
  };
};

const INTERNAL_MAX_K = 6;
const PROFILE_NAME_PLACEHOLDER = '{profileName}';
const CLASSIFICATION_DEMO_FOLIO_PATTERN = 'ECO-ML-%';
const SYNTHETIC_CATALOG_CODE_PATTERN = /^ECN-CAT-/i;
const STUDY_CLUSTERING_ARTIFACT_RELATIVE_PATH =
  'ml/clustering/artifacts/clustering_estudios_model.json';

@Injectable()
export class StudyClusteringService {
  constructor(
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
    @InjectRepository(StudyDetail)
    private readonly detailRepo: Repository<StudyDetail>,
    @InjectRepository(ServiceOrderItem)
    private readonly serviceOrderItemRepo: Repository<ServiceOrderItem>,
    @InjectRepository(StudyClusteringRun)
    private readonly runRepo: Repository<StudyClusteringRun>,
    @InjectRepository(StudyClusteringProfile)
    private readonly profileRepo: Repository<StudyClusteringProfile>,
    @InjectRepository(StudyClusteringAssignment)
    private readonly assignmentRepo: Repository<StudyClusteringAssignment>,
    private readonly clusteringModel: StudyClusteringModel,
  ) {}

  /** Consulta exclusivamente la ultima ejecucion completada; nunca recalcula. */
  async getLatestAnalysis() {
    const latestRun = await this.runRepo.findOne({
      where: { status: StudyClusteringRunStatus.COMPLETED },
      order: { executedAt: 'DESC', id: 'DESC' },
    });

    if (!latestRun) {
      throw new NotFoundException(
        'No existe un analisis de clustering almacenado. Ejecuta primero el proceso administrativo de recalculo.',
      );
    }

    return this.getStoredAnalysis(latestRun);
  }

  /**
   * ETL REPRODUCIBLE PARA LA ENTREGA.
   * El script clustering:export usa este mismo metodo que alimenta al backend;
   * asi el CSV y el artefacto no dependen de transformaciones manuales.
   */
  async buildReproducibilityBundle(periodMonths = 6, periodEnd = new Date()) {
    if (
      !Number.isInteger(periodMonths) ||
      periodMonths < 1 ||
      periodMonths > 24
    ) {
      throw new BadRequestException(
        'El periodo de clustering debe estar entre 1 y 24 meses.',
      );
    }
    if (Number.isNaN(periodEnd.getTime())) {
      throw new BadRequestException('La fecha de corte no es valida.');
    }
    const periodStart = this.getPeriodStart(periodEnd, periodMonths);
    const dataset = await this.buildOperationalDataset(periodStart, periodEnd);
    const result = this.clusteringModel.analyze(dataset, {
      maxK: INTERNAL_MAX_K,
    });
    const artifact = this.enrichArtifact(
      result.artifact,
      dataset,
      periodStart,
      periodEnd,
      periodMonths,
    );
    return {
      metadata: {
        generatedAt: periodEnd.toISOString(),
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        periodMonths,
        unitOfAnalysis: 'Un estudio individual activo del catalogo ECONOLAB',
        datasetFingerprintSha256: artifact.datasetFingerprintSha256,
        composition: artifact.datasetComposition,
        sources: this.dataSources(),
        exclusions: [
          'Paquetes, estudios inactivos o suspendidos',
          'MLTRAIN y registros marcados como DATOS SINTETICOS',
          'Ordenes canceladas para calcular request_count',
        ],
      },
      dataset,
      artifact,
      evaluation: {
        selectedK: result.model.selectedK,
        elbowK: result.model.elbowK,
        silhouetteScore: result.model.silhouetteScore,
        daviesBouldinScore: result.model.daviesBouldinScore,
        inertia: result.model.inertia,
        alternatives: result.evaluations,
      },
      profiles: result.profiles,
      dataQuality: result.dataQuality,
      warnings: result.warnings,
    };
  }

  /** Proceso interno: calcula K-Means y persiste una fotografia verificable. */
  async recalculate(
    dto: RecalculateStudyClusteringDto,
    periodEnd = new Date(),
  ) {
    const periodMonths = dto.periodMonths ?? 6;
    const periodStart = this.getPeriodStart(periodEnd, periodMonths);
    const run = await this.runRepo.save(
      this.runRepo.create({
        executedAt: periodEnd,
        status: StudyClusteringRunStatus.RUNNING,
        periodStart,
        periodEnd,
        periodMonths,
        includeSynthetic: false,
        requestedK: null,
        maxK: INTERNAL_MAX_K,
        selectedK: null,
        elbowK: null,
        selectionMethod: null,
        silhouetteScore: null,
        inertia: null,
        totalStudies: 0,
        profileCount: 0,
        outlierCount: 0,
        algorithm: 'kmeans',
        modelVersion: '2.1',
        evaluations: [],
        featureNames: [],
        excludedFeatures: [],
        dataQuality: {},
        warnings: [],
        sources: this.dataSources(),
        interpretationThresholds: {},
        findings: [],
        failureMessage: null,
      }),
    );

    try {
      // PASO 1: consultar la BD y construir el dataset (una fila por estudio).
      const dataset = await this.buildOperationalDataset(
        periodStart,
        periodEnd,
      );

      // PASOS 2 A 4: limpiar, codificar, estandarizar y entrenar K-Means.
      // El modelo esta en models/study-clustering.model.ts.
      const result = this.clusteringModel.analyze(dataset, {
        maxK: INTERNAL_MAX_K,
      });
      // ARTEFACTO: conserva medianas, escalado, one-hot y centroides en JSONB.
      // getStoredAnalysis lo carga y lo usa para volver a asignar cada estudio.
      const modelArtifact = this.enrichArtifact(
        result.artifact,
        dataset,
        periodStart,
        periodEnd,
        periodMonths,
      );
      const originalRows = new Map(dataset.map((row) => [row.studyId, row]));

      // PASO 5: guardar la ejecucion, los perfiles y el cluster de cada estudio.
      await this.runRepo.manager.transaction(async (manager) => {
        const runRepository = manager.getRepository(StudyClusteringRun);
        const profileRepository = manager.getRepository(StudyClusteringProfile);
        const assignmentRepository = manager.getRepository(
          StudyClusteringAssignment,
        );

        Object.assign(run, {
          status: StudyClusteringRunStatus.COMPLETED,
          includeSynthetic: modelArtifact.datasetComposition.syntheticRows > 0,
          selectedK: result.model.selectedK,
          elbowK: result.model.elbowK,
          selectionMethod: result.model.selectionMethod,
          silhouetteScore: result.model.silhouetteScore,
          inertia: result.model.inertia,
          totalStudies: result.model.trainingSamples,
          profileCount: result.profiles.length,
          outlierCount: result.studies.filter((study) => study.isOutlier)
            .length,
          algorithm: result.model.algorithm,
          modelVersion: '2.1',
          evaluations: result.evaluations,
          featureNames: result.model.featureNames,
          excludedFeatures: result.dataQuality.ignoredConstantFeatures,
          dataQuality: {
            ...result.dataQuality,
            modelArtifact,
            datasetFingerprintSha256: modelArtifact.datasetFingerprintSha256,
          },
          warnings: result.warnings,
          sources: this.dataSources(),
          interpretationThresholds: result.interpretationThresholds,
          failureMessage: null,
        });
        await runRepository.save(run);

        const profileEntities = result.profiles.map((profile) =>
          profileRepository.create({
            runId: run.id,
            clusterNumber: profile.cluster,
            suggestedName: profile.suggestedName,
            displayName: profile.suggestedName,
            displayNameKey: this.normalizeDisplayName(profile.suggestedName),
            shortDescription: profile.shortDescription,
            keyCharacteristics: profile.keyCharacteristics,
            studyCount: profile.studyCount,
            percentage: profile.percentage,
            averages: profile.averages,
            predominantMethod: profile.predominantMethod,
            predominantSampleType: profile.predominantSampleType,
            specialProcessingPercentage: profile.specialProcessingPercentage,
            outlierCount: profile.outlierCount,
            outlierThreshold: profile.outlierThreshold,
            technicalDetails: {
              traits: profile.traits,
              sampleTypes: profile.sampleTypes,
              analysisMethods: profile.analysisMethods,
              clusterNumber: profile.cluster,
              suggestedAction: profile.suggestedAction,
            },
          }),
        );
        const savedProfiles = await profileRepository.save(profileEntities);
        const profileByCluster = new Map(
          savedProfiles.map((profile) => [profile.clusterNumber, profile]),
        );

        const assignments = result.studies.map((study) => {
          const profile = profileByCluster.get(study.cluster);
          const original = originalRows.get(study.studyId);
          if (!profile || !original) {
            throw new Error(
              `No fue posible persistir la asignacion del estudio ${study.studyId}.`,
            );
          }
          return assignmentRepository.create({
            runId: run.id,
            profileId: profile.id,
            studyId: study.studyId,
            studyCodeSnapshot: study.code,
            studyNameSnapshot: study.name,
            distanceToCentroid: study.distanceToCentroid,
            outlierScore: study.outlierScore,
            isOutlier: study.isOutlier,
            isSynthetic: study.isSynthetic,
            // La interfaz recibe los datos originales, no los imputados del vector.
            values: this.originalValues(original),
          });
        });
        await assignmentRepository.save(assignments);

        run.findings = result.findings.map((finding) => {
          const profile =
            finding.profileCluster != null
              ? profileByCluster.get(finding.profileCluster)
              : undefined;
          const stored: StoredClusteringFinding = {
            findingId: finding.findingId,
            type: finding.type,
            titleTemplate: finding.titleTemplate,
            descriptionTemplate: finding.descriptionTemplate,
            ...(profile ? { profileId: profile.id } : {}),
          };
          return stored;
        });
        await runRepository.save(run);
      });
    } catch (error) {
      await this.markRunFailed(run.id, error);
      throw error;
    }

    return this.getStoredAnalysis(run);
  }

  async updateProfileDisplayName(
    profileId: number,
    dto: UpdateStudyClusterProfileDto,
  ) {
    const profile = await this.profileRepo.findOne({
      where: { id: profileId },
    });
    if (!profile) {
      throw new NotFoundException('Perfil de clustering no encontrado.');
    }

    const displayName = dto.displayName.trim().replace(/\s+/g, ' ');
    const displayNameKey = this.normalizeDisplayName(displayName);
    if (this.isGenericProfileName(displayNameKey)) {
      throw new BadRequestException(
        'Usa un nombre descriptivo; no se permiten nombres genericos como Grupo 1 o Cluster 2.',
      );
    }

    const duplicate = await this.profileRepo.findOne({
      where: { runId: profile.runId, displayNameKey },
    });
    if (duplicate && duplicate.id !== profile.id) {
      throw new ConflictException(
        'Ya existe otro perfil de esta ejecucion con el mismo nombre.',
      );
    }

    profile.displayName = displayName;
    profile.displayNameKey = displayNameKey;
    try {
      const saved = await this.profileRepo.save(profile);
      return {
        message: 'Nombre del perfil actualizado correctamente.',
        data: {
          profileId: saved.id,
          displayName: saved.displayName,
        },
      };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Ya existe otro perfil de esta ejecucion con el mismo nombre.',
        );
      }
      throw error;
    }
  }

  private async getStoredAnalysis(run: StudyClusteringRun) {
    if (
      run.status !== StudyClusteringRunStatus.COMPLETED ||
      run.selectedK == null ||
      run.silhouetteScore == null ||
      run.inertia == null
    ) {
      throw new NotFoundException(
        'La ejecucion de clustering solicitada no esta completada.',
      );
    }

    // USO DEL MODELO: la pantalla no vuelve a entrenar. Lee la ultima
    // fotografia almacenada de perfiles y asignaciones generada por K-Means.
    const [profiles, assignments] = await Promise.all([
      this.profileRepo.find({
        where: { runId: run.id },
        order: { clusterNumber: 'ASC', id: 'ASC' },
      }),
      this.assignmentRepo.find({
        where: { runId: run.id },
        order: { studyNameSnapshot: 'ASC', id: 'ASC' },
      }),
    ]);
    const profileMap = new Map(
      profiles.map((profile) => [profile.id, profile]),
    );
    const profileByCluster = new Map(
      profiles.map((profile) => [profile.clusterNumber, profile]),
    );
    const artifactCandidate =
      this.loadClusteringArtifactFromFile(run) ?? run.dataQuality?.modelArtifact;
    const artifact =
      typeof this.clusteringModel.isCompatibleArtifact === 'function' &&
      this.clusteringModel.isCompatibleArtifact(artifactCandidate)
        ? artifactCandidate
        : null;
    const reassignmentRows = assignments.map((assignment) =>
      this.assignmentAsModelRow(assignment),
    );
    const reappliedAssignments =
      artifact &&
      typeof this.clusteringModel.assignManyUsingExportedModel === 'function'
        ? this.clusteringModel.assignManyUsingExportedModel(
            reassignmentRows,
            artifact,
          )
        : null;
    let artifactMismatches = 0;
    const returnedStudies = assignments.map((assignment, index) => {
      const storedProfile = profileMap.get(assignment.profileId);
      if (!storedProfile) {
        throw new Error(
          `La asignacion ${assignment.id} no tiene un perfil almacenado.`,
        );
      }

      // CARGA Y USO DEL ARTEFACTO: vuelve a preparar la fila con los parametros
      // guardados y calcula el centroide mas cercano, sin reentrenar K-Means.
      const reapplied = artifact
        ? reappliedAssignments?.[index] ??
          this.clusteringModel.assignFromArtifact(
            reassignmentRows[index],
            artifact,
          )
        : null;
      const profile = reapplied
        ? profileByCluster.get(reapplied.cluster)
        : storedProfile;
      if (!profile) {
        throw new Error(
          `El artefacto asigno un cluster inexistente al estudio ${assignment.studyId}.`,
        );
      }
      if (reapplied && profile.id !== storedProfile.id) {
        artifactMismatches += 1;
      }
      return {
        studyId: assignment.studyId,
        code: assignment.studyCodeSnapshot,
        name: assignment.studyNameSnapshot,
        profileId: profile.id,
        profileDisplayName: profile.displayName,
        isOutlier: reapplied?.isOutlier ?? assignment.isOutlier,
        isSynthetic: assignment.isSynthetic,
        assignmentSource: reapplied
          ? ('stored_model_artifact' as const)
          : ('stored_assignment' as const),
        values: assignment.values,
      };
    });
    const selectedEvaluation = run.evaluations.find(
      (evaluation) =>
        evaluation.isSelected === true || evaluation.k === run.selectedK,
    );
    const daviesBouldinScore =
      typeof selectedEvaluation?.daviesBouldin === 'number'
        ? selectedEvaluation.daviesBouldin
        : null;
    const { modelArtifact: hiddenArtifact, ...publicDataQuality } =
      run.dataQuality;
    void hiddenArtifact;

    return {
      run: {
        runId: run.id,
        executedAt: run.executedAt.toISOString(),
        periodLabel: this.formatPeriodLabel(run.periodStart, run.periodEnd),
        totalStudies: run.totalStudies,
        profileCount: run.profileCount,
        outlierCount: run.outlierCount,
      },
      profiles: profiles.map((profile) => ({
        profileId: profile.id,
        suggestedName: profile.suggestedName,
        displayName: profile.displayName,
        shortDescription: profile.shortDescription,
        keyCharacteristics: profile.keyCharacteristics,
        suggestedAction:
          typeof profile.technicalDetails?.suggestedAction === 'string'
            ? profile.technicalDetails.suggestedAction
            : 'Revisar periodicamente los indicadores administrativos de este segmento.',
        studyCount: profile.studyCount,
        percentage: profile.percentage,
        averages: profile.averages,
        predominantMethod: profile.predominantMethod ?? null,
        predominantSampleType: profile.predominantSampleType ?? null,
        specialProcessingPercentage: profile.specialProcessingPercentage,
        outlierCount: profile.outlierCount,
      })),
      studies: returnedStudies,
      findings: this.renderFindings(run.findings, profileMap),
      technicalDetails: {
        algorithm: run.algorithm,
        modelVersion: run.modelVersion,
        selectedK: run.selectedK,
        elbowK: run.elbowK,
        selectionMethod: run.selectionMethod,
        silhouetteScore: run.silhouetteScore,
        daviesBouldinScore,
        inertia: run.inertia,
        evaluations: run.evaluations,
        featureNames: run.featureNames,
        excludedFeatures: run.excludedFeatures,
        interpretationThresholds: run.interpretationThresholds,
        dataQuality: publicDataQuality,
        artifact: {
          storage: 'operativo.study_clustering_runs.data_quality.modelArtifact',
          loaded: artifact != null,
          schemaVersion: artifact?.schemaVersion ?? null,
          datasetFingerprintSha256:
            typeof run.dataQuality.datasetFingerprintSha256 === 'string'
              ? run.dataQuality.datasetFingerprintSha256
              : null,
          reassignedStudies: artifact ? assignments.length : 0,
          mismatchesWithStoredAssignments: artifactMismatches,
        },
        warnings: run.warnings,
      },
    };
  }

  /**
   * PASO 1 - CONSULTA Y DATASET.
   * TypeORM convierte estas consultas en SELECT sobre studies, study_details y
   * service_order_items. El resultado final tiene una fila por cada estudio.
   */
  private async buildOperationalDataset(periodStart: Date, periodEnd: Date) {
    // CONSULTA 1: estudios individuales y activos del catalogo.
    // ECN-CAT-* se conserva porque forma parte de la BD, pero se marca como
    // sintetico para reportar su proporcion; esa bandera NO entra a K-Means.
    const studies = (
      await this.studyRepo.find({
        where: {
          isActive: true,
          status: StudyStatus.ACTIVE,
          type: StudyType.STUDY,
        },
        order: { id: 'ASC' },
      })
    ).filter(
      (study) =>
        study.indicator?.trim().toUpperCase() !== 'DATOS SINTETICOS' &&
        !/^MLTRAIN-\d{6}$/i.test(study.code?.trim() ?? ''),
    );
    const studyIds = studies.map((study) => study.id);
    const [parameterCounts, requestCounts] = await Promise.all([
      this.loadParameterCounts(studyIds),
      this.loadActualRequestCounts(periodStart, periodEnd),
    ]);

    // CREACION DEL DATASET: cada objeto es una fila y cada propiedad es una
    // columna. studyId, code y name solo identifican el resultado; el modelo
    // no los incluye entre sus variables de entrenamiento.
    return studies.map<StudyClusteringRow>((study) => {
      const demand = requestCounts.get(study.id);
      return {
        studyId: study.id,
        code: study.code,
        name: study.name,
        price: Number(study.normalPrice),
        deliveryHours: Number(study.durationMinutes) / 60,
        parameterCount: parameterCounts.get(study.id) ?? null,
        requestCount: demand?.requestCount ?? 0,
        // Auditoria: permite medir cuanto de requestCount procede de ECO-ML.
        // Esta columna no forma parte de las variables codificadas por el modelo.
        syntheticRequestCount: demand?.syntheticRequestCount ?? 0,
        sampleType:
          study.sampleType === StudySampleType.UNKNOWN
            ? null
            : (study.sampleType ?? null),
        analysisMethod: study.method?.trim() || null,
        requiresSpecialProcessing: study.requiresSpecialProcessing ?? null,
        isSynthetic: SYNTHETIC_CATALOG_CODE_PATTERN.test(
          study.code?.trim() ?? '',
        ),
      };
    });
  }

  private async loadParameterCounts(studyIds: number[]) {
    const counts = new Map<number, number>();
    if (studyIds.length === 0) return counts;
    // CONSULTA 2: cuenta los parametros activos incluidos en cada estudio.
    const details = await this.detailRepo.find({
      where: {
        studyId: In(studyIds),
        dataType: StudyDetailType.PARAMETER,
        isActive: true,
      },
      select: ['studyId'],
    });
    details.forEach((detail) =>
      counts.set(detail.studyId, (counts.get(detail.studyId) ?? 0) + 1),
    );
    return counts;
  }

  private async loadActualRequestCounts(periodStart: Date, periodEnd: Date) {
    // CONSULTA 3: suma cuantas veces se solicito cada estudio en el periodo.
    // Se excluyen ordenes canceladas porque no representan demanda atendida.
    // ECO-ML se incluye para que el historial demostrativo tenga trazabilidad
    // desde la BD. Su aporte se cuenta aparte y se informa como sintetico.
    const rows = await this.serviceOrderItemRepo
      .createQueryBuilder('item')
      .innerJoin('item.serviceOrder', 'serviceOrder')
      .select('item.studyId', 'studyId')
      .addSelect('COALESCE(SUM(item.quantity), 0)', 'requestCount')
      .addSelect(
        `COALESCE(SUM(CASE WHEN serviceOrder.folio LIKE :demoFolioPattern THEN item.quantity ELSE 0 END), 0)`,
        'syntheticRequestCount',
      )
      .where('serviceOrder.createdAt >= :periodStart', { periodStart })
      .andWhere('serviceOrder.createdAt <= :periodEnd', { periodEnd })
      .andWhere('serviceOrder.isActive = true')
      .andWhere('serviceOrder.status != :cancelled', {
        cancelled: ServiceStatus.CANCELLED,
      })
      .setParameter('demoFolioPattern', CLASSIFICATION_DEMO_FOLIO_PATTERN)
      .groupBy('item.studyId')
      .getRawMany<RequestCountRow>();

    return new Map<number, StudyRequestCounts>(
      rows.map((row) => [
        Number(row.studyId),
        {
          requestCount: Number(row.requestCount),
          syntheticRequestCount: Number(row.syntheticRequestCount),
        },
      ]),
    );
  }

  private enrichArtifact(
    artifact: StudyClusteringArtifact,
    dataset: StudyClusteringRow[],
    periodStart: Date,
    periodEnd: Date,
    periodMonths: number,
  ): StoredStudyClusteringArtifact {
    const syntheticRows = dataset.filter((row) => row.isSynthetic).length;
    const totalRequestCount = dataset.reduce(
      (sum, row) => sum + Number(row.requestCount ?? 0),
      0,
    );
    const syntheticRequestCount = dataset.reduce(
      (sum, row) => sum + Number(row.syntheticRequestCount ?? 0),
      0,
    );
    return {
      ...artifact,
      generatedAt: periodEnd.toISOString(),
      trainingPeriod: {
        start: periodStart.toISOString(),
        end: periodEnd.toISOString(),
        months: periodMonths,
      },
      datasetFingerprintSha256: this.datasetFingerprint(dataset),
      datasetComposition: {
        totalRows: dataset.length,
        realRows: dataset.length - syntheticRows,
        syntheticRows,
        syntheticPercentage: Number(
          ((syntheticRows / Math.max(dataset.length, 1)) * 100).toFixed(2),
        ),
        totalRequestCount,
        syntheticRequestCount,
        syntheticRequestPercentage: Number(
          (
            (syntheticRequestCount / Math.max(totalRequestCount, 1)) *
            100
          ).toFixed(2),
        ),
      },
    };
  }

  /** Huella para demostrar que CSV, libreta y ejecucion web usan las mismas filas. */
  private datasetFingerprint(dataset: StudyClusteringRow[]) {
    const canonicalRows = [...dataset]
      .sort((left, right) => left.studyId - right.studyId)
      .map((row) => ({
        studyId: row.studyId,
        code: row.code,
        name: row.name,
        price: row.price,
        deliveryHours: row.deliveryHours,
        parameterCount: row.parameterCount,
        requestCount: row.requestCount,
        syntheticRequestCount: row.syntheticRequestCount ?? 0,
        sampleType: row.sampleType,
        analysisMethod: row.analysisMethod,
        requiresSpecialProcessing: row.requiresSpecialProcessing,
        isSynthetic: row.isSynthetic === true,
      }));
    return createHash('sha256')
      .update(JSON.stringify(canonicalRows), 'utf8')
      .digest('hex');
  }

  private assignmentAsModelRow(
    assignment: StudyClusteringAssignment,
  ): StudyClusteringRow {
    const values = assignment.values;
    const numberOrNull = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const stringOrNull = (value: unknown) =>
      typeof value === 'string' ? value : null;
    return {
      studyId: assignment.studyId,
      code: assignment.studyCodeSnapshot,
      name: assignment.studyNameSnapshot,
      price: numberOrNull(values.price),
      deliveryHours: numberOrNull(values.deliveryHours),
      parameterCount: numberOrNull(values.parameterCount),
      requestCount: numberOrNull(values.requestCount),
      syntheticRequestCount: numberOrNull(values.syntheticRequestCount),
      sampleType: stringOrNull(values.sampleType),
      analysisMethod: stringOrNull(values.analysisMethod),
      requiresSpecialProcessing:
        typeof values.requiresSpecialProcessing === 'boolean'
          ? values.requiresSpecialProcessing
          : null,
      isSynthetic: assignment.isSynthetic,
    };
  }

  private originalValues(row: StudyClusteringRow) {
    return {
      price: row.price,
      deliveryHours: row.deliveryHours,
      parameterCount: row.parameterCount,
      requestCount: row.requestCount,
      syntheticRequestCount: row.syntheticRequestCount ?? 0,
      sampleType: row.sampleType,
      analysisMethod: row.analysisMethod,
      requiresSpecialProcessing: row.requiresSpecialProcessing,
    };
  }

  private renderFindings(
    findings: Array<Record<string, unknown>>,
    profiles: Map<number, StudyClusteringProfile>,
  ): PublicClusteringFinding[] {
    return (findings as StoredClusteringFinding[]).map((finding) => {
      const profile = finding.profileId
        ? profiles.get(finding.profileId)
        : undefined;
      const profileName = profile?.displayName ?? 'el perfil analizado';
      return {
        findingId: finding.findingId,
        type: finding.type,
        title: this.interpolateProfileName(finding.titleTemplate, profileName),
        description: this.interpolateProfileName(
          finding.descriptionTemplate,
          profileName,
        ),
        ...(profile ? { profileId: profile.id } : {}),
      };
    });
  }

  private interpolateProfileName(template: string, profileName: string) {
    return template.split(PROFILE_NAME_PLACEHOLDER).join(profileName);
  }

  private getPeriodStart(periodEnd: Date, periodMonths: number) {
    const periodStart = new Date(periodEnd);
    periodStart.setUTCMonth(periodStart.getUTCMonth() - (periodMonths - 1));
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);
    return periodStart;
  }

  private formatPeriodLabel(periodStart: Date, periodEnd: Date) {
    const options: Intl.DateTimeFormatOptions = {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    };
    const startFormatter = new Intl.DateTimeFormat('es-MX', {
      ...options,
      timeZone: 'UTC',
    });
    const endFormatter = new Intl.DateTimeFormat('es-MX', {
      ...options,
      timeZone: 'America/Mexico_City',
    });
    return `${startFormatter.format(periodStart)} al ${endFormatter.format(periodEnd)}`;
  }

  private dataSources() {
    return {
      price: 'operativo.studies.normalPrice',
      deliveryHours: 'operativo.studies.durationMinutes / 60',
      parameterCount: 'operativo.study_details',
      requestCount: 'operativo.service_order_items + operativo.service_orders',
      syntheticRequestCount:
        "misma fuente; SUM(quantity) cuando folio LIKE 'ECO-ML-%' (solo auditoria)",
      sampleType: 'operativo.studies.sampleType',
      analysisMethod: 'operativo.studies.method',
      requiresSpecialProcessing: 'operativo.studies.requiresSpecialProcessing',
      isSynthetic:
        "operativo.studies.code LIKE 'ECN-CAT-%' (solo auditoria; no entra al modelo)",
    };
  }

  private normalizeDisplayName(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private isGenericProfileName(normalizedName: string) {
    return (
      ['unknown', 'desconocido', 'sin especificar', 'sin_especificar'].includes(
        normalizedName,
      ) ||
      /^(?:(?:grupo|cluster|perfil|segmento)(?:\s*(?:(?:numero|no)\s*)?#?\s*(?:[a-z]?\d+|[a-z]))?|(?:g|k)\s*\d+)$/.test(
        normalizedName,
      )
    );
  }

  private async markRunFailed(runId: number, error: unknown) {
    try {
      await this.runRepo.update(runId, {
        status: StudyClusteringRunStatus.FAILED,
        failureMessage: this.errorMessage(error),
      });
    } catch {
      // Se conserva el error original si tambien falla el registro del estado.
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error
      ? error.message.slice(0, 2000)
      : 'Error desconocido durante el recalculo.';
  }

  private isUniqueConstraintError(error: unknown) {
    const candidate = error as {
      driverError?: { code?: string };
      code?: string;
    };
    return (
      candidate.driverError?.code === '23505' || candidate.code === '23505'
    );
  }

  private loadClusteringArtifactFromFile(run: StudyClusteringRun) {
    const artifactPath = this.resolveClusteringArtifactPath();
    if (!existsSync(artifactPath)) return null;

    try {
      const artifactCandidate = JSON.parse(
        readFileSync(artifactPath, 'utf8'),
      ) as StoredStudyClusteringArtifact;
      if (
        typeof this.clusteringModel.isCompatibleArtifact === 'function' &&
        !this.clusteringModel.isCompatibleArtifact(artifactCandidate)
      ) {
        return null;
      }
      const expectedFingerprint =
        run.dataQuality?.datasetFingerprintSha256 ?? null;
      if (
        expectedFingerprint &&
        artifactCandidate.datasetFingerprintSha256 !== expectedFingerprint
      ) {
        return null;
      }
      return artifactCandidate;
    } catch {
      return null;
    }
  }

  private resolveClusteringArtifactPath() {
    const configuredPath = process.env.STUDY_CLUSTERING_MODEL_PATH?.trim();
    if (configuredPath) {
      return isAbsolute(configuredPath)
        ? configuredPath
        : resolve(process.cwd(), configuredPath);
    }

    const candidates = [
      resolve(process.cwd(), STUDY_CLUSTERING_ARTIFACT_RELATIVE_PATH),
      resolve(
        __dirname,
        '../../',
        STUDY_CLUSTERING_ARTIFACT_RELATIVE_PATH,
      ),
    ];
    return (
      candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
    );
  }
}

