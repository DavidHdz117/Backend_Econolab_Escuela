export type ClusteringFindingType =
  | 'opportunity'
  | 'risk'
  | 'outlier'
  | 'data_quality'
  | 'observation';

/** Formato interno persistido; el nombre del perfil se resuelve al consultar. */
export type StoredClusteringFinding = {
  findingId: string;
  type: ClusteringFindingType;
  titleTemplate: string;
  descriptionTemplate: string;
  profileId?: number;
};

export type PublicClusteringFinding = {
  findingId: string;
  type: ClusteringFindingType;
  title: string;
  description: string;
  profileId?: number;
};
