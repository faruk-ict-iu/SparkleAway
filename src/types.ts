export interface BoundingBox {
  x: number;      // % from left (0 - 100)
  y: number;      // % from top (0 - 100)
  width: number;  // % of total width (0 - 100)
  height: number; // % of total height (0 - 100)
}

export interface DetectedWatermark {
  label: string;
  type: "sparkle_icon" | "watermark_text" | "logo_overlay" | "stamp" | string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionResult {
  detected: boolean;
  summaryReport: string;
  watermarks: DetectedWatermark[];
}

export type InpaintEngine = "fast_local" | "gemini_ai";

export interface InpaintSettings {
  engine: InpaintEngine;
  brushSize: number;
  featherSize: number; // amount of edge feathering
  iterations: number;  // pixel propagation quality rounds
  customPrompt: string; // for AI Engine
}

export interface HistoryItem {
  imageDataUrl: string; // Base64 or DataURL of the image state
  maskDataUrl: string | null; // Mask state (translucent red mask)
}
