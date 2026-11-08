"""Start one persistent-disk app instance, using the host's PORT when supplied."""
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

root = Path(__file__).resolve().parents[1]
load_dotenv(root / '.env', override=False)
production = os.getenv('HAMZURY_ENV') == 'production'
if os.getenv('HAMZURY_REQUIRE_UPLOAD_SCAN', '1' if production else '0') == '1':
    # Fail startup if signatures cannot be initialized/refreshed. Never silently skip scanning.
    subprocess.run(['freshclam', '--stdout'], check=True)
port = int(os.getenv('PORT', '8000'))
if not 1 <= port <= 65535:
    raise ValueError('PORT must be between 1 and 65535')
os.chdir(root)
os.execv(sys.executable, [sys.executable, '-m', 'uvicorn', 'server:app', '--host', '0.0.0.0',
                        '--port', str(port), '--workers', '1', '--proxy-headers',
                        '--forwarded-allow-ips', os.getenv('HAMZURY_FORWARDED_ALLOW_IPS', '127.0.0.1')])
