const DEFAULT_DATA_DIR = "./data";

export function resolveDataDir(): string {
  const configured = process.env.DATA_DIR?.trim();
  if (configured) {
    return configured;
  }
  if (process.env.VERCEL) {
    return "/tmp";
  }
  return DEFAULT_DATA_DIR;
}
