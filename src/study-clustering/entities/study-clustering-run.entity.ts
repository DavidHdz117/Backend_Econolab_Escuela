import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StudyClusteringAssignment } from './study-clustering-assignment.entity';
import { StudyClusteringProfile } from './study-clustering-profile.entity';

export enum StudyClusteringRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity({ name: 'study_clustering_runs', schema: 'operativo' })
@Index('idx_study_clustering_runs_executed_at', ['executedAt'])
@Index('idx_study_clustering_runs_status_latest', ['status', 'executedAt'])
export class StudyClusteringRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'timestamptz', name: 'executed_at' })
  executedAt: Date;

  @Column({
    length: 20,
    default: StudyClusteringRunStatus.RUNNING,
  })
  status: StudyClusteringRunStatus;

  @Column({ type: 'timestamptz', name: 'period_start' })
  periodStart: Date;

  @Column({ type: 'timestamptz', name: 'period_end' })
  periodEnd: Date;

  @Column({ type: 'int', name: 'period_months' })
  periodMonths: number;

  @Column({ name: 'include_synthetic', default: false })
  includeSynthetic: boolean;

  @Column({ type: 'int', name: 'requested_k', nullable: true })
  requestedK?: number | null;

  @Column({ type: 'int', name: 'max_k' })
  maxK: number;

  @Column({ type: 'int', name: 'selected_k', nullable: true })
  selectedK?: number | null;

  @Column({ type: 'int', name: 'elbow_k', nullable: true })
  elbowK?: number | null;

  @Column({
    type: 'varchar',
    length: 50,
    name: 'selection_method',
    nullable: true,
  })
  selectionMethod?: string | null;

  @Column({
    type: 'double precision',
    name: 'silhouette_score',
    nullable: true,
  })
  silhouetteScore?: number | null;

  @Column({ type: 'double precision', nullable: true })
  inertia?: number | null;

  @Column({ type: 'int', name: 'total_studies' })
  totalStudies: number;

  @Column({ type: 'int', name: 'profile_count' })
  profileCount: number;

  @Column({ type: 'int', name: 'outlier_count' })
  outlierCount: number;

  @Column({ length: 50, default: 'kmeans' })
  algorithm: string;

  @Column({ length: 30, name: 'model_version' })
  modelVersion: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  evaluations: Array<Record<string, unknown>>;

  @Column({
    type: 'jsonb',
    name: 'feature_names',
    default: () => "'[]'::jsonb",
  })
  featureNames: string[];

  @Column({
    type: 'jsonb',
    name: 'excluded_features',
    default: () => "'[]'::jsonb",
  })
  excludedFeatures: string[];

  @Column({ type: 'jsonb', name: 'data_quality', default: () => "'{}'::jsonb" })
  dataQuality: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  warnings: string[];

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  sources: Record<string, string>;

  @Column({
    type: 'jsonb',
    name: 'interpretation_thresholds',
    default: () => "'{}'::jsonb",
  })
  interpretationThresholds: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  findings: Array<Record<string, unknown>>;

  @Column({ type: 'text', name: 'failure_message', nullable: true })
  failureMessage?: string | null;

  @OneToMany(() => StudyClusteringProfile, (profile) => profile.run)
  profiles: StudyClusteringProfile[];

  @OneToMany(() => StudyClusteringAssignment, (assignment) => assignment.run)
  assignments: StudyClusteringAssignment[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
