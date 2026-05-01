import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
const PATH = join(process.cwd(), ".dismissed.json");
export function readDismissed(): number[] { try { if (!existsSync(PATH)) return []; return JSON.parse(readFileSync(PATH, "utf-8")); } catch { return []; } }
export function addDismissed(id: number): number[] {
  const seen = new Set<number>();
  const all: number[] = [];
  for (const value of [...readDismissed(), id]) {
    if (seen.has(value)) continue;
    seen.add(value);
    all.push(value);
  }
  writeFileSync(PATH, JSON.stringify(all, null, 2), "utf-8");
  return all;
}
