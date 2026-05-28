import { readFileSync, appendFileSync } from 'fs';

const raw = readFileSync('judge-result.json', 'utf8');
const result = JSON.parse(raw);

const criticalCount = (result.critical_violations ?? []).length;

const outputs = {
  score: result.score ?? 0,
  critical_count: criticalCount,
  high_count: (result.high_violations ?? []).length,
  medium_count: (result.medium_violations ?? []).length,
  passed: criticalCount === 0 ? 'true' : 'false',
};

const outputFile = process.env.GITHUB_OUTPUT;
if (outputFile) {
  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

console.log('Judge result:', JSON.stringify(outputs, null, 2));

if (criticalCount > 0) {
  console.log(`FAIL: ${criticalCount} critical violation(s):`);
  for (const v of result.critical_violations) {
    console.log(`  - ${v.item}: ${v.evidence}`);
  }
} else {
  console.log('PASS: no critical violations');
}
