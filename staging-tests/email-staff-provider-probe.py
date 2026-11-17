"""One-off owner-approved email and staff-push test. No orders or outbox access."""
import hashlib
import json
import os

EMAIL = "david@rungsthaikitchen.co.uk"
EMAIL_SUBJECT = "RTK staging email test — no order booked"
EMAIL_BODY = "Master Wok staging email test. No order has been booked. Please confirm receipt in our chat. Thanks, David."
PUSH_TITLE = "RTK STAGING TEST"
PUSH_BODY = "Master Wok staff-alert test. No real order — please acknowledge this test alert and confirm receipt in our chat."


def run_probe(environ, provider_factory):
    if environ.get("MASTER_WOK_CHANNEL_PROBE_ENABLED") != "true":
        raise ValueError("CHANNEL_PROBE_DISABLED")
    if environ.get("SUPABASE_URL") != "https://hvrqgufqjslvgiohgkvu.supabase.co":
        raise ValueError("PRIVATE_STAGING_REQUIRED")
    if environ.get("MASTER_WOK_CHANNEL_PROBE_EMAIL") != EMAIL:
        raise ValueError("APPROVED_EMAIL_REQUIRED")
    if not all(environ.get(k) for k in ("BREVO_API_KEY", "PUSHOVER_APP_TOKEN", "PUSHOVER_USER_KEY")):
        raise ValueError("PROVIDER_CONFIGURATION_REQUIRED")
    channels = environ.get("MASTER_WOK_CHANNEL_PROBE_CHANNELS", "email,pushover")
    if channels not in ("email", "email,pushover"):
        raise ValueError("APPROVED_CHANNELS_REQUIRED")
    providers = provider_factory()
    for message in [
        {"channel": "email", "recipient": EMAIL, "subject": EMAIL_SUBJECT, "body": EMAIL_BODY},
        {"channel": "pushover", "title": PUSH_TITLE, "body": PUSH_BODY},
    ]:
        if message["channel"] not in channels.split(","):
            continue
        result = providers.send(message)
        provider_id = str(result.get("providerId") or "")
        print(json.dumps({"scope": "ONE_OFF_EMAIL_STAFF_PROBE", "channel": message["channel"],
                          "outcome": result.get("outcome"),
                          "providerIdSha256": hashlib.sha256(provider_id.encode()).hexdigest() if provider_id else None}), flush=True)


def provider_factory():
    from master_wok_notification_worker import NotificationProviders
    import requests
    from urllib.parse import urlsplit

    def post(url, **kwargs):
        channel = "email" if urlsplit(url).hostname == "api.brevo.com" else "pushover"
        try:
            response = requests.post(url, **kwargs)
            print(json.dumps({"scope": "PROVIDER_HTTP_RESULT", "channel": channel,
                              "httpStatus": response.status_code}), flush=True)
            return response
        except requests.RequestException as error:
            print(json.dumps({"scope": "PROVIDER_HTTP_RESULT", "channel": channel,
                              "httpStatus": None, "errorType": type(error).__name__}), flush=True)
            raise

    return NotificationProviders(post=post)


if __name__ == "__main__":
    import time
    import re
    import requests
    if os.getenv("SUPABASE_URL") != "https://hvrqgufqjslvgiohgkvu.supabase.co" or os.getenv("MASTER_WOK_CHANNEL_PROBE_ENABLED") != "true":
        raise SystemExit("PRIVATE_ENABLED_PROBE_REQUIRED")
    deadline = time.monotonic() + 180
    authorized = False
    while time.monotonic() < deadline:
        response = requests.get("https://api.brevo.com/v3/account", headers={"api-key": os.environ.get("BREVO_API_KEY", "")}, timeout=15)
        if response.status_code == 200:
            print(json.dumps({"scope": "EMAIL_ACCESS_PREFLIGHT", "httpStatus": 200, "messageSends": 0}), flush=True)
            authorized = True
            break
        ips = re.findall(r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b", response.text)
        print(json.dumps({"scope": "EMAIL_ACCESS_PREFLIGHT", "httpStatus": response.status_code, "blockedIps": sorted(set(ips)), "messageSends": 0}), flush=True)
        if response.status_code != 401:
            break
        time.sleep(10)
    if not authorized:
        raise SystemExit("EMAIL_ACCESS_NOT_AUTHORIZED_NO_MESSAGES_SENT")
    run_probe(os.environ, provider_factory)
