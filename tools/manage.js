// server-operator account recovery, against the database in DATABASE_URL. passwords are read privately, never from arguments.
//   node tools/manage.js reset-password <email-or-legacy-username> [--reset-mfa]
//   node tools/manage.js set-email <email-or-legacy-username> <new-email>
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { openDb } from '../lib/db.js';
import { passwordHash } from '../lib/security.js';
import { loadEnv } from './env.js';
import { normalizeStaffEmail, validStaffEmail } from '../lib/staff-email.js';

async function findStaff(c, identifier) {
  const key = normalizeStaffEmail(identifier);
  return c.get(key.includes('@') ? 'SELECT * FROM users WHERE lower(email)=? AND active=1' : 'SELECT * FROM users WHERE username=? AND active=1', key);
}

export async function resetPassword(db, username, password, { resetMfa = false } = {}) {
  if (password.length < 12 || password.length > 200) throw new Error('password must contain 12 to 200 characters');
  const hash = await passwordHash(password);
  await db.tx(async c => {
    const user = await findStaff(c, username);
    if (!user) throw new Error('active staff account not found');
    await c.run('UPDATE users SET password_hash=? WHERE id=?', hash, user.id);
    if (resetMfa) await c.run("UPDATE users SET mfa_secret='',mfa_pending='',mfa_last_step=-1 WHERE id=?", user.id);
    await c.run('DELETE FROM sessions WHERE user_id=?', user.id);
    await c.run('INSERT INTO audit(actor,event,entity,entity_id,summary) VALUES(?,?,?,?,?)', 'server-operator', 'staff.recovered', 'users', user.id, resetMfa ? 'MFA reset' : 'password reset');
  });
}

export async function setEmail(db, identifier, value) {
  const email = normalizeStaffEmail(value);
  if (!validStaffEmail(email)) throw new Error('enter a valid email address');
  try {
    await db.tx(async c => {
      const user = await findStaff(c, identifier);
      if (!user) throw new Error('active staff account not found');
      await c.run('UPDATE users SET email=? WHERE id=?', email, user.id);
      await c.run('DELETE FROM sessions WHERE user_id=?', user.id);
      await c.run('INSERT INTO audit(actor,event,entity,entity_id,summary) VALUES(?,?,?,?,?)', 'server-operator', 'staff.email_assigned', 'users', user.id, 'login email updated');
    });
  } catch (e) {
    if (e.code === '23505') throw new Error('that email address is already in use');
    throw e;
  }
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
  const [action, identifier, email] = args;
  if (!['reset-password', 'set-email'].includes(action) || !identifier || (action === 'set-email' && !email)) {
    console.log('usage: node tools/manage.js reset-password <email-or-legacy-username> [--reset-mfa]\n       node tools/manage.js set-email <email-or-legacy-username> <new-email>\n  --reset-mfa  also remove a lost authenticator; verify the staff identity first');
    process.exit(2);
  }
  let password;
  if (action === 'reset-password') {
    password = await hidden('New password (12+ characters): ');
    if (password !== await hidden('Repeat password: ')) { console.error('passwords do not match'); process.exit(2); }
  }
  const db = await openDb(process.env.DATABASE_URL || 'pglite:data/pglite');
  try {
    if (action === 'set-email') {
      await setEmail(db, identifier, email);
      console.log('Login email saved and sessions revoked. The password and authenticator were preserved.');
    } else {
      await resetPassword(db, identifier, password, { resetMfa: args.includes('--reset-mfa') });
      console.log('Password changed and all sessions revoked. MFA enrollment is required again if it was reset.');
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  } finally {
    await db.close();
  }
}
