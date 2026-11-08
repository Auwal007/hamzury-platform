"""a consistent backup of the database and files, kept for 30 days.

run inside the container:  docker compose exec -T hamzury python tools/backup.py
it writes a .tgz.age archive in production (.tgz for local development) and prints only its path.
"""
import datetime
import os
import re
import sqlite3
import subprocess
import tarfile
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from filelock import FileLock

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env', override=False)
DB = Path(os.getenv('HAMZURY_DB', str(ROOT / 'data' / 'hamzury-v4.sqlite3'))).resolve()
FILES = Path(os.getenv('HAMZURY_FILES', str(DB.parent / 'files')))
OUT = DB.parent / 'backups'
KEEP_DAYS = 30
RECIPIENT = os.getenv('HAMZURY_BACKUP_RECIPIENT', '')


def main():
    if os.getenv('HAMZURY_ENV') == 'production' and not RECIPIENT:
        raise RuntimeError('production backups require HAMZURY_BACKUP_RECIPIENT (an age public key)')
    if not DB.is_file():
        raise RuntimeError('database not found; refusing to back up an empty database')
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.date.today().isoformat()
    target = OUT / f"hamzury-{stamp}.tgz{'.age' if RECIPIENT else ''}"
    partial = target.with_name(target.name + '.partial')
    with FileLock(str(DB.parent / '.payments.lock'), timeout=60), FileLock(str(DB.parent / '.storage.lock'), timeout=60), tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / 'hamzury.sqlite3'
        src, dst = sqlite3.connect(DB), sqlite3.connect(copy)
        with dst:
            src.backup(dst)  # sqlite's own online backup: safe while the site is running
        src.close(); dst.close()
        try:
            if RECIPIENT:
                process = subprocess.Popen(['age', '-r', RECIPIENT, '-o', str(partial)], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    with tarfile.open(fileobj=process.stdin, mode='w|gz') as tar:
                        tar.add(copy, arcname='hamzury.sqlite3')
                        if FILES.exists():
                            tar.add(FILES, arcname='files')
                    process.stdin.close()
                    if process.wait(timeout=120) != 0:
                        raise RuntimeError('age backup encryption failed')
                except BaseException:
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=10)
                    raise
                finally:
                    process.stdin.close()
                    process.stderr.close()
            else:
                with tarfile.open(partial, 'w:gz') as tar:
                    tar.add(copy, arcname='hamzury.sqlite3')
                    if FILES.exists():
                        tar.add(FILES, arcname='files')
            partial.chmod(0o600)
            partial.replace(target)
        finally:
            partial.unlink(missing_ok=True)
    for old in OUT.glob('hamzury-*'):
        match = re.fullmatch(r'hamzury-(\d{4}-\d{2}-\d{2})\.tgz(?:\.age)?', old.name)
        if match and (datetime.date.today() - datetime.date.fromisoformat(match[1])).days > KEEP_DAYS:
            old.unlink()
    print(target)


if __name__ == '__main__':
    main()
