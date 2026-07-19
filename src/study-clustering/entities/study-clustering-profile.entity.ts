import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { StudyClusteringAssignment } from './study-clustering-assignment.entity';
import { StudyClusteringRun } from './study-clustering-run.entity';

@Entity({ name: 'study_clustering_profiles', schema: 'operativo' })
@Unique('uq_study_clustering_profiles_run_cluster', ['runId', 'clusterNumber'])
@Unique('uq_study_clustering_profiles_run_display_name', [
  'runId',
  'displayNameKey',
])
@Index('idx_study_clustering_profiles_run', ['runId'])
export class StudyClusteringProfile {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => StudyClusteringRun, (run) => run.profiles, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'run_id' })
  run: StudyClusteringRun;

  @Column({ name: 'run_id' })
  runId: number;

  @Column({ type: 'int', name: 'cluster_number' })
  clusterNumber: number;

  @Column({ length: 150, name: 'suggested_name' })
  suggestedName: string;

  @Column({ length: 150, name: 'display_name' })
  displayName: string;

  @Column({ length: 150, name: 'display_name_key' })
  displayNameKey: string;

  @Column({ type: 'text', name: 'short_description' })
  shortDescription: string;

  @Column({
    type: 'jsonb',
    name: 'key_characteristics',
    default: () => "'[]'::jsonb",
  })
  keyCharacteristics: string[];

  @Column({ type: 'int', name: 'study_count' })
  studyCount: number;

  @Column({ type: 'double precision' })
  percentage: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  averages: Record<string, number>;

  @Column({
    type: 'varchar',
    length: 150,
    name: 'predominant_method',
    nullable: true,
  })
  predominantMethod?: string | null;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'predominant_sample_type',
    nullable: true,
  })
  predominantSampleType?: string | null;

  @Column({ type: 'double precision', name: 'special_processing_percentage' })
  specialProcessingPercentage: number;

  @Column({ type: 'int', name: 'outlier_count' })
  outlierCount: number;

  @Column({
    type: 'double precision',
    name: 'outlier_threshold',
    nullable: true,
  })
  outlierThreshold?: number | null;

  @Column({
    type: 'jsonb',
    name: 'technical_details',
    default: () => "'{}'::jsonb",
  })
  technicalDetails: Record<string, unknown>;

  @OneToMany(
    () => StudyClusteringAssignment,
    (assignment) => assignment.profile,
  )
  assignments: StudyClusteringAssignment[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
