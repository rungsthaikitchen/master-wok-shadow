import copy
from dataclasses import replace
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,urlopen

import delivery_evidence_collector as c
from delivery_shadow_source import prepare_snapshot
from shadow_collector import timestamp
from test_delivery_shadow_source import fixture,SECRET

AT=timestamp('2026-10-17T16:00:00Z').timestamp()

class DeliveryEvidenceCollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.clock=[AT]
        self.cfg=c.Config('private-token',SECRET,'x'*48,str(Path(self.temp.name)/'delivery-evidence.sqlite3'),8080)
        self.calls=[];self.failed_days=set()
        def reader(day):
            self.calls.append(day)
            if day in self.failed_days:raise RuntimeError('PRIVATE_SOURCE_ERROR_TOKEN')
            raw=fixture();raw[0]['observed_at']=c.datetime.fromtimestamp(self.clock[0],c.timezone.utc).isoformat()
            raw[0]['orders'][0]['id']='private-order-'+day
            raw[0]['orders'][0]['preferred_time']=day+'T19:00:00Z'
            raw[0]['items'][0]['order_id']=raw[0]['orders'][0]['id']
            return prepare_snapshot(raw,day,c.PROJECT,SECRET)
        self.reader=reader
        self.collector=c.EvidenceCollector(self.cfg,reader=reader,clock=lambda:self.clock[0])
    def tearDown(self):
        self.collector.close();self.temp.cleanup()
    def env(self):
        return {'MASTER_WOK_DELIVERY_EVIDENCE_ENABLED':'true','RAILWAY_PROJECT_ID':c.RAILWAY_PROJECT,
          'RAILWAY_ENVIRONMENT_ID':c.ENVIRONMENT,'RAILWAY_ENVIRONMENT_NAME':c.ENVIRONMENT_NAME,
          'RAILWAY_SERVICE_NAME':c.SERVICE_NAME,'RAILWAY_VOLUME_MOUNT_PATH':'/data',
          'MASTER_WOK_MANAGEMENT_READ_TOKEN':'private-token','MASTER_WOK_PSEUDONYM_KEY':SECRET,
          'MASTER_WOK_DELIVERY_EVIDENCE_HEALTH_TOKEN':'x'*48}
    def request(self,server,path='/healthz',token='x'*48):
        headers={'Authorization':'Bearer '+token} if token is not None else {}
        try:response=urlopen(Request('http://127.0.0.1:'+str(server.server_address[1])+path,headers=headers),timeout=3)
        except HTTPError as error:response=error
        with response:return response.status,json.load(response),response.headers

    def test_default_off_does_not_inspect_config_or_access_source(self):
        for enabled in (None,'false','TRUE','1'):
            self.assertIsNone(c.configuration({'MASTER_WOK_DELIVERY_EVIDENCE_ENABLED':enabled}))
        result=subprocess.run([sys.executable,str(Path(c.__file__))],env={**os.environ,'MASTER_WOK_DELIVERY_EVIDENCE_ENABLED':'false'},capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0);self.assertEqual(json.loads(result.stdout)['networkRequests'],0)
        self.assertEqual(self.calls,[])

    def test_exact_project_environment_service_and_volume_scope(self):
        self.assertEqual(c.configuration(self.env()).db,c.DEFAULT_DB)
        for field,value in [('RAILWAY_PROJECT_ID','other'),('RAILWAY_ENVIRONMENT_ID','c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279'),
          ('RAILWAY_ENVIRONMENT_NAME','production'),('RAILWAY_SERVICE_NAME','master-wok-production-shadow'),('RAILWAY_VOLUME_MOUNT_PATH','')]:
            with self.assertRaises(c.EvidenceError):c.configuration({**self.env(),field:value})

    def test_private_configuration_path_and_port(self):
        for field,value in [('MASTER_WOK_MANAGEMENT_READ_TOKEN',''),('MASTER_WOK_PSEUDONYM_KEY','short'),
          ('MASTER_WOK_DELIVERY_EVIDENCE_HEALTH_TOKEN','short'),('MASTER_WOK_DELIVERY_EVIDENCE_DB','/data/production-shadow.sqlite3'),('PORT','0'),('PORT','65536')]:
            with self.assertRaises((c.EvidenceError,ValueError)):c.configuration({**self.env(),field:value})
        self.assertNotIn('private-token',repr(self.cfg));self.assertNotIn(SECRET,repr(self.cfg))

    def test_current_and_next_london_dates_across_midnight_and_dst(self):
        examples=[('2026-10-17T22:59:59Z',['2026-10-17','2026-10-18']),
          ('2026-10-17T23:00:00Z',['2026-10-18','2026-10-19']),
          ('2026-10-25T01:30:00Z',['2026-10-25','2026-10-26']),
          ('2026-03-29T00:59:00Z',['2026-03-29','2026-03-30'])]
        for instant,days in examples:self.assertEqual(c.service_dates(timestamp(instant).timestamp()),days)

    def test_identity_matches_the_proven_source_normalizer(self):
        snapshot=self.reader('2026-10-17')
        self.assertEqual(c.source_identity(SECRET),snapshot['sourceIdentity'])
        self.assertEqual(self.collector.journal.identity,snapshot['sourceIdentity'])

    def test_complete_two_day_cycle_uses_real_audit_and_deduplicates(self):
        self.assertEqual(self.collector.health()['status'],'UNHEALTHY')
        first=self.collector.cycle()
        self.assertEqual(self.calls,['2026-10-17','2026-10-18'])
        self.assertTrue(all(e['status']=='OBSERVED' and e['prediction']=='UNVERIFIED' for e in first))
        self.assertFalse(first[0]['healthy']);self.assertTrue(first[1]['healthy'])
        self.clock[0]+=60;self.collector.cycle()
        self.assertEqual(self.collector.journal.db.execute('SELECT count(*) FROM evidence_states').fetchone()[0],2)
        self.assertEqual(self.collector.journal.db.execute('SELECT count(*) FROM evidence_polls').fetchone()[0],4)

    def test_partial_day_failure_is_unhealthy_and_recovers_without_data_loss(self):
        self.collector.cycle();self.failed_days.add('2026-10-18');self.clock[0]+=60
        events=self.collector.cycle()
        self.assertEqual(events[1]['reasonCode'],'SOURCE_FAILED')
        self.assertEqual(self.collector.health()['status'],'UNHEALTHY')
        self.assertEqual(self.collector.journal.db.execute('SELECT count(*) FROM evidence_presence').fetchone()[0],2)
        self.failed_days.clear();self.clock[0]+=60;self.collector.cycle()
        self.assertEqual(self.collector.health()['status'],'HEALTHY')

    def test_day_rollover_requires_new_tomorrow_and_ignores_archived_failure(self):
        self.collector.cycle();self.collector.journal.failure('2026-10-17',self.clock[0],'SOURCE_FAILED')
        self.clock[0]=timestamp('2026-10-17T23:00:00Z').timestamp()
        self.assertEqual(self.collector.health()['status'],'UNHEALTHY')
        events=self.collector.cycle()
        self.assertEqual([e['serviceDate'] for e in events],['2026-10-18','2026-10-19'])
        self.assertEqual(self.collector.health()['status'],'HEALTHY')
        self.assertEqual(self.collector.journal.db.execute('SELECT count(*) FROM evidence_presence').fetchone()[0],3)

    def test_restart_preserves_identity_and_states(self):
        self.collector.cycle();self.collector.close()
        self.collector=c.EvidenceCollector(self.cfg,reader=self.reader,clock=lambda:self.clock[0])
        self.clock[0]+=60;self.collector.cycle()
        self.assertEqual(self.collector.journal.db.execute('SELECT count(*) FROM evidence_states').fetchone()[0],2)
        self.assertEqual(self.collector.health()['status'],'HEALTHY')

    def test_shutdown_stops_before_next_day_and_health_goes_unhealthy(self):
        def emit(_):self.collector.stopping.set()
        events=self.collector.cycle(emit)
        self.assertEqual(len(events),1);self.assertEqual(len(self.calls),1)
        self.assertEqual(self.collector.health()['status'],'UNHEALTHY')

    def test_source_http_error_response_is_closed_and_redacted(self):
        response=io.BytesIO(b'PRIVATE_RESPONSE')
        error=HTTPError('https://private.invalid',401,'PRIVATE_TOKEN',{},response)
        with patch.object(c,'read_delivery_snapshot',side_effect=error):
            with self.assertRaisesRegex(c.EvidenceError,'SOURCE_FAILED'):self.collector.fetch('2026-10-17')
        self.assertTrue(response.closed)
        with patch.object(c,'read_delivery_snapshot',return_value={}) as reader:
            self.collector.fetch('2026-10-17')
            self.assertEqual(reader.call_args.args[0],c.SOURCE)
            self.assertEqual(reader.call_args.args[3],'2026-10-17')
            self.assertEqual(reader.call_args.kwargs,{'enabled':True})

    def test_authenticated_health_status_and_payload_expose_no_orders(self):
        server=c.serve_health(self.collector,0)
        try:
            self.assertEqual(self.request(server,token=None)[0],401)
            self.assertEqual(self.request(server,token='wrong')[0],401)
            self.assertEqual(self.request(server,path='/other')[0],404)
            self.assertEqual(self.request(server)[0],503)
            self.collector.cycle()
            status,body,headers=self.request(server)
            self.assertEqual(status,200);self.assertEqual(headers['Cache-Control'],'no-store')
            self.assertEqual(body,{'status':'HEALTHY','scope':'SAVED_STATE_EVIDENCE_ONLY','prediction':'UNVERIFIED','verified':False})
            self.clock[0]+=181;self.assertEqual(self.request(server)[0],503)
        finally:server.shutdown();server.server_close()

    def test_no_date_or_staging_fault_override_and_no_google_provider(self):
        config=c.configuration({**self.env(),'MASTER_WOK_SERVICE_DATE':'2099-01-17','MASTER_WOK_EVIDENCE_STAGING_FAULT_ONCE':'true'})
        self.assertEqual(config.db,c.DEFAULT_DB)
        self.collector.cycle();self.assertNotIn('2099-01-17',self.calls)
        code=Path(c.__file__).read_text()
        self.assertNotIn('google',code.lower());self.assertNotIn('staging-delivery',code)

    def test_main_refuses_ephemeral_disk_before_initialising_journal_or_network(self):
        with patch.dict(os.environ,self.env(),clear=True),patch.object(c.os.path,'ismount',return_value=False),patch.object(c,'EvidenceCollector') as factory,patch('builtins.print') as output:
            self.assertEqual(c.main(),1);factory.assert_not_called()
            self.assertIn('VOLUME_FAILED',output.call_args.args[0])

    def test_health_port_failure_closes_journal_without_source_reads(self):
        self.collector.close()
        with patch.dict(os.environ,self.env(),clear=True),patch.object(c.os.path,'ismount',return_value=True),patch.object(c,'EvidenceCollector',return_value=c.EvidenceCollector(self.cfg,reader=self.reader,clock=lambda:self.clock[0])) as factory,patch.object(c,'serve_health',side_effect=OSError('PRIVATE_PORT_ERROR')),patch('builtins.print') as output:
            self.assertEqual(c.main(),1);self.assertEqual(self.calls,[])
            self.assertIn('HEALTH_BIND_FAILED',output.call_args.args[0])
        self.collector=c.EvidenceCollector(self.cfg,reader=self.reader,clock=lambda:self.clock[0])

    def test_enabled_backup_failure_is_visible_to_existing_private_health(self):
        from unittest.mock import Mock
        self.collector.cycle()
        backup=Mock();backup.healthy.return_value=False;self.collector.backups=backup
        server=c.serve_health(self.collector,0)
        try:
            self.assertEqual(self.request(server)[0],503)
            backup.healthy.return_value=True
            self.assertEqual(self.request(server)[0],200)
            self.failed_days.add('2026-10-18');self.collector.cycle()
            self.assertEqual(self.request(server)[0],503)
        finally:server.shutdown();server.server_close()

if __name__=='__main__':unittest.main()
