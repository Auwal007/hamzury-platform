"""Restore a backup into an EMPTY directory; never overwrite a live database."""
import argparse
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
from pathlib import Path


def restore(source, destination, identity=None):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise ValueError('restore destination must be an empty directory')
    with tempfile.TemporaryDirectory(prefix='hamzury-restore-') as tmp:
        tmp = Path(tmp)
        archive = source
        if source.suffix == '.age':
            if not identity:
                raise ValueError('encrypted backups need --identity pointing to the age private key')
            archive = tmp / 'backup.tgz'
            subprocess.run(['age', '-d', '-i', str(identity), '-o', str(archive), str(source)], check=True)
        unpacked = tmp / 'unpacked'
        with tarfile.open(archive, 'r:gz') as tar:
            for item in tar.getmembers():
                parts = Path(item.name).parts
                if (item.issym() or item.islnk() or not (item.isfile() or item.isdir()) or not parts
                        or parts[0] not in ('hamzury.sqlite3', 'files') or '..' in parts):
                    raise ValueError('unsafe backup member')
            tar.extractall(unpacked, filter='data')
        database = unpacked / 'hamzury.sqlite3'
        if not database.is_file():
            raise ValueError('backup has no database')
        connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
        try:
            if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('backup database integrity check failed')
        finally:
            connection.close()
        shutil.copytree(unpacked, destination, dirs_exist_ok=True)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--identity', type=Path)
    args = parser.parse_args()
    try:
        target = restore(args.backup, args.destination, args.identity)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(f'Backup verified and restored into {target}. Configure HAMZURY_DB to use hamzury.sqlite3 there.')


if __name__ == '__main__':
    main()
