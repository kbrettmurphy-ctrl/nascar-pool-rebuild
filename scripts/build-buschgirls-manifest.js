const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "img", "buschgirls");
const outFile = path.join(dir, "manifest.json");
const allowed = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const files = fs
  .readdirSync(dir)
  .filter((file) => allowed.has(path.extname(file).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((file) => `img/buschgirls/${file}`);

fs.writeFileSync(outFile, JSON.stringify(files, null, 2) + "\n");
console.log(`Generated manifest with ${files.length} images.`);
