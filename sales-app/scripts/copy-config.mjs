import { cpSync, existsSync, mkdirSync } from "fs";
import path from "path";

const src = path.resolve(process.cwd(), "..", "config");
const dest = path.resolve(process.cwd(), "config");

if (existsSync(path.join(dest, "markets.yaml"))) {
  console.log("copy-config: config already bundled in sales-app/config");
  process.exit(0);
}

if (!existsSync(src)) {
  console.warn("copy-config: ../config not found, skipping");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const file of ["markets.yaml", "categories.yaml", "campaign.yaml"]) {
  cpSync(path.join(src, file), path.join(dest, file));
}
console.log("copy-config: bundled config/*.yaml for deployment");
