/* eslint-disable @typescript-eslint/no-unsafe-argument,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-call,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-return,
  @typescript-eslint/require-await */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StudyClusteringAssignment } from './entities/study-clustering-assignment.entity';
import { StudyClusteringProfile } from './entities/study-clustering-profile.entity';
import {
  StudyClusteringRun,
  StudyClusteringRunStatus,
} from './entities/study-clustering-run.entity';
import { StudyClusteringService } from './study-clustering.service';

function completedRun(): StudyClusteringRun {
  return {
    id: 7,
    executedAt: new Date('2026-07-18T18:00:00.000Z'),
    status: StudyClusteringRunStatus.COMPLETED,
    periodStart: new Date('2026-02-01T00:00:00.000Z'),
    periodEnd: new Date('2026-07-18T18:00:00.000Z'),
    periodMonths: 6,
    includeSynthetic: false,
    requestedK: null,
    maxK: 6,
    selectedK: 3,
    elbowK: 3,
    selectionMethod: 'highest_silhouette',
    silhouetteScore: 0.62,
    inertia: 45.2,
    totalStudies: 48,
    profileCount: 1,
    outlierCount: 1,
    algorithm: 'kmeans',
    modelVersion: '2.0',
    evaluations: [{ k: 3, silhouette: 0.62 }],
    featureNames: ['price', 'delivery_hours'],
    excludedFeatures: ['sample_type=unknown'],
    dataQuality: { usableRows: 48 },
    warnings: ['Advertencia de prueba'],
    sources: {},
    interpretationThresholds: { price: { p33: 100, p66: 500 } },
    findings: [
      {
        findingId: 'finding-1',
        type: 'opportunity',
        titleTemplate: 'Oportunidad en {profileName}',
        descriptionTemplate: '{profileName} concentra demanda real.',
        profileId: 11,
      },
    ],
    failureMessage: null,
    profiles: [],
    assignments: [],
    createdAt: new Date('2026-07-18T18:00:00.000Z'),
  };
}

function storedProfile(): StudyClusteringProfile {
  return {
    id: 11,
    run: completedRun(),
    runId: 7,
    clusterNumber: 1,
    suggestedName: 'Estudios accesibles y frecuentes',
    displayName: 'Operación prioritaria',
    displayNameKey: 'operacion prioritaria',
    shortDescription: 'Perfil almacenado.',
    keyCharacteristics: ['Demanda dentro del tercio superior.'],
    studyCount: 20,
    percentage: 41.7,
    averages: {
      price: 150,
      deliveryHours: 2,
      parameterCount: 5,
      requestCount: 12,
    },
    predominantMethod: null,
    predominantSampleType: null,
    specialProcessingPercentage: 10,
    outlierCount: 1,
    outlierThreshold: 2.4,
    technicalDetails: {},
    assignments: [],
    createdAt: new Date('2026-07-18T18:00:00.000Z'),
    updatedAt: new Date('2026-07-18T18:00:00.000Z'),
  };
}

function storedAssignment(): StudyClusteringAssignment {
  return {
    id: 21,
    run: completedRun(),
    runId: 7,
    profile: storedProfile(),
    profileId: 11,
    studyId: 3,
    studyCodeSnapshot: 'BH01',
    studyNameSnapshot: 'BIOMETRIA HEMATICA',
    distanceToCentroid: 0.8,
    outlierScore: 1.2,
    isOutlier: true,
    isSynthetic: false,
    values: {
      price: 180,
      parameterCount: null,
      requiresSpecialProcessing: null,
    },
    createdAt: new Date('2026-07-18T18:00:00.000Z'),
  };
}

