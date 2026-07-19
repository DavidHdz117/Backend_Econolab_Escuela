import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { StudyClusteringProfile } from './study-clustering-profile.entity';
import { StudyClusteringRun } from './study-clustering-run.entity';

@Entity({ name: 'study_clustering_assignments', schema: 'operativo' })
@Unique('uq_study_clustering_assignments_run_study', ['runId', 'studyId'])
@Index('idx_study_clustering_assignments_run', ['runId'])
@Index('idx_study_clustering_assignments_profile', ['profileId'])
export class StudyClusteringAssignment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => StudyClusteringRun, (run) => run.assignments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'run_id' })
  run: StudyClusteringRun;

  @Column({ name: 'run_id' })
  runId: number;

  @ManyToOne(() => StudyClusteringProfile, (profile) => profile.assignments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'profile_id' })
  profile: StudyClusteringProfile;

  @Column({ name: 'profile_id' })
  profileId: number;

  // No se declara FK al catalogo: los snapshots deben sobrevivir a una baja dura.
  @Column({ name: 'study_id' })
  studyId: number;

  @Column({ length: 50, name: 'study_code_snapshot' })
  studyCodeSnapshot: string;

  @Column({ length: 200, name: 'study_name_snapshot' })
  studyNameSnapshot: string;

  @Column({ type: 'double precision', name: 'distance_to_centroid' })
  distanceToCentroid: number;

  @Column({ type: 'double precision', name: 'outlier_score' })
  outlierScore: number;

  @Column({ name: 'is_outlier', default: false })
  isOutlier: boolean;

  @Column({ name: 'is_synthetic', default: false })
  isSynthetic: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  values: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
