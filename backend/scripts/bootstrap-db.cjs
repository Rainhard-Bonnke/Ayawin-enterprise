require('dotenv').config();

const { ensureBootstrap, getSchemaStatus } = require('../src/bootstrap');

async function main() {
  try {
    const result = await ensureBootstrap();
    const status = await getSchemaStatus();
    console.log(JSON.stringify({ bootstrap: result, schema: status }, null, 2));
  } catch (err) {
    console.error('Database bootstrap failed');
    console.error(err);
    process.exit(1);
  }
}

main();
