// Reads watch photos with Gemini (image input + JSON output) and checks the
// answer in code. Docs: https://ai.google.dev/gemini-api/docs/image-understanding
//                       https://ai.google.dev/gemini-api/docs/structured-output
// The model only transcribes what it can see. Code decides the category,
// hashes the serial and looks up the price.

import { GoogleGenAI, type Part } from "@google/genai";
import type { WatchCategory } from "../calc/watch";

export type PhotoInput = { mimeType: string; dataBase64: string };

const CASE_MATERIALS = ["steel", "gold", "two_tone", "titanium", "platinum", "other"] as const;
const STYLES = ["sport", "dress", "other"] as const;
const MAX_TEXT = 80; // longer "transcriptions" are not something printed on a watch

export type WatchReading = {
  maker: string | null;
  model: string | null;
  reference: string | null;
  serial: string | null; // raw: the caller moves it to the PII store at once
  caseMaterial: (typeof CASE_MATERIALS)[number] | null;
  style: (typeof STYLES)[number] | null;
  boxVisible: boolean;
  papersVisible: boolean;
  notes: string | null;
};

function nullable(schema: Record<string, unknown>, description: string) {
  return { anyOf: [schema, { type: "null" }], description };
}

/** The JSON shape Gemini must answer in (responseJsonSchema). */
export const WATCH_READING_SCHEMA = {
  type: "object",
  properties: {
    maker: nullable({ type: "string" }, "Brand or maker name exactly as printed, or null."),
    model: nullable({ type: "string" }, "Model name exactly as printed, or null."),
    reference: nullable({ type: "string" }, "Reference number exactly as printed, or null."),
    serial: nullable({ type: "string" }, "Serial number exactly as printed, or null."),
    caseMaterial: nullable({ type: "string", enum: [...CASE_MATERIALS] }, "Case material if visible or printed, or null."),
    style: nullable({ type: "string", enum: [...STYLES] }, "sport or dress if clear, or null."),
    boxVisible: { type: "boolean", description: "True only if a watch box is visible." },
    papersVisible: { type: "boolean", description: "True only if a warranty card or papers are visible." },
    notes: nullable({ type: "string" }, "Short note on anything unclear, or null."),
  },
  required: ["maker", "model", "reference", "serial", "caseMaterial", "style", "boxVisible", "papersVisible", "notes"],
} as const;

export const VISION_PROMPT = `You are reading photos of a wristwatch, its box and its papers for a valuation app.
Transcribe only what you can actually see. Never guess: if a field is not visible or not
legible, return null. Copy numbers and names exactly as printed.`;

function cleanText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Vision answer: ${field} must be text or null`);
  const text = value.trim();
  if (text.length > MAX_TEXT) throw new Error(`Vision answer: ${field} is too long`);
  return text === "" ? null : text;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === null || value === undefined) return null;
  if (!allowed.includes(value as T)) throw new Error(`Vision answer: ${field} must be one of ${allowed.join(", ")}`);
  return value as T;
}

/** Checks the model's JSON answer; throws instead of passing on anything unexpected. */
export function parseWatchReading(data: unknown): WatchReading {
  if (typeof data !== "object" || data === null) throw new Error("Vision answer must be a JSON object");
  const raw = data as Record<string, unknown>;
  if (typeof raw.boxVisible !== "boolean" || typeof raw.papersVisible !== "boolean") {
    throw new Error("Vision answer: boxVisible and papersVisible must be true or false");
  }
  return {
    maker: cleanText(raw.maker, "maker"),
    model: cleanText(raw.model, "model"),
    reference: cleanText(raw.reference, "reference"),
    serial: cleanText(raw.serial, "serial"),
    caseMaterial: oneOf(raw.caseMaterial, CASE_MATERIALS, "caseMaterial"),
    style: oneOf(raw.style, STYLES, "style"),
    boxVisible: raw.boxVisible,
    papersVisible: raw.papersVisible,
    notes: cleanText(raw.notes, "notes"),
  };
}

/**
 * Category from what was read, only when it is clear. Anything else returns
 * null and the agent asks the user, because the category sets the loan-to-value.
 */
export function categoryFromReading(reading: WatchReading): WatchCategory | null {
  if (reading.caseMaterial === "gold" || reading.caseMaterial === "platinum") return "dress_gold";
  if ((reading.caseMaterial === "steel" || reading.caseMaterial === "titanium") && reading.style === "sport") {
    return "sport_steel";
  }
  return null;
}

export interface WatchVision {
  read(photos: PhotoInput[]): Promise<WatchReading>;
}

export function createGeminiVision(options: { apiKey: string; model: string }): WatchVision {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  return {
    async read(photos) {
      // The docs advise putting the text before the images.
      const parts: Part[] = [
        { text: VISION_PROMPT },
        ...photos.map((photo) => ({ inlineData: { mimeType: photo.mimeType, data: photo.dataBase64 } })),
      ];
      const response = await ai.models.generateContent({
        model: options.model,
        contents: [{ role: "user", parts }],
        config: { responseMimeType: "application/json", responseJsonSchema: WATCH_READING_SCHEMA },
      });
      const text = (response.candidates?.[0]?.content?.parts ?? [])
        .filter((part) => part.text && !part.thought)
        .map((part) => part.text)
        .join("");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        // Not the parser's message: it quotes the start of the text, which may hold a serial number.
        throw new Error("The photo reader's answer was not valid JSON. Try the photos again.");
      }
      return parseWatchReading(json);
    },
  };
}
