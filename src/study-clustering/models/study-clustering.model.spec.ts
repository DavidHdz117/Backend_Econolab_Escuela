import {
  StudyClusteringModel,
  StudyClusteringRow,
} from './study-clustering.model';

function buildThreeClearGroups(): StudyClusteringRow[] {
  const rows: StudyClusteringRow[] = [];

  for (let index = 0; index < 5; index += 1) {
    rows.push({
      studyId: index + 1,
      code: `ECO-${index + 1}`,
      name: `Estudio economico ${index + 1}`,
      price: 100 + index * 5,
      deliveryHours: 1 + index * 0.1,
      parameterCount: 2 + (index % 2),
      requestCount: 120 + index * 4,
      sampleType: 'Suero',
      analysisMethod: 'Colorimetria',
      requiresSpecialProcessing: false,
    });
  }

  for (let index = 0; index < 5; index += 1) {
    rows.push({
      studyId: index + 6,
      code: `MULTI-${index + 1}`,
      name: `Estudio multiparametro ${index + 1}`,
      price: 500 + index * 8,
      deliveryHours: 12 + index * 0.2,
      parameterCount: 20 + index,
      requestCount: 45 + index * 2,
      sampleType: 'Plasma',
      analysisMethod: 'Espectrofotometria',
      requiresSpecialProcessing: false,
    });
  }

  for (let index = 0; index < 5; index += 1) {
    rows.push({
      studyId: index + 11,
      code: `ESP-${index + 1}`,
      name: `Estudio especializado ${index + 1}`,
      price: 1200 + index * 15,
      deliveryHours: 72 + index,
      parameterCount: 7 + (index % 2),
      requestCount: 4 + index,
      sampleType: 'Biopsia',
      analysisMethod: 'PCR',
      requiresSpecialProcessing: true,
    });
  }

  return rows;
}

function assignmentMap(result: ReturnType<StudyClusteringModel['analyze']>) {
  return new Map(result.studies.map((study) => [study.studyId, study.cluster]));
}

function expectOnlyFiniteNumbers(value: unknown): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(expectOnlyFiniteNumbers);
    return;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach(expectOnlyFiniteNumbers);
  }
}

