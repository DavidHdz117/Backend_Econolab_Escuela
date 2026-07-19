import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Like, Repository } from 'typeorm';
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
import { QueryStudyClusteringDto } from './dto/query-study-clustering.dto';
import { StudyRequestMetric } from './entities/study-request-metric.entity';
import { StudyClusteringModel } from './models/study-clustering.model';

type RequestCountRow = { studyId: string; requestCount: string };
@Injectable()
export class StudyClusteringService {
  constructor(
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
    @InjectRepository(StudyDetail)
    private readonly detailRepo: Repository<StudyDetail>,
    @InjectRepository(ServiceOrderItem)
    private readonly serviceOrderItemRepo: Repository<ServiceOrderItem>,
    @InjectRepository(StudyRequestMetric)
    private readonly requestMetricRepo: Repository<StudyRequestMetric>,
    private readonly clusteringModel: StudyClusteringModel,
  ) {}

  async analyze(query: QueryStudyClusteringDto) {
    const periodMonths = query.periodMonths ?? 6;
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd);
    periodStart.setUTCMonth(periodStart.getUTCMonth() - (periodMonths - 1));
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);
    const periodStartDate = periodStart.toISOString().slice(0, 10);
    const periodEndDate = periodEnd.toISOString().slice(0, 10);

    const where = [
      {
        isActive: true,
        status: StudyStatus.ACTIVE,
        type: StudyType.STUDY,
      },
      ...(query.includeSynthetic
        ? [
            {
              code: Like('MLTRAIN-%'),
              indicator: 'DATOS SINTETICOS',
              type: StudyType.STUDY,
            },
          ]
        : []),
    ];
    const studies = await this.studyRepo.find({ where });
    const studyIds = studies.map((study) => study.id);

    const parameterCounts = await this.loadParameterCounts(studyIds);
    const actualRequestCounts = await this.loadActualRequestCounts(
      periodStart,
      periodEnd,
    );
    const syntheticRequestCounts = await this.loadSyntheticRequestCounts(
      studyIds,
      periodStartDate,
      periodEndDate,
    );

    const dataset = studies.map((study) => {
      const isSynthetic =
        study.code.startsWith('MLTRAIN-') &&
        study.indicator === 'DATOS SINTETICOS';
      const parameterCount = parameterCounts.get(study.id) ?? null;
      const requestCount = isSynthetic
        ? (syntheticRequestCounts.get(study.id) ?? 0)
        : (actualRequestCounts.get(study.id) ?? 0);

      return {
        studyId: study.id,
        code: study.code,
        name: study.name,
        price: Number(study.normalPrice),
        deliveryHours: Number(study.durationMinutes) / 60,
        parameterCount,
        requestCount,
        sampleType: study.sampleType ?? StudySampleType.UNKNOWN,
        analysisMethod: study.method ?? null,
        requiresSpecialProcessing: study.requiresSpecialProcessing ?? null,
        isSynthetic,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      period: {
        months: periodMonths,
        from: periodStart.toISOString(),
        to: periodEnd.toISOString(),
      },
      sources: {
        price: 'operativo.studies.normalPrice',
        deliveryHours: 'operativo.studies.durationMinutes / 60',
        parameterCount: 'operativo.study_details',
        requestCount:
          'operativo.service_order_items + operativo.service_orders; study_request_metrics para datos sinteticos',
        sampleType: 'operativo.studies.sampleType',
        analysisMethod: 'operativo.studies.method',
        requiresSpecialProcessing:
          'operativo.studies.requiresSpecialProcessing',
      },
      ...this.clusteringModel.analyze(dataset, {
        requestedK: query.requestedK,
        maxK: query.maxK,
      }),
    };
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

  private async loadSyntheticRequestCounts(
    studyIds: number[],
    periodStartDate: string,
    periodEndDate: string,
  ) {
    const counts = new Map<number, number>();
    if (studyIds.length === 0) return counts;
    const metrics = await this.requestMetricRepo.find({
      where: {
        studyId: In(studyIds),
        periodMonth: Between(periodStartDate, periodEndDate),
        isSynthetic: true,
      },
    });
    metrics.forEach((metric) =>
      counts.set(
        metric.studyId,
        (counts.get(metric.studyId) ?? 0) + metric.requestCount,
      ),
    );
    return counts;
  }
}
