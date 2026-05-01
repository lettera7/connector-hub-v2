import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export interface FicCredentials { accessToken: string; companyId: string; }
export interface FloatCredentials { apiKey: string; }
export interface AppConfig {
  fic?: FicCredentials;
  float?: FloatCredentials;
  ficStatus?: { ok: boolean; message: string };
  floatStatus?: { ok: boolean; message: string };
}

const PATH = join(process.cwd(), ".config.json");

export function readConfig(): AppConfig {
  try {
    if (!existsSync(PATH)) return {};
    return JSON.parse(readFileSync(PATH, "utf-8"));
  } catch { return {}; }
}

export function writeConfig(cfg: AppConfig): void {
  writeFileSync(PATH, JSON.stringify(cfg, null, 2), "utf-8");
}
