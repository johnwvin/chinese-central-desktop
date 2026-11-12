export const LEVELS = ["1", "2", "3", "4", "5", "6", "7-9"] as const;
export type Level = typeof LEVELS[number];
export type StudyStatus = "review" | "unlearned" | "memorized";
export interface Vocab {
  id: string;
  level: Level;
  word: string;
  label: string;
  pinyin: string;
  meaning: string;
  pos?: string;
  glossSource?: string;
  levelNote: string;
  page: number;
}
interface Review { due: number; streak: number; seen: number; known: boolean }
export type Progress = Record<string, Review>;
export type StudyData = { statuses: Record<string, StudyStatus>; progress: Progress };
type StudyPatch = Partial<StudyData> & { fillMissing?: boolean };
const CHANGED = "cc.hsk-study.changed";

export function levelLabel(level: Level): string {
  return level === "7-9" ? "HSK 7–9" : "HSK " + level;
}

export async function hskList<T>(name: string): Promise<T> {
  const response = await fetch("/hsk/" + name + ".json");
  if (!response.ok) throw new Error("The HSK lists could not be loaded.");
  return response.json();
}

let vocabulary: Promise<Vocab[]> | undefined;
export function hskVocabulary(): Promise<Vocab[]> {
  return vocabulary ??= hskList<Vocab[]>("vocabulary").catch((error) => {
    vocabulary = undefined;
    throw error;
  });
}

export async function studyData(patch?: StudyPatch): Promise<StudyData> {
  const response = await fetch("/api/central/hsk-study", patch && {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error("Could not access saved HSK study data.");
  const data: StudyData = await response.json();
  if (patch && !patch.fillMissing) {
    try { localStorage.setItem(CHANGED, crypto.randomUUID()); } catch { /* Focus refresh remains available. */ }
  }
  return data;
}

export function watchStudy(refresh: () => void): () => void {
  const storage = (event: StorageEvent) => { if (event.key === CHANGED) refresh(); };
  window.addEventListener("storage", storage);
  window.addEventListener("focus", refresh);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", refresh);
  };
}
