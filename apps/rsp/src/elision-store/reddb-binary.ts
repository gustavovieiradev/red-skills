import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function ensureReddbBinaryFromWarmCache(): Promise<void> {
  if (process.env.REDDB_BIN) return;
  // Same default cascade as the launcher fetch: an unset RED_SKILLS_CACHE_DIR
  // means the standard cache location, not "no cache".
  const cacheDir =
    process.env.RED_SKILLS_CACHE_DIR ??
    (process.env.XDG_CACHE_HOME
      ? join(process.env.XDG_CACHE_HOME, "red-skills", "bundles")
      : join(homedir(), ".cache", "red-skills", "bundles"));
  const root = join(cacheDir, "reddb");
  let versions: string[];
  try {
    versions = await readdir(root);
  } catch {
    return;
  }
  versions.sort().reverse();
  for (const version of versions) {
    const candidate = join(root, version, process.platform === "win32" ? "red.exe" : "red");
    if (existsSync(candidate)) {
      process.env.REDDB_BIN = candidate;
      return;
    }
  }
}
