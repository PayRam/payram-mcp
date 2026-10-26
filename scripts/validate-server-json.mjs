// Validates server.json against the registry schema it declares, in the publish workflow.
// ajv and ajv-formats are pinned in yarn.lock; ajv-cli would add packages with known advisories.
// ajv alone skips `format` keywords, so without ajv-formats a websiteUrl, icon src or repository
// url that is not a URI would pass here unchecked.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const [schemaPath, dataPath] = process.argv.slice(2);
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
if (!validate(JSON.parse(readFileSync(dataPath, 'utf8')))) {
  console.error(`${dataPath} is invalid:`, ajv.errorsText(validate.errors, { separator: '\n' }));
  process.exit(1);
}
console.log(`${dataPath} valid`);
