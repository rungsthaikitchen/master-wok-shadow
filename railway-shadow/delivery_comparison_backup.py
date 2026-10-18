"""Local comparison snapshots and verified offline restore. No cloud upload."""
import hashlib
import os
from pathlib import Path
import sqlite3
from delivery_comparison_journal import APP_ID, VERSION, ComparisonError


def verify(db, identity, scope):
    if (db.execute('PRAGMA application_id').fetchone()[0]!=APP_ID or
        db.execute('PRAGMA user_version').fetchone()[0]!=VERSION or
        db.execute('SELECT identity,scope FROM comparison_meta').fetchall()!=[(identity,scope)] or
        db.execute('PRAGMA integrity_check').fetchone()!=('ok',) or
        db.execute('PRAGMA foreign_key_check').fetchall()):
        raise ComparisonError('COMPARISON_BACKUP_UNVERIFIED')
    return {t:db.execute('SELECT count(*) FROM '+t).fetchone()[0]
            for t in ('observations','snapshots','members','latest','observation_events')}


def backup(journal, destination):
    p=Path(destination)
    if not p.is_absolute() or p.exists() or p.is_symlink():
        raise ComparisonError('NEW_BACKUP_DESTINATION_REQUIRED')
    fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    target=None
    try:
        expected=verify(journal.db,journal.identity,journal.scope)
        target=sqlite3.connect(p)
        journal.db.backup(target)
        if verify(target,journal.identity,journal.scope)!=expected:
            raise ComparisonError('COMPARISON_BACKUP_COUNTS_MISMATCH')
        target.close();target=None
        with p.open('rb') as f:os.fsync(f.fileno())
        return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'counts':expected}
    except Exception:
        if target:target.close()
        p.unlink(missing_ok=True)
        raise


def restore(source, destination, identity, scope, expected_hash):
    p=Path(source);dest=Path(destination)
    if not p.is_absolute() or not dest.is_absolute() or p.is_symlink() or dest.is_symlink() or dest.exists():
        raise ComparisonError('NEW_RESTORE_DESTINATION_REQUIRED')
    # Backup size capped before allocating bytes; recovery never installs over live data.
    if not p.is_file() or p.stat().st_size>50_000_000:
        raise ComparisonError('RESTORE_SIZE_UNVERIFIED')
    if hashlib.sha256(p.read_bytes()).hexdigest()!=expected_hash:
        raise ComparisonError('RESTORE_HASH_MISMATCH')
    db=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
    try:
        db.execute('PRAGMA query_only=ON');verify(db,identity,scope)
        fd=os.open(dest,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
        target=None
        try:
            target=sqlite3.connect(dest);db.backup(target)
            counts=verify(target,identity,scope);target.close();target=None
            with dest.open('rb') as f:os.fsync(f.fileno())
            return counts
        except Exception:
            if target:target.close()
            dest.unlink(missing_ok=True)
            raise
    finally:db.close()
