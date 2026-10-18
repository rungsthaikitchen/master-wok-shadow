"""Prepared minimal reader to controller binding; private stdin, no file spool."""
import json
import os
from pathlib import Path
import subprocess
from delivery_comparison_journal import ComparisonError,canonical

BRIDGE=Path(__file__).resolve().parent.parent/'master-wok-private-route-bridge.js'

class PrivateCandidateBridge:
    def __init__(self,reader,*,enabled=False,allow_capture=False,api_key=None,staging=False,invoke=None):
        self.reader=reader;self.enabled=enabled is True;self.allow_capture=allow_capture is True
        self.api_key=api_key;self.staging=staging is True;self.invoke=invoke or self._invoke
        self.prepared=None;self.candidate=None

    def _invoke(self,payload,capture=False):
        env={k:v for k,v in os.environ.items() if k in ('PATH','LANG','TZ')}
        env['MASTER_WOK_PRIVATE_BRIDGE_ENABLED']='true'
        if capture:
            env.update(MASTER_WOK_PRIVATE_BRIDGE_LIVE_REQUESTS='true',MASTER_WOK_PRIVATE_BRIDGE_STAGE='staging',
                MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY=self.api_key)
        process=subprocess.run(['node',str(BRIDGE)],input=canonical(payload),text=True,capture_output=True,
            timeout=20,env=env)
        if process.returncode or len(process.stdout.encode())>16384:
            raise ComparisonError('PRIVATE_BRIDGE_FAILED')
        return json.loads(process.stdout)

    def read_candidate(self):
        self.prepared=None;self.candidate=None
        if not self.enabled:return None
        private=self.reader()
        if private is None:return None
        if not isinstance(private,dict) or set(private)!={'privateJson','bindingHash','sourceIdentity','observedStatus','serviceDate','sourceObservedAt'}:
            raise ComparisonError('MINIMAL_READER_CONTRACT_REQUIRED')
        payload={k:private[k] for k in ('privateJson','bindingHash','sourceIdentity')}
        result=self.invoke(dict(payload,mode='PREPARE'),False)
        candidate=result.get('candidate')
        if (result.get('status')!='PREPARED' or not isinstance(candidate,dict) or
            result.get('bindingHash')!=private['bindingHash'] or
            candidate.get('sourceIdentity')!=private['sourceIdentity'] or
            candidate.get('observedStatus')!=private['observedStatus'] or
            candidate.get('serviceDate')!=private['serviceDate']):
            raise ComparisonError('MINIMAL_BRIDGE_BINDING_FAILED')
        self.prepared=payload;self.candidate=dict(candidate)
        return dict(candidate)

    def capture(self,candidate):
        if (not self.enabled or not self.allow_capture or not self.staging or
            not isinstance(self.api_key,str) or not self.api_key or self.prepared is None or candidate!=self.candidate):
            raise ComparisonError('EXPLICIT_PRIVATE_CAPTURE_REQUIRED')
        payload=dict(self.prepared,mode='CAPTURE',candidate=dict(candidate))
        # Consume private input before crossing the process boundary. Timeout or
        # malformed response can never implicitly replay the same capture.
        self.prepared=None;self.candidate=None
        result=self.invoke(payload,True)
        if result.get('status')!='CAPTURED' or not isinstance(result.get('envelope'),dict):
            raise ComparisonError('PRIVATE_CAPTURE_UNVERIFIED')
        return result['envelope']
