import { BadRequestException, Injectable } from '@nestjs/common';

export type StudyClusteringRow = {
  studyId: number;
  code: string;
  name: string;
  price: number | null;
  deliveryHours: number | null;
  parameterCount: number | null;
  requestCount: number | null;
  sampleType: string | null;
  analysisMethod: string | null;
  requiresSpecialProcessing: boolean | null;
  isSynthetic?: boolean;
};

export type StudyClusteringOptions = {
  requestedK?: number;
  maxK?: number;
};

type CleanRow = {
  studyId: number;
  code: string;
  name: string;
  price: number;
  deliveryHours: number;
  parameterCount: number;
  requestCount: number;
  sampleType: string;
  analysisMethod: string;
  requiresSpecialProcessing: boolean;
  isSynthetic: boolean;
};

type FittedKMeans = {
  labels: number[];
  centroids: number[][];
  distances: number[];
  inertia: number;
  iterations: number;
};

type NumericKey = 'price' | 'deliveryHours' | 'parameterCount' | 'requestCount';

const NUMERIC_FEATURES: NumericKey[] = [
  'price',
  'deliveryHours',
  'parameterCount',
  'requestCount',
];
const MAX_CATEGORIES = 20;
const MAX_ITERATIONS = 100;
const EPSILON = 1e-6;

@Injectable()
export class StudyClusteringModel {
  analyze(rows: StudyClusteringRow[], options: StudyClusteringOptions = {}) {
    const prepared = this.prepareRows(rows);
    const cleanRows = prepared.rows;

    if (cleanRows.length < 10) {
      throw new BadRequestException(
        'Se necesitan al menos 10 estudios utilizables para ejecutar el clustering.',
      );
    }

    const encoded = this.encodeAndScale(cleanRows);
    const uniqueVectorCount = new Set(
      encoded.vectors.map((vector) =>
        vector.map((value) => value.toFixed(8)).join('|'),
      ),
    ).size;
    const maxK = Math.min(
      Math.max(options.maxK ?? 6, 2),
      6,
      cleanRows.length - 1,
      uniqueVectorCount,
    );

    if (maxK < 2) {
      throw new BadRequestException(
        'Los estudios no tienen suficiente variacion para formar clusters.',
      );
    }

    const pairwiseDistances = this.buildPairwiseDistances(encoded.vectors);
    const fittedByK = new Map<number, FittedKMeans>();
    const rawEvaluations: Array<{
      k: number;
      inertia: number;
      silhouette: number;
      iterations: number;
      minimumClusterSize: number;
      stableForAutomaticSelection: boolean;
    }> = [];
    const minimumStableClusterSize = Math.max(
      2,
      Math.ceil(cleanRows.length * 0.02),
    );

    for (let k = 2; k <= maxK; k += 1) {
      const fitted = this.fitBest(encoded.vectors, k);
      fittedByK.set(k, fitted);
      const clusterSizes = Array<number>(k).fill(0);
      fitted.labels.forEach((label) => (clusterSizes[label] += 1));
      const minimumClusterSize = Math.min(...clusterSizes);
      rawEvaluations.push({
        k,
        inertia: fitted.inertia,
        silhouette: this.silhouetteScore(
          fitted.labels,
          k,
          pairwiseDistances,
          cleanRows.length,
        ),
        iterations: fitted.iterations,
        minimumClusterSize,
        stableForAutomaticSelection:
          minimumClusterSize >= minimumStableClusterSize,
      });
    }

    const elbowK = this.findElbow(rawEvaluations);
    const stableEvaluations = rawEvaluations.filter(
      (evaluation) => evaluation.stableForAutomaticSelection,
    );
    const automaticK = [
      ...(stableEvaluations.length > 0 ? stableEvaluations : rawEvaluations),
    ].sort(
      (left, right) => right.silhouette - left.silhouette || left.k - right.k,
    )[0].k;
    const selectedK = options.requestedK ?? automaticK;

    if (!fittedByK.has(selectedK)) {
      throw new BadRequestException(
        `El numero de clusters debe estar entre 2 y ${maxK}.`,
      );
    }

    const selected = fittedByK.get(selectedK)!;
    const result = this.buildResult(cleanRows, selected);

    return {
      model: {
        algorithm: 'kmeans' as const,
        version: '1.0',
        selectedK,
        elbowK,
        selectionMethod: options.requestedK
          ? ('requested_by_user' as const)
          : ('highest_silhouette' as const),
        silhouetteScore: this.round(
          rawEvaluations.find((item) => item.k === selectedK)!.silhouette,
          4,
        ),
        inertia: this.round(selected.inertia, 2),
        trainingSamples: cleanRows.length,
        featureNames: encoded.featureNames,
        displayOnlyFields: ['studyId', 'code', 'name'],
      },
      evaluations: rawEvaluations.map((evaluation) => ({
        k: evaluation.k,
        inertia: this.round(evaluation.inertia, 2),
        silhouette: this.round(evaluation.silhouette, 4),
        iterations: evaluation.iterations,
        minimumClusterSize: evaluation.minimumClusterSize,
        stableForAutomaticSelection: evaluation.stableForAutomaticSelection,
        isElbow: evaluation.k === elbowK,
        isSelected: evaluation.k === selectedK,
      })),
      profiles: result.profiles,
      studies: result.studies,
      dataQuality: {
        receivedRows: rows.length,
        usableRows: cleanRows.length,
        excludedRows: rows.length - prepared.uniqueRows,
        duplicateRows: prepared.duplicateRows,
        imputedValues: prepared.imputedValues,
        winsorizedValues: encoded.winsorizedValues,
        winsorizationPercentiles: encoded.winsorizationPercentiles,
        ignoredConstantFeatures: encoded.ignoredConstantFeatures,
      },
      warnings: [
        ...prepared.warnings,
        ...(Object.values(encoded.winsorizedValues).some((count) => count > 0)
          ? [
              `Los extremos numericos se limitaron a los percentiles ${encoded.winsorizationPercentiles.lower} y ${encoded.winsorizationPercentiles.upper} solo para evitar que dominaran K-Means; los valores originales se conservan en los resultados.`,
            ]
          : []),
        ...(rawEvaluations.some(
          (evaluation) => !evaluation.stableForAutomaticSelection,
        )
          ? [
              `La seleccion automatica descarto valores de k con grupos menores a ${minimumStableClusterSize} estudios para evitar clusters formados por casos aislados.`,
            ]
          : []),
      ],
    };
  }

