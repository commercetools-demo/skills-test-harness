import { readFileSync, appendFileSync } from 'fs';

const raw = readFileSync('judge-result.json', 'utf8');
const result = JSON.parse(raw);

const outputs = {
  score: result.score ?? 0,
  critical_count: (result.critical_violations ?? []).length,
  high_count: (result.high_violations ?? []).length,
  medium_count: (result.medium_violations ?? []).length,
};

const outputFile = process.env.GITHUB_OUTPUT;
if (outputFile) {
  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

console.log('Judge result:', JSON.stringify(outputs, null, 2));

if (outputs.critical_count > 0) {
  console.error(`FAIL: ${outputs.critical_count} critical violation(s):`);
  for (const v of result.critical_violations) {
    console.error(`  - ${v.item}: ${v.evidence}`);
  }
  process.exit(1);
}
