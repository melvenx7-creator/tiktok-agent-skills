import fs from 'node:fs/promises';
import { submitRender, getRenderStatus, currentEnvironment } from './client.js';

const [command, arg] = process.argv.slice(2);

try {
  if (command === 'render') {
    if (!arg) throw new Error('Usage: npm run render -- path/to/edit.json');
    const edit = JSON.parse(await fs.readFile(arg, 'utf8'));
    const result = await submitRender(edit);
    console.log(JSON.stringify({ environment: currentEnvironment(), result }, null, 2));
    console.log(`\nSave this render ID: ${result?.response?.id || 'not returned'}`);
  } else if (command === 'status') {
    if (!arg) throw new Error('Usage: npm run status -- RENDER_ID');
    const result = await getRenderStatus(arg);
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error('Choose a command: render or status.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