  private prepareRows(rows: StudyClusteringRow[]) {
    const unique = new Map<number, StudyClusteringRow>();
    let duplicateRows = 0;

    for (const row of [...rows].sort((a, b) => a.studyId - b.studyId)) {
      if (!Number.isInteger(row.studyId) || row.studyId <= 0) continue;
      if (unique.has(row.studyId)) {
        duplicateRows += 1;
        continue;
      }
      unique.set(row.studyId, row);
    }

    const uniqueRows = [...unique.values()];
    const medians: Record<NumericKey, number> = {
      price: this.median(
        uniqueRows
          .map((row) => row.price)
          .filter((value): value is number => this.isPositiveNumber(value)),
      ),
      deliveryHours: this.median(
        uniqueRows
          .map((row) => row.deliveryHours)
          .filter((value): value is number => this.isPositiveNumber(value)),
      ),
      parameterCount: this.median(
        uniqueRows
          .map((row) => row.parameterCount)
          .filter((value): value is number => this.isNonNegativeNumber(value)),
      ),
      requestCount: this.median(
        uniqueRows
          .map((row) => row.requestCount)
          .filter((value): value is number => this.isNonNegativeNumber(value)),
      ),
    };
    const imputedValues: Record<
      NumericKey | 'requiresSpecialProcessing',
      number
    > = {
      price: 0,
      deliveryHours: 0,
      parameterCount: 0,
      requestCount: 0,
      requiresSpecialProcessing: 0,
    };
    const knownSpecialProcessing = uniqueRows
      .map((row) => row.requiresSpecialProcessing)
      .filter((value): value is boolean => typeof value === 'boolean');
    const trueCount = knownSpecialProcessing.filter(Boolean).length;
    const specialProcessingMode =
      trueCount > knownSpecialProcessing.length - trueCount;

    const cleanRows = uniqueRows.map<CleanRow>((row) => {
      const getNumber = (key: NumericKey, positiveOnly = false) => {
        const value = row[key];
        const valid = positiveOnly
          ? this.isPositiveNumber(value)
          : this.isNonNegativeNumber(value);
        if (!valid) {
          imputedValues[key] += 1;
          return medians[key];
        }
        return Number(value);
      };
      let requiresSpecialProcessing = row.requiresSpecialProcessing;
      if (typeof requiresSpecialProcessing !== 'boolean') {
        imputedValues.requiresSpecialProcessing += 1;
        requiresSpecialProcessing = specialProcessingMode;
      }

      return {
        studyId: row.studyId,
        code: row.code?.trim() || `ESTUDIO-${row.studyId}`,
        name: row.name?.trim() || 'Estudio sin nombre',
        price: getNumber('price', true),
        deliveryHours: getNumber('deliveryHours', true),
        parameterCount: Math.round(getNumber('parameterCount')),
        requestCount: Math.round(getNumber('requestCount')),
        sampleType: this.normalizeCategory(row.sampleType),
        analysisMethod: this.normalizeCategory(row.analysisMethod),
        requiresSpecialProcessing,
        isSynthetic: row.isSynthetic === true,
      };
    });

    const warnings: string[] = [];
    if (NUMERIC_FEATURES.some((key) => imputedValues[key] > 0)) {
      warnings.push(
        'Los valores numericos faltantes o incorrectos se imputaron con la mediana.',
      );
    }
    if (imputedValues.requiresSpecialProcessing > 0) {
      warnings.push(
        'Los valores desconocidos de procesamiento especial se imputaron con la moda.',
      );
    }
    if (cleanRows.some((row) => row.isSynthetic)) {
      warnings.push(
        'El analisis incluye registros sinteticos MLTRAIN identificados como datos de entrenamiento.',
      );
    }

    return {
      rows: cleanRows,
      uniqueRows: uniqueRows.length,
      duplicateRows,
      imputedValues,
      warnings,
    };
  }

