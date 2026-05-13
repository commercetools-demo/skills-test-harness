import { readFileSync } from 'fs';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const checkRunId = getArg('--check-run-id');
const status = getArg('--status');
const skillSlug = getArg('--skill-slug');
const judgeOutputPath = getArg('--judge-output') ?? 'judge-result.json';
const previewUrl = getArg('--preview-url');
const publishedBranch = getArg('--published-branch');

if (!checkRunId) {
  console.log('No check run ID — skipping update (manual dispatch without SHA)');
  process.exit(0);
}

const GH_TOKEN = process.env.GH_TOKEN;
if (!GH_TOKEN) {
  console.error('ERROR: GH_TOKEN env var required. Ensure the GitHub App is installed on commercetools-demo/skills');
  process.exit(1);
}

// Map status to GitHub conclusion
function mapConclusion(s) {
  switch (s) {
    case 'success': return 'success';
    case 'failure': return 'failure';
    case 'cancelled': return 'cancelled';
    default: return 'neutral';
  }
}

const conclusion = mapConclusion(status);

// Try to read judge result
let judgeResult = null;
try {
  judgeResult = JSON.parse(readFileSync(judgeOutputPath, 'utf8'));
} catch {
  // file may not exist — that's fine
}

const score = judgeResult?.score ?? 0;
const criticalViolations = judgeResult?.critical_violations ?? [];
const highViolations = judgeResult?.high_violations ?? [];
const mediumViolations = judgeResult?.medium_violations ?? [];
const criticalCount = criticalViolations.length;
const highCount = highViolations.length;
const mediumCount = mediumViolations.length;

// Status emoji
const statusEmoji = criticalCount === 0 ? '✅' : '❌';

// Build markdown summary
const lines = [];
lines.push(`## Harness result: ${skillSlug} — ${statusEmoji}`);
lines.push('');
lines.push('| Metric | Value |');
lines.push('|---|---|');
lines.push(`| Score | ${score}/100 |`);
lines.push(`| Critical violations | ${criticalCount} |`);
lines.push(`| High violations | ${highCount} |`);
lines.push(`| Medium violations | ${mediumCount} |`);

if (criticalViolations.length > 0) {
  lines.push('');
  lines.push('### Critical violations');
  for (const v of criticalViolations.slice(0, 3)) {
    lines.push(`- **${v.item}**: ${v.evidence}`);
  }
}

if (previewUrl) {
  lines.push('');
  lines.push('### Preview');
  lines.push(`[Open preview](${previewUrl})`);
}

if (publishedBranch) {
  lines.push('');
  lines.push('### Generated code');
  lines.push(
    `[commercetools-demo/skills-scaffold @ ${publishedBranch}](https://github.com/commercetools-demo/skills-scaffold/tree/${publishedBranch})`
  );
}

const summary = lines.join('\n');
const title = `Score: ${score}/100 — ${criticalCount} critical, ${highCount} high, ${mediumCount} medium`;

try {
  const res = await fetch(
    `https://api.github.com/repos/commercetools-demo/skills/check-runs/${checkRunId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        status: 'completed',
        conclusion,
        completed_at: new Date().toISOString(),
        output: {
          title,
          summary,
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status} ${res.statusText}: ${text}`);
  }

  console.log(`Updated check run ${checkRunId} with conclusion ${conclusion}`);
} catch (err) {
  console.error('ERROR updating check run:', err.message ?? err);
  process.exit(1);
}
