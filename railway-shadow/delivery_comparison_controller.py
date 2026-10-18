"""Default-off continuous-cycle controller with durable, fail-closed quotas.

Acquisition and route assessment are injected; no provider or source client is
constructed here. A reservation is consumed before capture and never refunded.
"""
from datetime import date
import hashlib
import math
import time
from delivery_comparison_journal import ComparisonError, canonical
from delivery_evidence_journal import is_hash

class ComparisonController:
    def __init__(self,journal,*,enabled=False,allow_capture=False,request_limit=0,clock=time.time):
        self.journal=journal;self.enabled=enabled is True;self.clock=clock
        if type(request_limit) is not int or not 0<=request_limit<=100:
            raise ComparisonError('EXPLICIT_BOUNDED_REQUEST_LIMIT_REQUIRED')
        self.limit=request_limit
        self.allow_capture=allow_capture is True
        self.last_success=None;self.failed=True;self.last_backup=None
        if not self.enabled:return
        if journal.scope!='RETROSPECTIVE_CONDITIONAL':
            raise ComparisonError('CONDITIONAL_JOURNAL_REQUIRED')
        with journal.db:
            journal.db.execute('CREATE TABLE IF NOT EXISTS controller_meta(request_limit INTEGER NOT NULL)')
            limits=journal.db.execute('SELECT request_limit FROM controller_meta').fetchall()
            if limits and limits!=[(request_limit,)]:
                raise ComparisonError('PERSISTED_REQUEST_LIMIT_MISMATCH')
            if not limits:journal.db.execute('INSERT INTO controller_meta VALUES (?)',(request_limit,))
            journal.db.execute("CREATE TABLE IF NOT EXISTS capture_reservations(key TEXT PRIMARY KEY, requests INTEGER NOT NULL CHECK(requests=2), at REAL NOT NULL, state TEXT NOT NULL)")
            journal.db.execute('CREATE TABLE IF NOT EXISTS controller_events(id INTEGER PRIMARY KEY, status TEXT NOT NULL, reason TEXT NOT NULL, at REAL NOT NULL)')

    def _event(self,status,reason):
        with self.journal.db:
            self.journal.db.execute('INSERT INTO controller_events(status,reason,at) VALUES (?,?,?)',
                (status,reason,self.clock()))
        return dict(status=status,reasonCode=reason,verified=False)

    def _reserve(self,candidate):
        if not isinstance(candidate,dict) or set(candidate)!={'sourceHash','buildHash','sourceIdentity','observedStatus','serviceDate'}:
            raise ComparisonError('MINIMAL_CANDIDATE_REQUIRED')
        if (candidate['sourceIdentity']!=self.journal.identity or
            not is_hash(candidate['sourceHash']) or not is_hash(candidate['buildHash']) or
            candidate['observedStatus'] not in {'confirmed','completed'} or
            date.fromisoformat(candidate['serviceDate']).isoformat()!=candidate['serviceDate']):
            raise ComparisonError('CANDIDATE_BINDING_REQUIRED')
        key=hashlib.sha256(canonical(candidate).encode()).hexdigest()
        db=self.journal.db
        # Journal holds the exclusive process lock. SQLite transaction also makes
        # reservation/limit checking indivisible and part of every backup.
        with db:
            old=db.execute('SELECT state FROM capture_reservations WHERE key=?',(key,)).fetchone()
            if old:return 'ALREADY_RECORDED' if old[0]=='RECORDED' else 'PRIOR_CAPTURE_UNVERIFIED'
            used=db.execute('SELECT COALESCE(SUM(requests),0) FROM capture_reservations').fetchone()[0]
            if used+2>self.limit:return 'REQUEST_BUDGET_EXHAUSTED'
            db.execute("INSERT INTO capture_reservations VALUES (?,2,?,'RESERVED')",(key,self.clock()))
        return None

    def cycle(self,read_candidate,capture,backup):
        if not self.enabled:return dict(status='DISABLED',verified=False,networkRequests=0)
        self.failed=True
        try:
            candidate=read_candidate()
            if candidate is None:
                reason='NO_CANDIDATE'
            elif not self.allow_capture:
                reason='CAPTURE_DISABLED'
            else:
                reason=self._reserve(candidate)
                if reason is None:
                    envelope=capture(dict(candidate))
                    if (not isinstance(envelope,dict) or set(envelope)!={'result','capturedAt'} or
                        envelope['result'].get('serviceDate')!=candidate['serviceDate']):
                        raise ComparisonError('CAPTURE_BINDING_REQUIRED')
                    self.journal.append_retrospective(envelope['result'],source_hash=candidate['sourceHash'],
                        build_hash=candidate['buildHash'],observed_status=candidate['observedStatus'],
                        captured_at=envelope['capturedAt'],at=self.clock())
                    with self.journal.db:
                        self.journal.db.execute("UPDATE capture_reservations SET state='RECORDED' WHERE key=?",
                            (hashlib.sha256(canonical(candidate).encode()).hexdigest(),))
                    reason='CONDITIONAL_AGGREGATE_RECORDED'
            blocked=reason in {'REQUEST_BUDGET_EXHAUSTED','PRIOR_CAPTURE_UNVERIFIED'}
            result=self._event('UNVERIFIED' if blocked else 'OBSERVED',reason)
            # Require a verified receipt even when no new assessment was made.
            # The adapter owns snapshot cadence and must include reservations.
            receipt=backup()
            if receipt.get('status')!='BACKUP_VERIFIED' or receipt.get('verifiedRestore') is not True:
                raise ComparisonError('BACKUP_UNVERIFIED')
            verified_at=receipt.get('verifiedAt')
            if (type(verified_at) not in (int,float) or not math.isfinite(verified_at) or
                not 0<=self.clock()-verified_at<=7200):
                raise ComparisonError('BACKUP_CLOCK_UNVERIFIED')
            self.last_backup=verified_at
            self.last_success=self.clock();self.failed=blocked
            result['reservedRequests']=self.journal.db.execute('SELECT COALESCE(SUM(requests),0) FROM capture_reservations').fetchone()[0]
            return result
        except Exception:
            # Raw exception/provider details never reach logs or persisted events.
            return self._event('UNVERIFIED','COMPARISON_CONTROLLER_CYCLE_FAILED')

    def healthy(self):
        now=self.clock()
        return (not self.failed and self.last_success is not None and self.last_backup is not None and
            math.isfinite(now) and 0<=now-self.last_success<=180 and 0<=now-self.last_backup<=7200)

    def run(self,stop,read_candidate,capture,backup,emit):
        """Caller owns authenticated health listener and graceful stop signal."""
        if not self.enabled:
            emit(self.cycle(read_candidate,capture,backup));return
        while not stop.is_set():
            emit(self.cycle(read_candidate,capture,backup))
            stop.wait(60)