describe('StudyClusteringService', () => {
  const buildService = () => {
    const studyRepo = { find: jest.fn() };
    const detailRepo = { find: jest.fn() };
    const serviceOrderItemRepo = { createQueryBuilder: jest.fn() };
    const runRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn((value) => value),
      manager: { transaction: jest.fn() },
    };
    const profileRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    };
    const assignmentRepo = { find: jest.fn() };
    const model = {
      analyze: jest.fn(),
      isCompatibleArtifact: jest.fn().mockReturnValue(false),
      assignFromArtifact: jest.fn(),
    };
    const service = new StudyClusteringService(
      studyRepo as any,
      detailRepo as any,
      serviceOrderItemRepo as any,
      runRepo as any,
      profileRepo as any,
      assignmentRepo as any,
      model as any,
    );
    return {
      service,
      studyRepo,
      detailRepo,
      serviceOrderItemRepo,
      runRepo,
      profileRepo,
      assignmentRepo,
      model,
    };
  };

  it('GET devuelve 404 claro y nunca ejecuta el modelo si no existe un run', async () => {
    const { service, runRepo, model } = buildService();
    runRepo.findOne.mockResolvedValue(null);

    await expect(service.getLatestAnalysis()).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(model.analyze).not.toHaveBeenCalled();
  });

  it('reconstruye el contrato almacenado y usa displayName en estudios y hallazgos', async () => {
    const { service, runRepo, profileRepo, assignmentRepo, model } =
      buildService();
    runRepo.findOne.mockResolvedValue(completedRun());
    profileRepo.find.mockResolvedValue([storedProfile()]);
    assignmentRepo.find.mockResolvedValue([storedAssignment()]);

    const result = await service.getLatestAnalysis();

    expect(model.analyze).not.toHaveBeenCalled();
    expect(result.run.runId).toBe(7);
    expect(result.profiles[0].displayName).toBe('Operación prioritaria');
    expect(result.studies[0]).toEqual(
      expect.objectContaining({
        profileId: 11,
        profileDisplayName: 'Operación prioritaria',
        values: expect.objectContaining({ parameterCount: null }),
      }),
    );
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        profileId: 11,
        title: 'Oportunidad en Operación prioritaria',
        description: 'Operación prioritaria concentra demanda real.',
      }),
    );
    expect(result.technicalDetails).toEqual(
      expect.objectContaining({
        selectedK: 3,
        elbowK: 3,
        featureNames: ['price', 'delivery_hours'],
      }),
    );
  });

  it('carga el artefacto JSONB y lo usa para reasignar sin reentrenar', async () => {
    const { service, runRepo, profileRepo, assignmentRepo, model } =
      buildService();
    const run = completedRun();
    run.dataQuality = {
      usableRows: 48,
      datasetFingerprintSha256: 'huella-prueba',
      modelArtifact: { artifactType: 'econolab-study-clustering' },
    };
    runRepo.findOne.mockResolvedValue(run);
    profileRepo.find.mockResolvedValue([storedProfile()]);
    assignmentRepo.find.mockResolvedValue([storedAssignment()]);
    model.isCompatibleArtifact.mockReturnValue(true);
    model.assignFromArtifact.mockReturnValue({
      cluster: 1,
      distanceToCentroid: 0.8,
      isOutlier: true,
    });

    const result = await service.getLatestAnalysis();

    expect(model.analyze).not.toHaveBeenCalled();
    expect(model.assignFromArtifact).toHaveBeenCalledTimes(1);
    expect(result.studies[0].assignmentSource).toBe('stored_model_artifact');
    expect(result.technicalDetails.artifact).toEqual(
      expect.objectContaining({
        loaded: true,
        reassignedStudies: 1,
        mismatchesWithStoredAssignments: 0,
        datasetFingerprintSha256: 'huella-prueba',
      }),
    );
  });

  it('persiste la referencia de perfil en hallazgos del cluster cero', async () => {
    const { service, runRepo, model } = buildService();
    const row = {
      studyId: 1,
      code: 'ECO-1',
      name: 'Estudio uno',
      price: 100,
      deliveryHours: 2,
      parameterCount: null,
      requestCount: 5,
      sampleType: 'serum',
      analysisMethod: 'colorimetria',
      requiresSpecialProcessing: null,
      isSynthetic: false,
    };
    const txRunRepository = { save: jest.fn(async (value) => value) };
    const txProfileRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (profiles) =>
        profiles.map((profile: Record<string, unknown>) => ({
          ...profile,
          id: 11,
        })),
      ),
    };
    const txAssignmentRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    runRepo.save.mockImplementation(async (value) => ({ ...value, id: 7 }));
    runRepo.manager.transaction.mockImplementation(async (callback) =>
      callback({
        getRepository: (entity: unknown) => {
          if (entity === StudyClusteringRun) return txRunRepository;
          if (entity === StudyClusteringProfile) return txProfileRepository;
          return txAssignmentRepository;
        },
      }),
    );
    jest
      .spyOn(service as any, 'buildOperationalDataset')
      .mockResolvedValue([row]);
    jest
      .spyOn(service as any, 'getStoredAnalysis')
      .mockResolvedValue({ run: { runId: 7 } });
    model.analyze.mockReturnValue({
      model: {
        selectedK: 1,
        elbowK: null,
        selectionMethod: 'highest_silhouette',
        silhouetteScore: 0,
        inertia: 0,
        trainingSamples: 1,
        algorithm: 'kmeans',
        featureNames: ['price'],
      },
      profiles: [
        {
          cluster: 0,
          suggestedName: 'Estudios accesibles',
          shortDescription: 'Perfil de prueba.',
          keyCharacteristics: ['Precio bajo.'],
          studyCount: 1,
          percentage: 100,
          averages: {
            price: 100,
            deliveryHours: 2,
            parameterCount: 0,
            requestCount: 5,
          },
          predominantMethod: null,
          predominantSampleType: null,
          specialProcessingPercentage: 0,
          outlierCount: 0,
          outlierThreshold: null,
          traits: ['precio bajo'],
          sampleTypes: [],
          analysisMethods: [],
        },
      ],
      studies: [
        {
          studyId: 1,
          code: 'ECO-1',
          name: 'Estudio uno',
          cluster: 0,
          distanceToCentroid: 0,
          outlierScore: 0,
          isOutlier: false,
        },
      ],
      findings: [
        {
          findingId: 'finding-1',
          type: 'observation',
          titleTemplate: 'Perfil {profileName}',
          descriptionTemplate: '{profileName} concentra el segmento.',
          profileCluster: 0,
        },
      ],
      evaluations: [],
      dataQuality: { ignoredConstantFeatures: [] },
      warnings: [],
      interpretationThresholds: {},
    });

    await service.recalculate({});

    const persistedRun =
      txRunRepository.save.mock.calls[
        txRunRepository.save.mock.calls.length - 1
      ][0];
    expect(persistedRun.findings).toEqual([
      expect.objectContaining({ profileId: 11 }),
    ]);
  });

  it('excluye MLTRAIN, marca ECN-CAT y audita demanda ECO-ML', async () => {
    const { service, studyRepo, detailRepo, serviceOrderItemRepo } =
      buildService();
    studyRepo.find.mockResolvedValue([
      {
        id: 1,
        code: 'REAL-001',
        name: 'Estudio real',
        indicator: null,
        normalPrice: 100,
        durationMinutes: 60,
        sampleType: 'serum',
        method: 'colorimetria',
        requiresSpecialProcessing: false,
      },
      {
        id: 2,
        code: 'SYN-001',
        name: 'Sintetico por indicador',
        indicator: 'DATOS SINTETICOS',
        normalPrice: 100,
        durationMinutes: 60,
      },
      {
        id: 3,
        code: 'MLTRAIN-000003',
        name: 'Sintetico por codigo',
        indicator: null,
        normalPrice: 100,
        durationMinutes: 60,
      },
      {
        id: 4,
        code: 'ECN-CAT-QC-001',
        name: 'Catalogo sintetico trazable',
        indicator: 'Quimica clinica',
        normalPrice: 180,
        durationMinutes: 90,
        sampleType: 'serum',
        method: 'colorimetria',
        requiresSpecialProcessing: false,
      },
    ]);
    detailRepo.find.mockResolvedValue([]);
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          studyId: '4',
          requestCount: '3',
          syntheticRequestCount: '2',
        },
      ]),
    };
    serviceOrderItemRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    const dataset = await (service as any).buildOperationalDataset(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    );

    expect(dataset.map((row: { studyId: number }) => row.studyId)).toEqual([
      1, 4,
    ]);
    expect(dataset[1]).toEqual(
      expect.objectContaining({
        isSynthetic: true,
        requestCount: 3,
        syntheticRequestCount: 2,
      }),
    );
    expect(queryBuilder.setParameter).toHaveBeenCalledWith(
      'demoFolioPattern',
      'ECO-ML-%',
    );
  });

  it('rechaza nombres genericos y duplicados normalizados', async () => {
    const { service, profileRepo } = buildService();
    const genericNames = [
      'Grupo 1',
      'Segmento 0',
      'G1',
      'Perfil K4',
      'Cluster A',
      'Unknown',
      'Desconocido',
    ];
    for (const displayName of genericNames) {
      profileRepo.findOne.mockResolvedValueOnce(storedProfile());
      await expect(
        service.updateProfileDisplayName(11, { displayName }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    profileRepo.findOne
      .mockResolvedValueOnce(storedProfile())
      .mockResolvedValueOnce({ ...storedProfile(), id: 12 });
    await expect(
      service.updateProfileDisplayName(11, {
        displayName: 'Operacion prioritaria',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    profileRepo.findOne
      .mockResolvedValueOnce(storedProfile())
      .mockResolvedValueOnce(null);
    profileRepo.save.mockResolvedValueOnce({
      ...storedProfile(),
      displayName: 'Grupo económico y frecuente',
    });
    await expect(
      service.updateProfileDisplayName(11, {
        displayName: 'Grupo económico y frecuente',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: 'Grupo económico y frecuente',
        }),
      }),
    );
  });
});
