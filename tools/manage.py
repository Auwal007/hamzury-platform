"""Server-operator account recovery. Passwords are read privately, never from arguments."""
import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def reset_password(username, password, reset_mfa=False):
    import server
    if not 12 <= len(password) <= 200:
        raise ValueError('password must contain 12 to 200 characters')
    with server.connect() as c:
        user = c.execute('SELECT * FROM users WHERE username=? AND active=1', (username.lower(),)).fetchone()
        if not user:
            raise ValueError('active staff account not found')
        c.execute('UPDATE users SET password_hash=? WHERE id=?', (server.password_hash(password), user['id']))
        if reset_mfa:
            c.execute("UPDATE users SET mfa_secret='',mfa_pending='',mfa_last_step=-1 WHERE id=?", (user['id'],))
        c.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
        server.log(c, 'server-operator', 'staff.recovered', 'users', user['id'], 'MFA reset' if reset_mfa else 'password reset')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['reset-password'])
    parser.add_argument('username')
    parser.add_argument('--reset-mfa', action='store_true', help='also remove a lost authenticator; verify the staff identity first')
    args = parser.parse_args()
    password = getpass.getpass('New password (12+ characters): ')
    if password != getpass.getpass('Repeat password: '):
        parser.error('passwords do not match')
    try:
        reset_password(args.username, password, args.reset_mfa)
    except ValueError as exc:
        parser.error(str(exc))
    print('Password changed and all sessions revoked. MFA enrollment is required again if it was reset.')


if __name__ == '__main__':
    main()
