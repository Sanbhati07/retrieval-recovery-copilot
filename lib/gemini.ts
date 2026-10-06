import { GoogleGenAI, Type } from "@google/genai";
import type { ParsedMemory } from "./types";

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini is not configured on this deployment.");
  return new GoogleGenAI({ apiKey });
}

const MAX_RUNTIME_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export class GeminiRuntimeError extends Error {
  httpStatus: number;

  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = "GeminiRuntimeError";
    this.httpStatus = httpStatus;
  }
}

function errorText(err: unknown): string {
  const e = err as any;

  const parts = [
    e?.message,
    e?.status,
    e?.code,
    e?.error?.message,
    e?.error?.status,
    e?.error?.code,
    e?.error?.details ? JSON.stringify(e.error.details) : "",
  ].filter(Boolean);

  return parts.join(" ").toLowerCase();
}

function isDailyQuotaError(err: unknown): boolean {
  const text = errorText(err);

  return (
    text.includes("requestsperday") ||
    text.includes("quota_exceeded") ||
    text.includes("quota exceeded") && (
      text.includes("per day") ||
      text.includes("daily")
    )
  );
}

function isTransientGeminiError(err: unknown): boolean {
  const text = errorText(err);

  return (
    text.includes("503") ||
    text.includes("service unavailable") ||
    text.includes("unavailable") ||
    text.includes("resource_exhausted") ||
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("timeout")
  );
}

function getBackoffMs(attempt: number): number {
  const jitter = Math.floor(Math.random() * 400);
  return RETRY_BASE_MS * Math.pow(2, attempt - 1) + jitter;
}

async function withGeminiRetry<T>(
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RUNTIME_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      if (isDailyQuotaError(err)) {
        throw new GeminiRuntimeError(
          "Gemini daily quota is temporarily exhausted. Please try again after the quota resets.",
          429
        );
      }

      if (!isTransientGeminiError(err) || attempt === MAX_RUNTIME_RETRIES) {
        break;
      }

      console.warn(
        `Gemini transient error; retrying (${attempt}/${MAX_RUNTIME_RETRIES})...`
      );

      await new Promise((resolve) =>
        setTimeout(resolve, getBackoffMs(attempt))
      );
    }
  }

  const text = errorText(lastError);

  if (
    text.includes("503") ||
    text.includes("service unavailable") ||
    text.includes("unavailable")
  ) {
    throw new GeminiRuntimeError(
      "Gemini is temporarily busy. Please try again in a few seconds.",
      503
    );
  }

  throw lastError;
}
const memorySchema = {
  type: Type.OBJECT,
  properties: {
    memorySummary: { type: Type.STRING },
    clues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          dimension: { type: Type.STRING, enum: ["people","objects","scenes","activities","appearance","location","time","ocrText","event"] },
          value: { type: Type.STRING },
          certainty: { type: Type.NUMBER },
          explicit: { type: Type.BOOLEAN },
        },
        required: ["dimension","value","certainty","explicit"],
      },
    },
    unknownDimensions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["memorySummary","clues","unknownDimensions"],
};

export async function parseMemory(memory: string): Promise<ParsedMemory> {
  const ai = getAI();
  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: `You are a photo retrieval memory parser. Extract only what the user actually remembers. Do not turn guesses into facts. Mark uncertain clues with low certainty and explicit=false. Keep unknowns explicit. User memory:\n\n${memory}`,
      config: { responseMimeType: "application/json", responseSchema: memorySchema },
    })
  );
  const parsed = JSON.parse(response.text ?? "{}");
  if (!parsed.memorySummary || !Array.isArray(parsed.clues) || !Array.isArray(parsed.unknownDimensions)) {
    throw new Error("Gemini returned an invalid memory structure.");
  }
  return parsed as ParsedMemory;
}

export async function embedText(text: string): Promise<number[]> {
  const ai = getAI();
  const response = await withGeminiRetry(() =>
    ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: text,
      config: { outputDimensionality: 768 },
    })
  );
  const values = response.embeddings?.[0]?.values;
  if (!values?.length) throw new Error("Gemini returned no text embedding.");
  return values;
}

export async function embedImageFiles(files: { bytes: Buffer; mimeType?: string }[]): Promise<number[][]> {
  if (!files.length || files.length > 6) throw new Error("Gemini Embedding 2 supports up to six images per request in this MVP.");
  const ai = getAI();
  const contents = files.map((f) => ({
    inlineData: { mimeType: f.mimeType ?? "image/jpeg", data: f.bytes.toString("base64") },
  }));
  const response = await ai.models.embedContent({
    model: "gemini-embedding-2",
    contents,
    config: { outputDimensionality: 768 },
  });
  const embeddings = response.embeddings?.map((e) => e.values).filter((v): v is number[] => !!v?.length) ?? [];
  if (embeddings.length !== files.length) throw new Error(`Gemini returned ${embeddings.length} embeddings for ${files.length} images.`);
  return embeddings;
}
