export type MemoryDimension =
  | "people" | "objects" | "scenes" | "activities" | "appearance"
  | "location" | "time" | "ocrText" | "event";

export type MemoryClue = {
  dimension: MemoryDimension;
  value: string;
  certainty: number;
  explicit: boolean;
};

export type ParsedMemory = {
  memorySummary: string;
  clues: MemoryClue[];
  unknownDimensions: string[];
};

export type RetrievalMetadata = {
  people?: string[];
  objects?: string[];
  scenes?: string[];
  activities?: string[];
  appearance?: string[];
  location?: { city?: string; state?: string; country?: string };
  time?: string[];
  ocrText?: string[];
  event?: string[];
  description?: string;
  queryTerms?: string[];
};

export type Photo = {
  id: string;
  image: string;
  title: string | null;
  creator: string | null;
  creatorUrl: string | null;
  license: string;
  licenseVersion: string | null;
  licenseUrl: string;
  attribution: string | null;
  provider: string | null;
  source: string | null;
  sourceUrl: string | null;
  tags: string[];
  retrievalMetadata: RetrievalMetadata;
};

export type Candidate = Photo & {
  semanticScore: number;
  structuredScore: number;
  finalScore: number;
};
