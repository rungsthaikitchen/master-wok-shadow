"""Default-off local synthetic backend transaction prototype; no remote writes."""
import copy
import json
import os
from pathlib import Path
import sqlite3
from event_capture_journal import canonical, digest, invoke_node, EventCaptureError
from shadow_collector import timestamp
SCOPE='LOCAL_SYNTHETIC_BACKEND'

class StagingEventSource:
    def __init__(self,path,service_date,*,enabled=False,scope=None):
        if enabled is not True:raise EventCaptureError('DISABLED')
        path=Path(path)
        if scope!=SCOPE or not path.is_absolute() or path.name!='synthetic-source.sqlite3' or any(p.is_symlink() for p in [path,*path.parents]):raise EventCaptureError('SYNTHETIC_SOURCE_REQUIRED')
        path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        existed=path.exists();self.db=sqlite3.connect(path,timeout=5,isolation_level=None)
        try:
            self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL');self.db.execute('BEGIN IMMEDIATE')
            if not existed:
                self.db.execute('CREATE TABLE meta(scope TEXT,day TEXT,watermark TEXT)')
                self.db.execute('INSERT INTO meta VALUES (?,?,NULL)',(SCOPE,service_date))
                self.db.execute('CREATE TABLE outbox(sequence INTEGER PRIMARY KEY,event_id TEXT UNIQUE,payload TEXT NOT NULL)')
                self.db.execute('CREATE TABLE bookings(order_id TEXT PRIMARY KEY,payload TEXT NOT NULL)')
            if self.db.execute('SELECT scope,day FROM meta').fetchall()!=[(SCOPE,service_date)]:raise EventCaptureError('SOURCE_IDENTITY_MISMATCH')
            self.db.commit();os.chmod(path,0o600);self.day=service_date
            self.identity=digest(dict(scope=SCOPE,serviceDate=service_date))
        except Exception:self.db.rollback();self.db.close();raise
    def close(self):self.db.close()
    def _batch(self,at):
        events=[json.loads(r[0]) for r in self.db.execute('SELECT payload FROM outbox ORDER BY sequence')]
        return dict(serviceDate=self.day,events=events,coverage=dict(basis='DECISION_EVENT_LOG',complete=True,eventCount=len(events),firstSequence=1,lastSequence=len(events),initialState='NO_PRIOR_SERVICE_COMMITMENTS',throughAt=at))
    def record(self,event,*,before_commit=lambda:None):
        event=copy.deepcopy(event)
        if 'sequence' in event:raise EventCaptureError('SOURCE_ASSIGNS_SEQUENCE')
        try:
            self.db.execute('BEGIN IMMEDIATE')
            old=self.db.execute('SELECT payload FROM outbox WHERE event_id=?',(event.get('eventId'),)).fetchone()
            if old:
                event['sequence']=json.loads(old[0])['sequence']
                if canonical(event)!=old[0]:raise EventCaptureError('EVENT_ID_REUSED')
                self.db.commit();return 'ALREADY_RECORDED'
            watermark=self.db.execute('SELECT watermark FROM meta').fetchone()[0]
            if watermark and timestamp(event['at'])<timestamp(watermark):raise EventCaptureError('SOURCE_WATERMARK_VIOLATION')
            event['sequence']=self.db.execute('SELECT count(*) FROM outbox').fetchone()[0]+1
            if event['sequence']>1000:raise EventCaptureError('SOURCE_LIMIT')
            self.db.execute('INSERT INTO outbox VALUES (?,?,?)',(event['sequence'],event['eventId'],canonical(event)))
            batch=self._batch(event['at'])
            if len(canonical(batch).encode())>5_000_000:raise EventCaptureError('SOURCE_LIMIT')
            invoke_node(batch,validate_only=True)
            # Synthetic action state: retained separately from kitchen/driver activity.
            order_id=event.get('orderId') or event['order']['orderId']
            if event['kind']=='PROPOSAL_RESPONSE':
                previous=json.loads(self.db.execute('SELECT payload FROM bookings WHERE order_id=?',(order_id,)).fetchone()[0])
                if event['response']=='REJECTED':self.db.execute('DELETE FROM bookings WHERE order_id=?',(order_id,))
                else:
                    previous['kind']='RESERVATION_SET';previous['commitment']='CONFIRMED'
                    previous.pop('actualDecision',None)
                    self.db.execute('UPDATE bookings SET payload=? WHERE order_id=?',(canonical(previous),order_id))
            elif event['kind'] in ('RESERVATION_RELEASED','RESERVATION_TRANSFERRED_OUT'):
                self.db.execute('DELETE FROM bookings WHERE order_id=?',(order_id,))
            elif event['kind']!='ORDER_STATE_CHANGED' and event.get('actualDecision')!='DECLINED':
                self.db.execute('INSERT OR REPLACE INTO bookings VALUES (?,?)',(order_id,canonical(event)))
            before_commit();self.db.commit();return 'RECORDED'
        except Exception:self.db.rollback();raise
    def export(self,through_at):
        try:
            self.db.execute('BEGIN IMMEDIATE')
            previous=self.db.execute('SELECT watermark FROM meta').fetchone()[0]
            if previous and timestamp(through_at)<timestamp(previous):raise EventCaptureError('WATERMARK_REGRESSION')
            batch=self._batch(through_at);invoke_node(batch,validate_only=True)
            self.db.execute('UPDATE meta SET watermark=?',(through_at,));self.db.commit();return batch
        except Exception:self.db.rollback();raise
