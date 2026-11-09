const INTAKE_LABELS = {
  path: 'What describes you?', business: 'What is your business called?', industry: 'What does your business do?',
  stage: 'How far along is your business?', registered: 'Is your business registered with CAC?',
  needs: 'What would you like us to help with?', challenge: 'What slows your business down?',
  tried: 'What have you tried so far?', impact: 'What changes when it is sorted?', importance: 'How important is this (out of 10)?',
  goal: 'What matters most?', timing: 'When would you like to start?', team: 'How many people work in your business?',
  location: 'Where are you based?', venture: 'Team chosen', route: 'Questionnaire route', urgency: 'How soon do you need help?',
  src: 'Where did you find us?', note: 'Anything else you would like us to know?', situation: 'Your situation',
  details: 'Further details', format: 'Preferred format',
};

const present = value => value !== undefined && value !== null && (Array.isArray(value) ? value.some(present) : String(value).trim() !== '');
const answerText = value => Array.isArray(value) ? value.filter(present).map(x => '- ' + String(x)).join('\n') : String(value);
const humanize = key => key.replaceAll('_', ' ');

function intakeLabel(key, intake) {
  if (key.endsWith('_other')) return (intakeLabel(key.slice(0, -6), intake)) + ' (other response)';
  return intake[key + '_q'] || INTAKE_LABELS[key] || humanize(key);
}

function addAnswers(lines, answers, label = key => key) {
  const entries = Object.entries(answers).filter(([key, value]) => !key.endsWith('_q') && present(value));
  for (const [key, value] of entries) lines.push(String(label(key)), answerText(value), '');
  return entries.length;
}

export function clientResponsesText({ client, requests, engagements }) {
  const lines = ['HAMZURY | CLIENT RESPONSES', '',
    `Client ID: ${client.ref}`, `Name: ${client.name}`, `Business: ${client.business || '-'}`,
    `Phone: ${client.phone}`, `Email: ${client.email || '-'}`, `Submitted: ${client.created_at} UTC`, '',
    'INITIAL QUESTIONNAIRE', '=====================', ''];
  if (!addAnswers(lines, client.intake, key => intakeLabel(key, client.intake))) lines.push('No questionnaire responses saved.', '');

  lines.push('PACKAGE FOLLOW-UP QUESTIONS', '===========================', '');
  let requestCount = 0;
  for (const request of requests) {
    if (!Object.values(request.answers).some(present)) continue;
    requestCount++;
    lines.push(`${request.code ? request.code + ' | ' : ''}${request.name}`);
    if (request.requested_at) lines.push(`Submitted: ${request.requested_at} UTC`);
    lines.push('');
    // Follow-up and onboarding keys are the actual question text, including any ending in "_q".
    for (const [question, answer] of Object.entries(request.answers)) {
      if (present(answer)) lines.push(question, answerText(answer), '');
    }
  }
  if (!requestCount) lines.push('No package follow-up responses saved.', '');

  lines.push('ONBOARDING QUESTIONS', '====================', '');
  let onboardingCount = 0;
  for (const engagement of engagements) {
    if (!Object.values(engagement.answers).some(present) && !engagement.attachments.length) continue;
    onboardingCount++;
    lines.push(engagement.name);
    if (engagement.onboarding_at) lines.push(`Submitted: ${engagement.onboarding_at} UTC`);
    lines.push('');
    for (const [question, answer] of Object.entries(engagement.answers)) {
      if (present(answer)) lines.push(question, answerText(answer), '');
    }
    if (engagement.attachments.length) {
      lines.push('Uploaded files (download the files separately from the client page):');
      for (const file of engagement.attachments) {
        const question = engagement.questions[Number(file.q)]?.label || `Question ${file.q}`;
        lines.push(`${question}: ${file.name}`);
      }
      lines.push('');
    }
  }
  if (!onboardingCount) lines.push('No onboarding responses saved.', '');
  return lines.join('\n').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
}