  private encodeAndScale(rows: CleanRow[]) {
    const ignoredConstantFeatures: string[] = [];
    const means = new Map<NumericKey, number>();
    const deviations = new Map<NumericKey, number>();
    const lowerBounds = new Map<NumericKey, number>();
    const upperBounds = new Map<NumericKey, number>();
    const tailQuantile = rows.length < 100 ? 0.05 : 0.01;
    const winsorizationPercentiles = {
      lower: tailQuantile * 100,
      upper: (1 - tailQuantile) * 100,
    };
    const winsorizedValues: Record<NumericKey, number> = {
      price: 0,
      deliveryHours: 0,
      parameterCount: 0,
      requestCount: 0,
    };

    const modelValue = (row: CleanRow, key: NumericKey) =>
      Math.min(
        upperBounds.get(key)!,
        Math.max(lowerBounds.get(key)!, row[key]),
      );

    for (const key of NUMERIC_FEATURES) {
      const sortedValues = rows
        .map((row) => row[key])
        .sort((left, right) => left - right);
      const lowerBound = this.quantile(sortedValues, tailQuantile);
      const upperBound = this.quantile(sortedValues, 1 - tailQuantile);
      lowerBounds.set(key, lowerBound);
      upperBounds.set(key, upperBound);
      winsorizedValues[key] = sortedValues.filter(
        (value) => value < lowerBound || value > upperBound,
      ).length;
      const values = rows.map((row) => modelValue(row, key));
      const mean =
        values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance =
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        values.length;
      const deviation = Math.sqrt(variance);
      means.set(key, mean);
      deviations.set(key, deviation || 1);
    }

    const sampleConfig = this.categoryConfig(rows.map((row) => row.sampleType));
    const methodConfig = this.categoryConfig(
      rows.map((row) => row.analysisMethod),
    );
    const allFeatureNames = [
      'price',
      'delivery_hours',
      'parameter_count',
      'request_count',
      ...sampleConfig.categories.map((value) => `sample_type=${value}`),
      ...methodConfig.categories.map((value) => `analysis_method=${value}`),
      'requires_special_processing',
    ];

    const allVectors = rows.map((row) => {
      const sample = sampleConfig.map(row.sampleType);
      const method = methodConfig.map(row.analysisMethod);
      return [
        ...NUMERIC_FEATURES.map(
          (key) =>
            (modelValue(row, key) - means.get(key)!) / deviations.get(key)!,
        ),
        ...sampleConfig.categories.map((category) =>
          sample === category ? 1 : 0,
        ),
        ...methodConfig.categories.map((category) =>
          method === category ? 1 : 0,
        ),
        row.requiresSpecialProcessing ? 1 : 0,
      ];
    });
    const variableColumnIndexes = allFeatureNames
      .map((featureName, index) => {
        const firstValue = allVectors[0][index];
        const isConstant = allVectors.every(
          (vector) => Math.abs(vector[index] - firstValue) < EPSILON,
        );
        if (isConstant) ignoredConstantFeatures.push(featureName);
        return isConstant ? -1 : index;
      })
      .filter((index) => index >= 0);
    const featureNames = variableColumnIndexes.map(
      (index) => allFeatureNames[index],
    );
    const vectors = allVectors.map((vector) =>
      variableColumnIndexes.map((index) => vector[index]),
    );

    return {
      vectors,
      featureNames,
      ignoredConstantFeatures,
      winsorizedValues,
      winsorizationPercentiles,
    };
  }

