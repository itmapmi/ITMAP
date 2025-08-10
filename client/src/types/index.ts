export interface VendorWithScores {
  id: string;
  name: string;
  description?: string;
  website?: string;
  revenue?: string;
  marketId: string;
  scores: { [criteriaId: string]: number };
  executionScore: number;
  viabilityScore: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CriteriaWithWeights {
  id: string;
  name: string;
  description?: string;
  category: "execution" | "viability";
  weight?: number;
  createdAt: Date;
}

export interface NewsAnalysisData {
  id: string;
  title: string;
  content?: string;
  url?: string;
  source?: string;
  publishedAt?: Date;
  impactScore?: number;
  affectedCriteriaId?: string;
  scoreChange?: number;
  approved: boolean;
  vendorName: string;
  criteriaName?: string;
  createdAt: Date;
}

export interface MagicQuadrantPosition {
  x: number;
  y: number;
  vendor: {
    id: string;
    name: string;
    revenue?: string;
  };
}

export interface FeatureSupportData {
  featureId: string;
  featureName: string;
  vendors: {
    vendorId: string;
    vendorName: string;
    supportLevel: number;
    comments?: string;
  }[];
}
