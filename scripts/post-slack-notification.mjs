import { readFileSync } from 'fs';

const webhookUrl = process.env.SLACK_WEBHOOK_URL;
if (!webhookUrl) {
  console.log('SLACK_WEBHOOK_URL not set — skipping Slack notification');
  process.exit(0);
}

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const skillSlug = getArg('--skill-slug') ?? 'unknown';
const skillName = getArg('--skill-name') ?? skillSlug;
const previewUrl = getArg('--preview-url') ?? '';
const runUrl = getArg('--run-url') ?? '';
const jobStatus = getArg('--status') ?? 'unknown';
const skillsRef = getArg('--skills-ref') ?? '';

let judgeResult = null;
try {
  judgeResult = JSON.parse(readFileSync('judge-result.json', 'utf8'));
} catch {
  // judge may not have run (e.g. scaffold failed)
}

const score = judgeResult?.score ?? '—';
const criticalCount = (judgeResult?.critical_violations ?? []).length;
const highCount = (judgeResult?.high_violations ?? []).length;
const mediumCount = (judgeResult?.medium_violations ?? []).length;
const criticalViolations = judgeResult?.critical_violations ?? [];

const statusEmoji = jobStatus === 'success' ? ':white_check_mark:' : jobStatus === 'cancelled' ? ':grey_question:' : ':x:';
const scoreEmoji = criticalCount === 0 ? ':green_circle:' : ':red_circle:';

const headerText = `${statusEmoji} *Harness: ${skillName}${skillsRef ? ` @ ${skillsRef}` : ''}*`;

const blocks = [
  {
    type: 'section',
    text: { type: 'mrkdwn', text: headerText },
  },
  {
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `${scoreEmoji} *Score*\n${score}/100` },
      { type: 'mrkdwn', text: `*Critical*\n${criticalCount}` },
      { type: 'mrkdwn', text: `*High*\n${highCount}` },
      { type: 'mrkdwn', text: `*Medium*\n${mediumCount}` },
    ],
  },
];

if (criticalViolations.length > 0) {
  const violationLines = criticalViolations
    .slice(0, 3)
    .map(v => `• *${v.item}*: ${v.evidence}`)
    .join('\n');
  const suffix = criticalViolations.length > 3 ? `\n_and ${criticalViolations.length - 3} more…_` : '';
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `:warning: *Critical violations*\n${violationLines}${suffix}` },
  });
}

const actions = [];
if (previewUrl) {
  actions.push({ type: 'button', text: { type: 'plain_text', text: ':globe_with_meridians: Preview' }, url: previewUrl });
}
if (runUrl) {
  actions.push({ type: 'button', text: { type: 'plain_text', text: ':github: Harness run' }, url: runUrl });
}
if (actions.length > 0) {
  blocks.push({ type: 'actions', elements: actions });
}

try {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  if (!res.ok) {
    throw new Error(`Slack API returned ${res.status} ${res.statusText}`);
  }
  console.log('Slack notification sent');
} catch (err) {
  console.error('ERROR sending Slack notification:', err.message ?? err);
  process.exit(1);
}
