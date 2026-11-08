"""Generate a private development .env without overwriting existing configuration."""
import os
import secrets
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    target = root / '.env'
    settings = (root / '.env.example').read_text(encoding='utf-8')
    for key, value in {
        'HAMZURY_ADMIN_PASSWORD': secrets.token_urlsafe(24),
        'HAMZURY_SECRET': secrets.token_urlsafe(48),
        'HAMZURY_BILLING_KEY': secrets.token_urlsafe(48),
        'HAMZURY_PUBLIC_BASE_URL': 'http://127.0.0.1:8000',
        'HAMZURY_SECURE_COOKIES': '0',
        'HAMZURY_REQUIRE_STAFF_MFA': '0',
        'HAMZURY_REQUIRE_UPLOAD_SCAN': '0',
    }.items():
        lines = settings.splitlines()
        settings = '\n'.join(f'{key}={value}' if line.startswith(key + '=') else line for line in lines) + '\n'
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as out:
        out.write(settings)
    print('Created .env with private development secrets. Read it locally; do not share its contents.')
    print('For production, configure HTTPS, real business details, scanning and MFA, then set HAMZURY_ENV=production.')
    print('An existing owner keeps their password. Recover access with: python tools/manage.py reset-password owner')


if __name__ == '__main__':
    main()
