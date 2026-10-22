// Validates server.json against the registry schema it declares, in the publish workflow.
// ajv is pinned in yarn.lock; ajv-cli would add packages with known advisories.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

const [schemaPath, dataPath] = process.argv.slice(2);
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
if (!validate(JSON.parse(readFileSync(dataPath, 'utf8')))) {
  console.error(`${dataPath} is invalid:`, ajv.errorsText(validate.errors, { separator: '\n' }));
  process.exit(1);
}
console.log(`${dataPath} valid`);
