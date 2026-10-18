"""Offline restore drill into a NEW scratch directory. Never opens a live journal."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

from delivery_evidence_backup import MAX_BYTES,verify_snapshot
from delivery_evidence_journal import EvidenceError

def restore(snapshot,manifest,destination,identity):
    src,meta,target=map(Path,(snapshot,manifest,destination))
    if not re.fullmatch('[a-f0-9]{64}',identity):raise EvidenceError('TRUSTED_SOURCE_IDENTITY_REQUIRED')
    if not all(p.is_absolute() for p in (src,meta,target)):raise EvidenceError('ABSOLUTE_PATHS_REQUIRED')
    if (target.name!='delivery-evidence.sqlite3' or not target.parent.is_dir() or
        any(target.parent.iterdir()) or any(p.is_symlink() for p in (src,meta,target,target.parent))):
        raise EvidenceError('NEW_EMPTY_RESTORE_DIRECTORY_REQUIRED')
    if not 0<src.stat().st_size<=MAX_BYTES or meta.stat().st_size>8192:raise EvidenceError('RESTORE_SIZE_LIMIT')
    m=json.loads(meta.read_text())
    if (m.get('format')!='master-wok-delivery-evidence-v1' or m.get('sourceIdentity')!=identity or
        m.get('project') not in ('ubyjrrsvbbqomitpaidb','hvrqgufqjslvgiohgkvu') or
        not re.fullmatch('[a-f0-9]{64}',m.get('sha256',''))):raise EvidenceError('RESTORE_MANIFEST_REFUSED')
    data=src.read_bytes()
    if len(data)!=m.get('bytes') or hashlib.sha256(data).hexdigest()!=m['sha256']:raise EvidenceError('RESTORE_CHECKSUM_FAILED')
    fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    try:
        with os.fdopen(fd,'wb') as output:output.write(data);output.flush();os.fsync(output.fileno())
        counts=verify_snapshot(target,identity,m['project'])
        if counts!=m.get('counts'):raise EvidenceError('RESTORE_COUNTS_FAILED')
        return {'status':'RESTORE_VERIFIED','scope':'OFFLINE_SCRATCH_ONLY','counts':counts}
    except Exception:target.unlink(missing_ok=True);raise

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('snapshot','manifest','destination','source-identity'):p.add_argument('--'+name,required=True)
    args=p.parse_args()
    try:
        result=restore(args.snapshot,args.manifest,args.destination,args.source_identity)
        print(json.dumps(result));return 0
    except Exception:
        print(json.dumps({'status':'RESTORE_FAILED','scope':'OFFLINE_SCRATCH_ONLY'}));return 1

if __name__=='__main__':raise SystemExit(main())
