"""Offline recovery verification in a fresh process; no database or cloud client."""
import argparse
import json
from pathlib import Path
from event_capture_journal import EventCaptureJournal, EventCaptureError, restore_snapshot
from event_recovery import fingerprint


def check(snapshot_path, manifest_path, destination):
    manifest = json.loads(Path(manifest_path).read_text())
    if manifest.get('format') != 'master-wok-events-v1' or manifest.get('restorePolicy') != 'SPEND_TRIAL_BUDGETS_ON_RESTORE':
        raise EventCaptureError('RECOVERY_MANIFEST_REFUSED')
    source = Path(snapshot_path)
    if not 0 < source.stat().st_size <= 5_000_000 or source.stat().st_size != manifest['bytes']:
        raise EventCaptureError('RECOVERY_SIZE_LIMIT')
    counts = restore_snapshot(source, destination, manifest['identity'], manifest['sha256'])
    journal = EventCaptureJournal(destination, manifest['identity'], enabled=True)
    try:
        if counts != manifest['counts'] or fingerprint(journal) != manifest['fingerprint']:
            raise EventCaptureError('RECOVERY_CONTENT_MISMATCH')
        if journal.run_once(enabled=True)['status'] != 'IDLE':
            raise EventCaptureError('RECOVERY_ACK_MISSING')
        return dict(status='OFFLINE_RECOVERY_VERIFIED', counts=counts, sourceRequests=0, verified=False)
    finally:
        journal.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot')
    parser.add_argument('manifest')
    parser.add_argument('destination')
    args = parser.parse_args()
    try:
        result = check(args.snapshot, args.manifest, args.destination)
    except Exception:
        print(json.dumps(dict(status='RECOVERY_FAILED', verified=False)))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
