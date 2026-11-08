// server-operator account recovery, against the database in DATABASE_URL. passwords are read privately, never from arguments.
//   node tools/manage.js reset-password <username> [--reset-mfa]
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { openDb } from '../lib/db.js';
import { passwordHash } from '../lib/security.js';
import { loadEnv } from './env.js';

export async function resetPassword(db, username, password, { resetMfa = false } = {}) {
  if (password.length < 12 || password.length > 200) throw new Error('password must contain 12 to 200 characters');
  const hash = await passwordHash(password);
  await db.tx(async c => {
    const user = await c.get('SELECT * FROM users WHERE username=? AND active=1', username.toLowerCase());
    if (!user) throw new Error('active staff account not found');
    await c.run('UPDATE users SET password_hash=? WHERE id=?', hash, user.id);
    if (resetMfa) await c.run("UPDATE users SET mfa_secret='',mfa_pending='',mfa_last_step=-1 WHERE id=?", user.id);
    await c.run('DELETE FROM sessions WHERE user_id=?', user.id);
    await c.run('INSERT INTO audit(actor,event,entity,entity_id,summary) VALUES(?,?,?,?,?)', 'server-operator', 'staff.recovered', 'users', user.id, resetMfa ? 'MFA reset' : 'password reset');
  });
}

function hidden(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(prompt)) rl.output.write(prompt); };
    rl.question(prompt, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  loadEnv();
  const args = process.argv.slice(2);
  const [action, username] = args;
  if (action !== 'reset-password' || !username) {
    console.log('usage: node tools/manage.js reset-password <username> [--reset-mfa]\n  --reset-mfa  also remove a lost authenticator; verify the staff identity first');
    process.exit(2);
  }
  const password = await hidden('New password (12+ characters): ');
  if (password !== await hidden('Repeat password: ')) { console.error('passwords do not match'); process.exit(2); }
  const db = await openDb();
  try {
    await resetPassword(db, username, password, { resetMfa: args.includes('--reset-mfa') });
    console.log('Password changed and all sessions revoked. MFA enrollment is required again if it was reset.');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  } finally {
    await db.close();
  }
}
