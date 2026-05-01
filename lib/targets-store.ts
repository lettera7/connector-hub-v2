import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
const PATH = join(process.cwd(), ".targets.json");
export interface Targets { annualTarget: number; monthlyTarget: number; }
export function readTargets(): Targets {
  try { if (!existsSync(PATH)) return { annualTarget: 0, monthlyTarget: 0 }; return JSON.parse(readFileSync(PATH, "utf-8")); } catch { return { annualTarget: 0, monthlyTarget: 0 }; }
}
export function writeTargets(t: Targets): void { writeFileSync(PATH, JSON.stringify(t, null, 2), "utf-8"); }
