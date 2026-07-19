import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
  StudyClusteringModel,
  StudyClusteringRow,
} from './models/study-clustering.model';
import {
  PublicClusteringFinding,
  StoredClusteringFinding,
} from './study-clustering.contract';

type RequestCountRow = { studyId: string; requestCount: string };

const INTERNAL_MAX_K = 6;
const PROFILE_NAME_PLACEHOLDER = '{profileName}';

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

  /** Proceso interno: calcula K-Means con datos reales y persiste una fotografia. */
  async recalculate(dto: RecalculateStudyClusteringDto) {
    const periodMonths = dto.periodMonths ?? 6;
    const periodEnd = new Date();
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
        modelVersion: '2.0',
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
      const dataset = await this.buildOperationalDataset(
        periodStart,
        periodEnd,
      );
      const result = this.clusteringModel.analyze(dataset, {
        maxK: INTERNAL_MAX_K,
      });
      const originalRows = new Map(dataset.map((row) => [row.studyId, row]));

      await this.runRepo.manager.transaction(async (manager) => {
        const runRepository = manager.getRepository(StudyClusteringRun);
        const profileRepository = manager.getRepository(StudyClusteringProfile);
        const assignmentRepository = manager.getRepository(
          StudyClusteringAssignment,
        );

        Object.assign(run, {
          status: StudyClusteringRunStatus.COMPLETED,
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
          modelVersion: '2.0',
          evaluations: result.evaluations,
          featureNames: result.model.featureNames,
          excludedFeatures: result.dataQuality.ignoredConstantFeatures,
          dataQuality: result.dataQuality,
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
            isSynthetic: false,
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
        studyCount: profile.studyCount,
        percentage: profile.percentage,
        averages: profile.averages,
        predominantMethod: profile.predominantMethod ?? null,
        predominantSampleType: profile.predominantSampleType ?? null,
        specialProcessingPercentage: profile.specialProcessingPercentage,
        outlierCount: profile.outlierCount,
      })),
      studies: assignments.map((assignment) => {
        const profile = profileMap.get(assignment.profileId);
        if (!profile) {
          throw new Error(
            `La asignacion ${assignment.id} no tiene un perfil almacenado.`,
          );
        }
        return {
          studyId: assignment.studyId,
          code: assignment.studyCodeSnapshot,
          name: assignment.studyNameSnapshot,
          profileId: assignment.profileId,
          profileDisplayName: profile.displayName,
          isOutlier: assignment.isOutlier,
          values: assignment.values,
        };
      }),
      findings: this.renderFindings(run.findings, profileMap),
      technicalDetails: {
        algorithm: run.algorithm,
        modelVersion: run.modelVersion,
        selectedK: run.selectedK,
        elbowK: run.elbowK,
        selectionMethod: run.selectionMethod,
        silhouetteScore: run.silhouetteScore,
        inertia: run.inertia,
        evaluations: run.evaluations,
        featureNames: run.featureNames,
        excludedFeatures: run.excludedFeatures,
        interpretationThresholds: run.interpretationThresholds,
        dataQuality: run.dataQuality,
        warnings: run.warnings,
      },
    };
  }

  private async buildOperationalDataset(periodStart: Date, periodEnd: Date) {
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

    return studies.map<StudyClusteringRow>((study) => ({
      studyId: study.id,
      code: study.code,
      name: study.name,
      price: Number(study.normalPrice),
      deliveryHours: Number(study.durationMinutes) / 60,
      parameterCount: parameterCounts.get(study.id) ?? null,
      requestCount: requestCounts.get(study.id) ?? 0,
      sampleType:
        study.sampleType === StudySampleType.UNKNOWN
          ? null
          : (study.sampleType ?? null),
      analysisMethod: study.method?.trim() || null,
      requiresSpecialProcessing: study.requiresSpecialProcessing ?? null,
      isSynthetic: false,
    }));
  }

  private async loadParameterCounts(studyIds: number[]) {
    const counts = new Map<number, number>();
    if (studyIds.length === 0) return counts;
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
    const rows = await this.serviceOrderItemRepo
      .createQueryBuilder('item')
      .innerJoin('item.serviceOrder', 'serviceOrder')
      .select('item.studyId', 'studyId')
      .addSelect('COALESCE(SUM(item.quantity), 0)', 'requestCount')
      .where('serviceOrder.createdAt >= :periodStart', { periodStart })
      .andWhere('serviceOrder.createdAt <= :periodEnd', { periodEnd })
      .andWhere('serviceOrder.isActive = true')
      .andWhere('serviceOrder.status != :cancelled', {
        cancelled: ServiceStatus.CANCELLED,
      })
      .groupBy('item.studyId')
      .getRawMany<RequestCountRow>();

    return new Map(
      rows.map((row) => [Number(row.studyId), Number(row.requestCount)]),
    );
  }

  private originalValues(row: StudyClusteringRow) {
    return {
      price: row.price,
      deliveryHours: row.deliveryHours,
      parameterCount: row.parameterCount,
      requestCount: row.requestCount,
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
      sampleType: 'operativo.studies.sampleType',
      analysisMethod: 'operativo.studies.method',
      requiresSpecialProcessing: 'operativo.studies.requiresSpecialProcessing',
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
}
