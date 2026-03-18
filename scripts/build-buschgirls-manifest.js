const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "img", "buschgirls");
const outFile = path.join(dir, "manifest.json");
const allowed = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function walk(folder) {
  const entries = fs.readdirSync(folder, { withFileTypes: true });
  let out = [];

  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      out = out.concat(walk(fullPath));
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!allowed.has(ext)) continue;
    if (entry.name.toLowerCase() === "manifest.json") continue;

    out.push(path.relative(path.join(__dirname, ".."), fullPath).replace(/\\/g, "/"));
  }

  return out;
}

const files = walk(dir)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

fs.writeFileSync(outFile, JSON.stringify(files, null, 2) + "\n");
console.log(`Generated manifest with ${files.length} images.`);
