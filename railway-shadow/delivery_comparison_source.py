"""Injected saved-snapshot comparison bridge. No network client or source writes."""
import hashlib
from pathlib import Path
from delivery_evidence_journal import run_audit, build_hash
from delivery_comparison_journal import ComparisonError


def record_saved_snapshot(journal, reader, *, enabled=False, clock, assessor=run_audit):
    if enabled is not True:return {'status':'DISABLED','verified':False}
    try:
        if journal.scope!='SAVED_STATE_ONLY':raise ComparisonError('SAVED_STATE_SCOPE_REQUIRED')
        source=reader()
        if (not isinstance(source,dict) or source.get('sourceRole')!='supabase_read_only_user' or
            source.get('sourceIdentity')!=journal.identity or
            source.get('sourceEvidence')!='CURRENT_SAVED_STATE_NOT_DECISION_HISTORY'):
            raise ComparisonError('SOURCE_SCOPE_UNVERIFIED')
        audit=assessor(source)
        if audit.get('serviceDate')!=source.get('serviceDate') or audit.get('observedAt')!=source.get('observedAt'):
            raise ComparisonError('AUDIT_SNAPSHOT_MISMATCH')
        if (audit.get('snapshotHash')!=source.get('snapshotHash') or
            {r['orderId'] for r in audit.get('records',[])}!={r['orderId'] for r in source.get('orders',[])}):
            raise ComparisonError('AUDIT_SOURCE_MEMBERSHIP_MISMATCH')
        model=hashlib.sha256(build_hash().encode())
        for name in ('delivery_comparison_source.py','delivery_comparison_journal.py'):
            model.update(name.encode());model.update(Path(__file__).with_name(name).read_bytes())
        result=journal.append_saved_audit(audit,model.hexdigest(),clock())
        return {'status':result['status'],'records':result['records'],'prediction':'UNVERIFIED','verified':False}
    except Exception:
        return {'status':'UNVERIFIED','reasonCode':'SAVED_COMPARISON_FAILED','verified':False}