  private categoryConfig(values: string[]) {
    const frequencies = new Map<string, number>();
    for (const value of values) {
      frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
    }
    const ordered = [...frequencies.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    );
    const minimumFrequency = Math.max(2, Math.ceil(values.length * 0.01));
    const kept = ordered
      .filter(([, count]) => count >= minimumFrequency)
      .slice(0, MAX_CATEGORIES - 1)
      .map(([value]) => value);
    const hasOther = ordered.length > kept.length;
    const categories = [...kept, ...(hasOther ? ['otros'] : [])].sort();
    return {
      categories,
      map: (value: string) => (kept.includes(value) ? value : 'otros'),
    };
  }

  private fitBest(points: number[][], k: number) {
    let best: FittedKMeans | null = null;
    for (let start = 0; start < 3; start += 1) {
      const candidate = this.fit(points, k, start);
      if (!best || candidate.inertia < best.inertia) best = candidate;
    }
    return best!;
  }

  private fit(points: number[][], k: number, start: number): FittedKMeans {
    let centroids = this.initializeCentroids(points, k, start);
    let labels = Array<number>(points.length).fill(-1);
    let iterations = 0;

    for (iterations = 1; iterations <= MAX_ITERATIONS; iterations += 1) {
      const nextLabels = points.map((point) =>
        this.nearestCentroid(point, centroids),
      );
      this.fillEmptyClusters(points, nextLabels, centroids, k);
      const nextCentroids = this.recalculateCentroids(points, nextLabels, k);
      const labelsChanged = nextLabels.some(
        (label, index) => label !== labels[index],
      );
      const movement = centroids.reduce(
        (sum, centroid, index) =>
          sum + this.squaredDistance(centroid, nextCentroids[index]),
        0,
      );
      labels = nextLabels;
      centroids = nextCentroids;
      if (!labelsChanged || movement < EPSILON) break;
    }

    const distances = points.map((point, index) =>
      Math.sqrt(this.squaredDistance(point, centroids[labels[index]])),
    );
    const inertia = distances.reduce((sum, distance) => sum + distance ** 2, 0);
    return { labels, centroids, distances, inertia, iterations };
  }

