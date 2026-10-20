"""Review-only Flask integration for private synthetic staging; default off."""
import json
import re
from flask import Blueprint,jsonify,request

def register_staging_routes(app,env,*,transport=None):
    if env.get('MASTER_WOK_BACKEND_EVENT_STAGING_ENABLED')!='true':return False
    expected={
        'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
        'RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
        'RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83',
        'MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS',
        'MASTER_WOK_BACKEND_EVENT_PROJECT':'hvrqgufqjslvgiohgkvu'}
    if any(env.get(k)!=v for k,v in expected.items()):raise ValueError('BACKEND_STAGING_SCOPE_REQUIRED')
    from event_capture_journal import EventCaptureError
    from event_customer_response_staging import respond
    from event_postgres_export import source_identity
    from event_runtime_transport import DatabaseTransport
    stream=env.get('MASTER_WOK_EVENT_STREAM_ID');source_identity(stream)
    secret=env.get('MASTER_WOK_BACKEND_EVENT_SIGNING_KEY','')
    if not re.fullmatch('[a-f0-9]{64}',secret):raise ValueError('STAGING_SIGNING_KEY_REQUIRED')
    secret=bytes.fromhex(secret)
    writer=transport if transport is not None else DatabaseTransport(env.get('MASTER_WOK_EVENT_WRITER_DSN'),'writer')
    routes=Blueprint('master_wok_staging_response',__name__)
    def response(body,status):
        result=jsonify(body);result.status_code=status
        result.headers['Cache-Control']='no-store'
        result.headers['Referrer-Policy']='no-referrer'
        return result
    @routes.route('/master-wok-staging/proposal-response',methods=['POST'])
    def proposal_response():
        if request.content_length is None or not 1<=request.content_length<=2048 or request.mimetype!='application/json':
            return response(dict(success=False,status='INVALID_REQUEST'),400)
        try:
            def unique_pairs(pairs):
                result={}
                for key,value in pairs:
                    if key in result:raise ValueError('duplicate field')
                    result[key]=value
                return result
            body=json.loads(request.get_data(cache=False),object_pairs_hook=unique_pairs)
            result=respond('POST',body,stream,enabled=True,secret=secret,transport=writer)
            # This is the response's original receipt, not a current order summary.
            return response(dict(success=True,status=result['status'],verified=False),200)
        except EventCaptureError as error:
            reason=str(error)
            invalid=reason in {'RESPONSE_BODY_REQUIRED','RESPONSE_TOKEN_REFUSED','RESPONSE_POST_REQUIRED'}
            return response(dict(success=False,status='INVALID_RESPONSE' if invalid else 'NOT_APPLIED',verified=False),400 if invalid else 503)
        except (ValueError,TypeError,KeyError):
            return response(dict(success=False,status='INVALID_REQUEST',verified=False),400)
        except Exception:
            return response(dict(success=False,status='NOT_APPLIED',verified=False),503)
    app.register_blueprint(routes)
    return True
