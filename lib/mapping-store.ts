import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
export interface ProjectClientMapping { floatProjectId: number; floatProjectName: string; ficClientId: number; ficClientName: string; mappingSource: "manual" | "automatic"; updatedAt: string; }
const PATH = join(process.cwd(), ".mappings.json");
export function readMappings(): ProjectClientMapping[] { try { if (!existsSync(PATH)) return []; return JSON.parse(readFileSync(PATH, "utf-8")); } catch { return []; } }
function save(m: ProjectClientMapping[]) { writeFileSync(PATH, JSON.stringify(m, null, 2), "utf-8"); }
export function upsertMapping(m: Omit<ProjectClientMapping, "updatedAt">): ProjectClientMapping[] { const all = readMappings(); const idx = all.findIndex(x => x.floatProjectId === m.floatProjectId); const e = { ...m, updatedAt: new Date().toISOString() }; if (idx >= 0) all[idx] = e; else all.push(e); save(all); return all; }
export function removeMapping(id: number): ProjectClientMapping[] { const all = readMappings().filter(x => x.floatProjectId !== id); save(all); return all; }
