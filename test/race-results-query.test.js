import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(repoRoot, "functions", "api");

test("race-results reads are bounded before Supabase applies its row limit", async () => {
  const apiFiles = (await readdir(apiDir)).filter(name => name.endsWith(".js"));
  const unbounded = [];

  for (const file of apiFiles) {
    const source = await readFile(path.join(apiDir, file), "utf8");
    const queries = source.matchAll(/\/rest\/v1\/race_results\?([^`"']+)/g);

    for (const match of queries) {
      const query = match[1];
      const isWinnerOnly = query.includes("finishing_position=eq.1");
      const isRaceBounded = /race_id=(?:eq\.|in\.)/.test(query);

      if (!isWinnerOnly && !isRaceBounded) {
        unbounded.push(`${file}: ${query}`);
      }
    }
  }

  assert.deepEqual(
    unbounded,
    [],
    "Fetching every finisher can silently drop recent races at Supabase's 1,000-row response limit"
  );
});