  private initializeCentroids(points: number[][], k: number, start: number) {
    const mean = Array<number>(points[0].length).fill(0);
    for (const point of points) {
      point.forEach((value, index) => (mean[index] += value / points.length));
    }
    const ordered = points
      .map((point, index) => ({
        index,
        distance: this.squaredDistance(point, mean),
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance || left.index - right.index,
      );
    const firstPositions = [
      0,
      ordered.length - 1,
      Math.floor(ordered.length / 2),
    ];
    const selected = [
      ordered[firstPositions[start % firstPositions.length]].index,
    ];

    while (selected.length < k) {
      let bestIndex = -1;
      let bestDistance = -1;
      for (let index = 0; index < points.length; index += 1) {
        if (selected.includes(index)) continue;
        const distance = Math.min(
          ...selected.map((selectedIndex) =>
            this.squaredDistance(points[index], points[selectedIndex]),
          ),
        );
        if (distance > bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      selected.push(bestIndex);
    }

    return selected.map((index) => [...points[index]]);
  }

  private fillEmptyClusters(
    points: number[][],
    labels: number[],
    centroids: number[][],
    k: number,
  ) {
    const counts = Array<number>(k).fill(0);
    labels.forEach((label) => (counts[label] += 1));
    for (let empty = 0; empty < k; empty += 1) {
      if (counts[empty] > 0) continue;
      let candidate = -1;
      let farthest = -1;
      for (let index = 0; index < points.length; index += 1) {
        if (counts[labels[index]] <= 1) continue;
        const distance = this.squaredDistance(
          points[index],
          centroids[labels[index]],
        );
        if (distance > farthest) {
          farthest = distance;
          candidate = index;
        }
      }
      if (candidate < 0) {
        throw new BadRequestException(
          'No fue posible recuperar un cluster vacio.',
        );
      }
      counts[labels[candidate]] -= 1;
      labels[candidate] = empty;
      counts[empty] += 1;
    }
  }

  private recalculateCentroids(
    points: number[][],
    labels: number[],
    k: number,
  ) {
    const centroids = Array.from({ length: k }, () =>
      Array<number>(points[0].length).fill(0),
    );
    const counts = Array<number>(k).fill(0);
    for (let row = 0; row < points.length; row += 1) {
      counts[labels[row]] += 1;
      points[row].forEach(
        (value, column) => (centroids[labels[row]][column] += value),
      );
    }
    return centroids.map((centroid, cluster) =>
      centroid.map((value) => value / counts[cluster]),
    );
  }

  private nearestCentroid(point: number[], centroids: number[][]) {
    let selected = 0;
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 0; index < centroids.length; index += 1) {
      const distance = this.squaredDistance(point, centroids[index]);
      if (distance < minimum) {
        minimum = distance;
        selected = index;
      }
    }
    return selected;
  }

  private buildPairwiseDistances(points: number[][]) {
    const size = points.length;
    const matrix = new Float64Array(size * size);
    for (let left = 0; left < size; left += 1) {
      for (let right = left + 1; right < size; right += 1) {
        const distance = Math.sqrt(
          this.squaredDistance(points[left], points[right]),
        );
        matrix[left * size + right] = distance;
        matrix[right * size + left] = distance;
      }
    }
    return matrix;
  }

  private silhouetteScore(
    labels: number[],
    k: number,
    distances: Float64Array,
    size: number,
  ) {
    const clusters = Array.from({ length: k }, (): number[] => []);
    labels.forEach((label, index) => clusters[label].push(index));
    let total = 0;

    for (let index = 0; index < size; index += 1) {
      const own = clusters[labels[index]];
      if (own.length <= 1) continue;
      const a =
        own.reduce(
          (sum, other) =>
            sum + (other === index ? 0 : distances[index * size + other]),
          0,
        ) /
        (own.length - 1);
      let b = Number.POSITIVE_INFINITY;
      for (let cluster = 0; cluster < k; cluster += 1) {
        if (cluster === labels[index] || clusters[cluster].length === 0)
          continue;
        const average =
          clusters[cluster].reduce(
            (sum, other) => sum + distances[index * size + other],
            0,
          ) / clusters[cluster].length;
        b = Math.min(b, average);
      }
      total += Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b);
    }

    return total / size;
  }

  private findElbow(evaluations: Array<{ k: number; inertia: number }>) {
    if (evaluations.length <= 2) return evaluations[0].k;
    const first = evaluations[0];
    const last = evaluations[evaluations.length - 1];
    const dx = last.k - first.k;
    const dy = last.inertia - first.inertia;
    const denominator = Math.sqrt(dx ** 2 + dy ** 2) || 1;
    return [...evaluations]
      .slice(1, -1)
      .map((point) => ({
        k: point.k,
        distance:
          Math.abs(
            dy * point.k -
              dx * point.inertia +
              last.k * first.inertia -
              last.inertia * first.k,
          ) / denominator,
      }))
      .sort(
        (left, right) => right.distance - left.distance || left.k - right.k,
      )[0].k;
  }

  private buildResult(rows: CleanRow[], fitted: FittedKMeans) {
    const rawClusters = Array.from(
      { length: fitted.centroids.length },
      (_, cluster) =>
        rows
          .map((_, index) => index)
          .filter((index) => fitted.labels[index] === cluster),
    );
    const globalAverages = this.averages(rows);
    const orderedClusters = rawClusters
      .map((indices, rawCluster) => ({
        rawCluster,
        indices,
        averages: this.averages(indices.map((index) => rows[index])),
      }))
      .sort(
        (left, right) =>
          left.averages.price - right.averages.price ||
          left.averages.deliveryHours - right.averages.deliveryHours,
      );
    const clusterIdMap = new Map(
      orderedClusters.map((cluster, index) => [cluster.rawCluster, index + 1]),
    );
    const thresholds = new Map<number, number>();

    for (const cluster of orderedClusters) {
      const distances = cluster.indices
        .map((index) => fitted.distances[index])
        .sort((a, b) => a - b);
      let threshold = Number.POSITIVE_INFINITY;
      if (distances.length >= 5) {
        const q1 = this.quantile(distances, 0.25);
        const q3 = this.quantile(distances, 0.75);
        const iqr = q3 - q1;
        if (iqr > 0) {
          threshold = q3 + 1.5 * iqr;
        } else {
          const mean =
            distances.reduce((sum, value) => sum + value, 0) / distances.length;
          const deviation = Math.sqrt(
            distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
              distances.length,
          );
          threshold = mean + 2 * deviation;
        }
      }
      thresholds.set(cluster.rawCluster, threshold);
    }

    const studies = rows.map((row, index) => {
      const rawCluster = fitted.labels[index];
      const threshold = thresholds.get(rawCluster)!;
      const distance = fitted.distances[index];
      return {
        studyId: row.studyId,
        code: row.code,
        name: row.name,
        cluster: clusterIdMap.get(rawCluster)!,
        distanceToCentroid: this.round(distance, 4),
        outlierScore:
          Number.isFinite(threshold) && threshold > 0
            ? this.round(distance / threshold, 3)
            : 0,
        isOutlier: Number.isFinite(threshold) && distance > threshold,
        isSynthetic: row.isSynthetic,
        values: {
          price: row.price,
          deliveryHours: row.deliveryHours,
          parameterCount: row.parameterCount,
          requestCount: row.requestCount,
          sampleType: row.sampleType,
          analysisMethod: row.analysisMethod,
          requiresSpecialProcessing: row.requiresSpecialProcessing,
        },
      };
    });

    const profiles = orderedClusters.map((cluster, index) => {
      const clusterNumber = index + 1;
      const clusterRows = cluster.indices.map((rowIndex) => rows[rowIndex]);
      const clusterStudies = studies.filter(
        (study) => study.cluster === clusterNumber,
      );
      const traits = this.traits(cluster.averages, globalAverages, clusterRows);
      return {
        cluster: clusterNumber,
        label: `Grupo ${clusterNumber} · ${traits.slice(0, 2).join(' y ') || 'operacion estandar'}`,
        studyCount: clusterRows.length,
        percentage: this.round((clusterRows.length / rows.length) * 100, 1),
        outlierCount: clusterStudies.filter((study) => study.isOutlier).length,
        outlierThreshold: Number.isFinite(thresholds.get(cluster.rawCluster)!)
          ? this.round(thresholds.get(cluster.rawCluster)!, 4)
          : null,
        averages: this.roundAverages(cluster.averages),
        specialProcessingPercentage: this.round(
          (clusterRows.filter((row) => row.requiresSpecialProcessing).length /
            clusterRows.length) *
            100,
          1,
        ),
        sampleTypes: this.categorySummary(
          clusterRows.map((row) => row.sampleType),
        ),
        analysisMethods: this.categorySummary(
          clusterRows.map((row) => row.analysisMethod),
        ),
        traits,
      };
    });

    return { profiles, studies };
  }

  private averages(rows: CleanRow[]) {
    const average = (key: NumericKey) =>
      rows.reduce((sum, row) => sum + row[key], 0) / Math.max(rows.length, 1);
    return {
      price: average('price'),
      deliveryHours: average('deliveryHours'),
      parameterCount: average('parameterCount'),
      requestCount: average('requestCount'),
    };
  }

  private traits(
    cluster: ReturnType<StudyClusteringModel['averages']>,
    global: ReturnType<StudyClusteringModel['averages']>,
    rows: CleanRow[],
  ) {
    const traits: string[] = [];
    if (global.price > 0 && cluster.price <= global.price * 0.85)
      traits.push('precio bajo');
    if (global.price > 0 && cluster.price >= global.price * 1.15)
      traits.push('precio alto');
    if (
      global.requestCount > 0 &&
      cluster.requestCount >= global.requestCount * 1.15
    )
      traits.push('demanda alta');
    if (
      global.requestCount > 0 &&
      cluster.requestCount <= global.requestCount * 0.85
    )
      traits.push('demanda baja');
    if (
      global.deliveryHours > 0 &&
      cluster.deliveryHours >= global.deliveryHours * 1.15
    )
      traits.push('entrega prolongada');
    if (
      global.deliveryHours > 0 &&
      cluster.deliveryHours <= global.deliveryHours * 0.85
    )
      traits.push('entrega rapida');
    if (
      global.parameterCount > 0 &&
      cluster.parameterCount >= global.parameterCount * 1.15
    )
      traits.push('multiparametro');
    if (
      rows.filter((row) => row.requiresSpecialProcessing).length /
        rows.length >=
      0.5
    ) {
      traits.push('procesamiento especial frecuente');
    }
    return traits;
  }

  private categorySummary(values: string[]) {
    const frequencies = new Map<string, number>();
    values.forEach((value) =>
      frequencies.set(value, (frequencies.get(value) ?? 0) + 1),
    );
    return [...frequencies.entries()]
      .sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )
      .slice(0, 5)
      .map(([value, count]) => ({
        value,
        count,
        percentage: this.round((count / values.length) * 100, 1),
      }));
  }

  private roundAverages(values: ReturnType<StudyClusteringModel['averages']>) {
    return {
      price: this.round(values.price, 2),
      deliveryHours: this.round(values.deliveryHours, 2),
      parameterCount: this.round(values.parameterCount, 2),
      requestCount: this.round(values.requestCount, 2),
    };
  }

  private normalizeCategory(value: string | null) {
    const normalized = (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    return normalized || 'sin_especificar';
  }

  private squaredDistance(left: number[], right: number[]) {
    return left.reduce(
      (sum, value, index) => sum + (value - right[index]) ** 2,
      0,
    );
  }

  private median(values: number[]) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  private quantile(sortedValues: number[], value: number) {
    const position = (sortedValues.length - 1) * value;
    const lower = Math.floor(position);
    const fraction = position - lower;
    return sortedValues[lower + 1] === undefined
      ? sortedValues[lower]
      : sortedValues[lower] +
          fraction * (sortedValues[lower + 1] - sortedValues[lower]);
  }

  private isPositiveNumber(value: number | null): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  private isNonNegativeNumber(value: number | null): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  private round(value: number, decimals: number) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }
}
