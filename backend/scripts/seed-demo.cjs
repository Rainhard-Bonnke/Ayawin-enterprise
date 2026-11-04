require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const pool = require("../src/db");
const { ensureErpFoundation } = require("../src/erpBootstrap");

async function seedDemo() {
  if (process.env.NODE_ENV === "production") throw new Error("Demo seeds are disabled in production");
  await ensureErpFoundation();
  const directory = path.join(__dirname, "..", "seeds", "demo");
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) await pool.query(await fs.readFile(path.join(directory, file), "utf8"));
  return files;
}

if (require.main === module) {
  seedDemo().then((files) => console.log(`Applied ${files.length} demo seed files`))
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { seedDemo };
