"""Default-off staging export adapter. Inject a read-only SQL transport; no daemon."""
import re
from event_capture_journal import canonical,digest,EventCaptureError
PROJECT='hvrqgufqjslvgiohgkvu'
QUERY="""SELECT id::text AS stream_id,scope,event_count,
 master_wok_event_test.export(id) AS batch
 FROM master_wok_event_test.streams WHERE id=$1::uuid"""

def source_identity(stream_id):
    if not isinstance(stream_id,str) or not re.fullmatch('[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}',stream_id):
        raise EventCaptureError('STREAM_ID_REQUIRED')
    return digest(dict(project=PROJECT,stream=stream_id,scope='SYNTHETIC_STAGING_EVENTS'))

def ingest_export(rows,journal,stream_id):
    identity=source_identity(stream_id)
    if journal.identity!=identity:raise EventCaptureError('SOURCE_IDENTITY_MISMATCH')
    if (not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict) or
        set(rows[0])!={'stream_id','scope','event_count','batch'}):raise EventCaptureError('EXPORT_ENVELOPE_REQUIRED')
    row=rows[0];batch=row['batch']
    if (row['stream_id']!=stream_id or row['scope']!='SYNTHETIC_STAGING_EVENTS' or
        type(row['event_count']) is not int or not 1<=row['event_count']<=1000 or
        not isinstance(batch,dict) or row['event_count']!=len(batch.get('events',[])) or
        len(canonical(rows).encode())>5_000_000):raise EventCaptureError('EXPORT_COVERAGE_REQUIRED')
    # The inbox validates full event schema/coverage before durable intake.
    return journal.enqueue(batch)

def poll(journal=None,stream_id=None,*,project=PROJECT,enabled=False,transport=None):
    if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
    source_identity(stream_id)
    if project!=PROJECT or not callable(transport):raise EventCaptureError('STAGING_READ_TRANSPORT_REQUIRED')
    rows=transport(dict(query=QUERY,parameters=[stream_id]))
    result=ingest_export(rows,journal,stream_id)
    return dict(result,sourceRequests=1,verified=False)