describe('StudyClusteringModel', () => {
  it('separa tres grupos claros cuando se solicita k=3', () => {
    const model = new StudyClusteringModel();
    const result = model.analyze(buildThreeClearGroups(), { requestedK: 3 });
    const assignments = assignmentMap(result);
    const clustersByExpectedGroup = [
      new Set([1, 2, 3, 4, 5].map((id) => assignments.get(id))),
      new Set([6, 7, 8, 9, 10].map((id) => assignments.get(id))),
      new Set([11, 12, 13, 14, 15].map((id) => assignments.get(id))),
    ];

    expect(result.model.selectedK).toBe(3);
    expect(result.model.selectionMethod).toBe('requested_by_user');
    expect(result.model.trainingSamples).toBe(15);
    expect(result.profiles).toHaveLength(3);
    expect(
      result.profiles.some(
        (profile) =>
          profile.suggestedName === 'Estudios accesibles y frecuentes',
      ),
    ).toBe(true);
    expect(
      result.profiles.every(
        (profile) => !/^(grupo|cluster)\s+\d+$/i.test(profile.suggestedName),
      ),
    ).toBe(true);
    expect(
      new Set(result.profiles.map((profile) => profile.suggestedName)).size,
    ).toBe(result.profiles.length);
    expect(
      result.profiles.map((profile) => profile.predominantSampleType),
    ).toEqual(expect.arrayContaining(['Suero', 'Plasma']));
    expect(result.profiles.map((profile) => profile.predominantMethod)).toEqual(
      expect.arrayContaining(['Colorimetría', 'Espectrofotometría', 'PCR']),
    );
    expect(
      clustersByExpectedGroup.every((clusters) => clusters.size === 1),
    ).toBe(true);
    expect(
      new Set(clustersByExpectedGroup.map((clusters) => [...clusters][0])).size,
    ).toBe(3);
  });

  it('produce el mismo resultado aunque las filas lleguen en otro orden', () => {
    const model = new StudyClusteringModel();
    const rows = buildThreeClearGroups();
    const original = model.analyze(rows, { requestedK: 3 });
    const reordered = model.analyze(
      [...rows].sort((left, right) => right.studyId - left.studyId),
      { requestedK: 3 },
    );

    expect(assignmentMap(reordered)).toEqual(assignmentMap(original));
    expect(reordered.evaluations).toEqual(original.evaluations);
    expect(reordered.profiles).toEqual(original.profiles);
  });

  it('no utiliza id, codigo ni nombre como variables del modelo', () => {
    const model = new StudyClusteringModel();
    const rows = buildThreeClearGroups();
    const original = model.analyze(rows, { requestedK: 3 });
    const changedIdentifiers = rows.map((row) => ({
      ...row,
      studyId: row.studyId + 10_000,
      code: `CODIGO-DIFERENTE-${row.studyId}`,
      name: `Nombre completamente diferente ${row.studyId}`,
    }));
    const changed = model.analyze(changedIdentifiers, { requestedK: 3 });
    const originalAssignments = assignmentMap(original);
    const changedAssignments = assignmentMap(changed);

    for (const row of rows) {
      expect(changedAssignments.get(row.studyId + 10_000)).toBe(
        originalAssignments.get(row.studyId),
      );
    }
    expect(changed.model.displayOnlyFields).toEqual([
      'studyId',
      'code',
      'name',
    ]);
    expect(changed.model.featureNames).not.toEqual(
      expect.arrayContaining(['studyId', 'code', 'name']),
    );
  });

  it('reporta inercia no creciente y siluetas dentro del intervalo valido', () => {
    const model = new StudyClusteringModel();
    const result = model.analyze(buildThreeClearGroups(), { requestedK: 3 });

    for (let index = 0; index < result.evaluations.length; index += 1) {
      const evaluation = result.evaluations[index];
      expect(Number.isFinite(evaluation.inertia)).toBe(true);
      expect(Number.isFinite(evaluation.silhouette)).toBe(true);
      expect(evaluation.silhouette).toBeGreaterThanOrEqual(-1);
      expect(evaluation.silhouette).toBeLessThanOrEqual(1);

      if (index > 0) {
        expect(evaluation.inertia).toBeLessThanOrEqual(
          result.evaluations[index - 1].inertia,
        );
      }
    }
  });

  it('limpia duplicados, imputa nulos y soporta variables constantes sin NaN', () => {
    const model = new StudyClusteringModel();
    const rows: StudyClusteringRow[] = Array.from(
      { length: 12 },
      (_, index) => ({
        studyId: index + 1,
        code: `LIM-${index + 1}`,
        name: `Estudio limpieza ${index + 1}`,
        price: index % 4 === 0 ? null : 100 + index * 25,
        deliveryHours: null,
        parameterCount: index === 0 ? null : 5,
        requestCount: index === 1 ? -1 : 0,
        sampleType: null,
        analysisMethod: null,
        requiresSpecialProcessing: null,
      }),
    );
    rows.push({
      ...rows[0],
      code: 'DUPLICADO',
      name: 'Fila duplicada',
    });

    const result = model.analyze(rows, { requestedK: 2, maxK: 4 });

    expect(result.dataQuality.receivedRows).toBe(13);
    expect(result.dataQuality.usableRows).toBe(12);
    expect(result.dataQuality.duplicateRows).toBe(1);
    expect(result.dataQuality.imputedValues).toEqual({
      price: 3,
      deliveryHours: 12,
      parameterCount: 1,
      requestCount: 1,
      requiresSpecialProcessing: 12,
    });
    expect(result.dataQuality.ignoredConstantFeatures).toEqual(
      expect.arrayContaining([
        'delivery_hours',
        'parameter_count',
        'request_count',
        'requires_special_processing',
      ]),
    );
    expect(result.model.featureNames).not.toEqual(
      expect.arrayContaining([
        'delivery_hours',
        'parameter_count',
        'request_count',
        'sample_type=sin_especificar',
        'analysis_method=sin_especificar',
        'requires_special_processing',
      ]),
    );
    expect(result.profiles.flatMap((profile) => profile.traits)).not.toEqual(
      expect.arrayContaining([
        'demanda alta',
        'demanda baja',
        'multiparametro',
      ]),
    );
    expect(result.warnings.join(' ')).toContain('mediana');
    expect(result.studies).toHaveLength(12);
    expectOnlyFiniteNumbers(result);
  });

  it('excluye unknown de variables, predominantes, nombres y hallazgos', () => {
    const model = new StudyClusteringModel();
    const rows = buildThreeClearGroups().map((row, index) => ({
      ...row,
      sampleType: index < 12 ? 'unknown' : row.sampleType,
      analysisMethod: index < 12 ? null : row.analysisMethod,
    }));

    const result = model.analyze(rows, { requestedK: 3 });

    expect(result.model.featureNames).not.toEqual(
      expect.arrayContaining([
        'sample_type=unknown',
        'analysis_method=sin_especificar',
      ]),
    );
    expect(
      result.profiles.every(
        (profile) =>
          profile.predominantMethod !== 'Unknown' &&
          profile.predominantSampleType !== 'Unknown' &&
          !profile.suggestedName.toLowerCase().includes('unknown') &&
          !profile.keyCharacteristics
            .join(' ')
            .toLowerCase()
            .includes('unknown'),
      ),
    ).toBe(true);
    expect(
      result.findings.some((finding) => finding.type === 'data_quality'),
    ).toBe(true);
  });
});
