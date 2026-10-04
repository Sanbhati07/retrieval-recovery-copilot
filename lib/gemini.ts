import { GoogleGenAI, Type } from "@google/genai";
import type { ParsedMemory } from "./types";

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini is not configured on this deployment.");
  return new GoogleGenAI({ apiKey });
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
  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: `You are a photo retrieval memory parser. Extract only what the user actually remembers. Do not turn guesses into facts. Mark uncertain clues with low certainty and explicit=false. Keep unknowns explicit. User memory:\n\n${memory}`,
    config: { responseMimeType: "application/json", responseSchema: memorySchema },
  });
  const parsed = JSON.parse(response.text ?? "{}");
  if (!parsed.memorySummary || !Array.isArray(parsed.clues) || !Array.isArray(parsed.unknownDimensions)) {
    throw new Error("Gemini returned an invalid memory structure.");
  }
  return parsed as ParsedMemory;
}

export async function embedText(text: string): Promise<number[]> {
  const ai = getAI();
  const response = await ai.models.embedContent({
    model: "gemini-embedding-2",
    contents: text,
    config: { outputDimensionality: 768 },
  });
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
