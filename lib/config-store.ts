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
    if (existsSync(PATH)) return JSON.parse(readFileSync(PATH, "utf-8"));
  } catch { return {}; }

  const ficAccessToken = process.env.FIC_ACCESS_TOKEN;
  const ficCompanyId = process.env.FIC_COMPANY_ID;
  const floatApiKey = process.env.FLOAT_API_KEY;

  return {
    fic: ficAccessToken && ficCompanyId ? { accessToken: ficAccessToken, companyId: ficCompanyId } : undefined,
    float: floatApiKey ? { apiKey: floatApiKey } : undefined,
  };
}

export function writeConfig(cfg: AppConfig): void {
  writeFileSync(PATH, JSON.stringify(cfg, null, 2), "utf-8");
}
