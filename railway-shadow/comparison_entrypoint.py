"""Prepare only the dedicated comparison directory, then drop root privileges."""
import os
from pathlib import Path
from delivery_comparison_worker import configuration, main

UID=10001
GID=10001
DIRECTORY=Path('/data/master-wok-comparison')

def prepare(env):
    config=configuration(env)
    if config and config[0]!=DIRECTORY/'delivery-comparison.sqlite3':
        raise RuntimeError('DEDICATED_VOLUME_PATH_REQUIRED')
    if os.geteuid()==0:
        if config:
            if DIRECTORY.is_symlink():raise RuntimeError('SYMLINK_DIRECTORY_REFUSED')
            DIRECTORY.mkdir(mode=0o700,exist_ok=True)
            os.chown(DIRECTORY,UID,GID);os.chmod(DIRECTORY,0o700)
        os.setgroups([]);os.setgid(GID);os.setuid(UID)

if __name__=='__main__':
    prepare(os.environ)
    main()
