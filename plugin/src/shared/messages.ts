// Typed messages between the plugin UI (iframe) and the Figma main thread.
import type { FontInfo, TypeStyle } from '../../../shared/types';

export interface Settings {
  backend: string;
  theme: 'auto' | 'light' | 'dark';
  hideSmall: boolean;
  deep: boolean;
  /** Pages of each website to read (1 = only the pasted link). */
  pages: number;
  /** Downloads and Figma inserts: original files first, small images enlarged 2×. */
  hd: boolean;
}

export interface HistoryEntry {
  urls: string[];
  at: number;
}

export interface InsertItem {
  id: string;
  name: string;
  kind: 'raster' | 'svg';
  bytes?: Uint8Array;
  svg?: string;
}

export interface InsertResult {
  id: string;
  ok: boolean;
  reason?: string;
}

export type UiToMain =
  | { type: 'storage:get' }
  | { type: 'storage:set'; key: 'settings' | 'history'; value: unknown }
  | { type: 'insert:start'; batchId: string; frameName: string; total: number }
  | { type: 'insert:chunk'; batchId: string; items: InsertItem[] }
  | { type: 'insert:end'; batchId: string; canceled: boolean }
  | { type: 'palette:insert'; name: string; colors: { hex: string; label: string }[]; styles: boolean }
  | { type: 'brandbook:build'; data: BrandBookData }
  | { type: 'fonts:insert'; name: string; fonts: { family: string; role: string; weights: string[] }[] }
  | { type: 'notify'; message: string; error?: boolean }
  | { type: 'resize'; width: number; height: number };

export type MainToUi =
  | { type: 'storage:data'; settings: Settings | null; history: HistoryEntry[] | null }
  | { type: 'insert:chunk-result'; batchId: string; results: InsertResult[] }
  | { type: 'insert:done'; batchId: string; placed: number; failed: number }
  | { type: 'palette:done'; ok: boolean; message: string }
  | { type: 'fonts:done'; ok: boolean; message: string }
  | { type: 'brandbook:done'; ok: boolean; message: string };

/** Everything the brand book needs, collected and downloaded by the UI. */
export interface BrandBookData {
  host: string;
  siteName: string;
  date: string;
  colors: { hex: string; label: string; source: string }[];
  fonts: FontInfo[];
  typeScale: TypeStyle[];
  logo: { svg?: string; bytes?: Uint8Array } | null;
  favicon: { svg?: string; bytes?: Uint8Array } | null;
  icons: { name: string; svg: string }[];
  images: { name: string; bytes: Uint8Array }[];
}

export const DEFAULT_SETTINGS: Settings = {
  backend: 'http://localhost:8787',
  theme: 'auto',
  hideSmall: false,
  deep: false,
  pages: 10,
  hd: true,
};
