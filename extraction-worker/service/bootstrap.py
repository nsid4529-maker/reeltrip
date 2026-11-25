"""Prepare the mounted SQLite directory, then permanently drop root privileges."""
import os
from pathlib import Path
import pwd
import sys


def prepare_volume() -> None:
    root = Path(os.environ.get('REELTRIP_DATA_DIR', '/data')).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if os.geteuid() == 0:
        account = pwd.getpwnam('reeltrip')
        os.chown(root, account.pw_uid, account.pw_gid)
        os.chmod(root, 0o700)
        # Existing files can have been created by an earlier root deployment.
        for name in ('jobs.sqlite3', 'jobs.sqlite3-wal', 'jobs.sqlite3-shm'):
            file = root / name
            if file.is_symlink():
                raise OSError('Unsafe volume')
            if file.exists():
                os.chown(file, account.pw_uid, account.pw_gid)
                os.chmod(file, 0o600)
        os.setgroups([])
        os.setgid(account.pw_gid)
        os.setuid(account.pw_uid)
    os.umask(0o077)


def main() -> None:
    try:
        prepare_volume()
    except (OSError, KeyError):
        print('Video processor could not prepare its persistent storage.', file=sys.stderr)
        raise SystemExit(1) from None
    os.execv(sys.executable, [sys.executable, '-m', 'service.server'])


if __name__ == '__main__':
    main()
