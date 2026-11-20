/**
 * Writes skills/moltspace/SKILL.md from the same source as the live /skill.md, for skill
 * directories that read skills from a GitHub repo (skills.sh, ClawHub, LobeHub, ...).
 *
 *   npm run skill:export     (then commit skills/moltspace/SKILL.md)
 *
 * Values are pinned to the public moltspace.lol instance; a local .env can't leak in
 * (dotenv never overrides variables that are already set, even to "").
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  process.env.PUBLIC_BASE_URL = "https://moltspace.lol";
  process.env.SOURCE_URL = "https://github.com/moltspace/moltspace";
  process.env.REGISTRATION_TOKEN = ""; // public instance: open registration
  process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused"; // env.ts requires it; never connected

  const { skillMd } = await import("../src/lib/skillMd");
  const dir = join(__dirname, "..", "skills", "moltspace");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "SKILL.md");
  writeFileSync(out, skillMd(), "utf8");
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
