"""Isolated exact handler extracts from deployment commit 51616be.
No server listener, provider imports or environment reads. Bound only by the trial.
"""
import json
import math
import re
from datetime import datetime, timezone
from flask import Flask, request, jsonify, make_response
from rtk_supabase_credentials import rest_headers
app = Flask('credential_backend_fixture')
LOYALTY_POINTS_PER_POUND = 1
LOYALTY_REWARD_POINTS = 100
LOYALTY_REWARD_VALUE = 5.00
ALLOWED_ORIGIN = '*'
supabase = None
requests = None
SUPABASE_URL = None
SUPABASE_SERVICE_ROLE_KEY = None
SUPABASE_ORDER_ACTION_URL = 'https://blocked.invalid/edge-action'
ADMIN_SECRET = 'synthetic-admin-only'
RTK_PROXY_SECRET = 'synthetic-proxy-only'
def supabase_headers():
    return rest_headers(SUPABASE_SERVICE_ROLE_KEY)


def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Max-Age"] = "86400"
    return response


@app.get("/")
def health():
    print("[INFO] Health check hit")
    resp = jsonify({"status": "ok"})
    return add_cors_headers(resp)


def settle_loyalty_for_order(order_id: str):
    order_res = (
        supabase.table("orders")
        .select("id,status,customer_id,loyalty_points_earned_pending,loyalty_points_redeem_pending,loyalty_settled,created_at")
        .eq("id", order_id)
        .limit(1)
        .execute()
    )

    if not order_res.data:
        return {"ok": False, "error": "Order not found"}, 404

    order = order_res.data[0]

    if order.get("status") != "completed":
        return {"ok": False, "error": "Order is not completed"}, 400

    if order.get("loyalty_settled") is True:
        return {"ok": True, "message": "Loyalty already settled"}, 200

    customer_phone = None
    customer_email = None
    customer_id = order.get("customer_id")

    if customer_id:
        cust_res = (
            supabase.table("customers")
            .select("phone,email")
            .eq("id", customer_id)
            .limit(1)
            .execute()
        )
        if cust_res.data:
            customer_phone = cust_res.data[0].get("phone")
            customer_email = cust_res.data[0].get("email")

    points_earned = int(order.get("loyalty_points_earned_pending") or 0)
    points_redeemed = int(order.get("loyalty_points_redeem_pending") or 0)

    loyalty_result = award_loyalty_points(
        phone=customer_phone,
        email=customer_email,
        order_created_at=order.get("created_at"),
        points_redeemed=points_redeemed,
        points_earned_override=points_earned
    )

    (
        supabase.table("orders")
        .update({
            "loyalty_settled": True
        })
        .eq("id", order_id)
        .execute()
    )

    return {"ok": True, "loyalty": loyalty_result}, 200


@app.route("/admin-order-action", methods=["POST", "OPTIONS"])
def admin_order_action():
    if request.method == "OPTIONS":
        resp = make_response("")
        return add_cors_headers(resp)

    try:
        if not RTK_PROXY_SECRET:
            resp = jsonify({"error": "RTK_PROXY_SECRET not configured"})
            return add_cors_headers(resp), 500

        supplied_proxy_secret = request.headers.get("x-rtk-proxy-secret")

        if supplied_proxy_secret != RTK_PROXY_SECRET:
            resp = jsonify({"error": "Unauthorized"})
            return add_cors_headers(resp), 401

        if not ADMIN_SECRET:
            resp = jsonify({"error": "ADMIN_SECRET not configured"})
            return add_cors_headers(resp), 500

        payload = request.get_json(silent=True)
        if not payload:
            resp = jsonify({"error": "Missing JSON payload"})
            return add_cors_headers(resp), 400

        print("[ADMIN] Forwarding order action:", payload, flush=True)

        r = requests.post(
            SUPABASE_ORDER_ACTION_URL,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "x-admin-secret": ADMIN_SECRET,
            },
            timeout=20,
        )

        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text}

        action = (payload.get("action") or "").strip().lower()
        order_id = payload.get("orderId")

        if r.ok and action == "complete" and order_id:
            try:
                loyalty_body, loyalty_status = settle_loyalty_for_order(order_id)
                print("[ADMIN] Loyalty settlement result:", loyalty_body, flush=True)
                body["loyalty_settlement"] = loyalty_body
            except Exception as loyalty_err:
                print("[ADMIN] Loyalty settlement FAILED:", repr(loyalty_err), flush=True)
                body["loyalty_settlement"] = {
                    "ok": False,
                    "error": str(loyalty_err)
                }

        resp = jsonify(body)
        return add_cors_headers(resp), r.status_code

    except Exception as e:
        print("[ERROR] admin_order_action:", repr(e), flush=True)
        resp = jsonify({"error": str(e)})
        return add_cors_headers(resp), 500


def normalise_phone(phone: str | None) -> str | None:
    if not phone:
        return None

    phone = phone.strip()

    # Keep leading + if present, remove other non-digits
    if phone.startswith("+"):
        return "+" + re.sub(r"\D", "", phone[1:])

    return re.sub(r"\D", "", phone)


def loyalty_points_from_food_total(food_total: float | int | None) -> int:
    try:
        value = float(food_total or 0)
    except Exception:
        value = 0.0

    # floor so we never over-award on fractions of a penny
    return int(math.floor(value * LOYALTY_POINTS_PER_POUND))


def loyalty_reward_available(points_balance: int | None) -> float:
    points = int(points_balance or 0)
    reward_blocks = points // LOYALTY_REWARD_POINTS
    return float(reward_blocks * LOYALTY_REWARD_VALUE)


def loyalty_points_needed_for_next_reward(points_balance: int | None) -> int:
    points = int(points_balance or 0)
    remainder = points % LOYALTY_REWARD_POINTS
    return 0 if remainder == 0 else (LOYALTY_REWARD_POINTS - remainder)


def get_or_create_loyalty_account(phone: str | None, email: str | None = None):
    phone_key = normalise_phone(phone)
    if not phone_key:
        return None

    # Try find existing
    existing = (
        supabase.table("loyalty_accounts")
        .select("*")
        .eq("customer_phone", phone_key)
        .limit(1)
        .execute()
    )

    if existing.data:
        row = existing.data[0]

        # quietly backfill email if missing / changed
        if email and row.get("customer_email") != email:
            updated = (
                supabase.table("loyalty_accounts")
                .update({"customer_email": email})
                .eq("id", row["id"])
                .execute()
            )
            if updated.data:
                row = updated.data[0]

        return row

    created = (
        supabase.table("loyalty_accounts")
        .insert({
            "customer_phone": phone_key,
            "customer_email": email,
            "points_balance": 0,
            "lifetime_points": 0,
            "last_order_at": None
        })
        .execute()
    )

    if created.data:
        return created.data[0]

    return None


def get_loyalty_account_by_phone(phone: str | None):
    phone_key = normalise_phone(phone)
    if not phone_key:
        return None

    result = (
        supabase.table("loyalty_accounts")
        .select("*")
        .eq("customer_phone", phone_key)
        .limit(1)
        .execute()
    )

    return result.data[0] if result.data else None


def apply_loyalty_redemption(phone: str | None, reward_amount_used: float | int | None):
    """
    Deduct points AFTER an order is successfully created/paid,
    when checkout has auto-applied a loyalty reward.
    """
    phone_key = normalise_phone(phone)
    if not phone_key:
        return None

    try:
        reward_value = float(reward_amount_used or 0)
    except Exception:
        reward_value = 0.0

    if reward_value <= 0:
        return None

    points_to_deduct = int(round((reward_value / LOYALTY_REWARD_VALUE) * LOYALTY_REWARD_POINTS))
    if points_to_deduct <= 0:
        return None

    account = get_loyalty_account_by_phone(phone_key)
    if not account:
        return None

    previous_balance = int(account.get("points_balance") or 0)
    new_balance = max(0, previous_balance - points_to_deduct)

    updated = (
        supabase.table("loyalty_accounts")
        .update({
            "points_balance": new_balance,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
        .eq("id", account["id"])
        .execute()
    )

    return {
        "previous_balance": previous_balance,
        "points_deducted": points_to_deduct,
        "new_balance": new_balance,
        "reward_value_used": reward_value,
        "account": updated.data[0] if updated.data else account
    }


def award_loyalty_points(
    phone: str | None,
    email: str | None,
    food_total: float | int | None = None,
    order_created_at=None,
    points_redeemed: int = 0,
    points_earned_override: int | None = None
):
    """
    Apply loyalty settlement after a successful eligible completed order.
    - Adds earned points
    - Deducts redeemed points if a reward was used
    Returns a receipt-friendly summary.
    """
    phone_key = normalise_phone(phone)
    if not phone_key:
        return None

    account = get_or_create_loyalty_account(phone_key, email=email)
    if not account:
        return None

    if points_earned_override is not None:
        points_earned = max(0, int(points_earned_override or 0))
    else:
        points_earned = loyalty_points_from_food_total(food_total)

    previous_balance = int(account.get("points_balance") or 0)
    lifetime_points = int(account.get("lifetime_points") or 0)

    redeemed = max(0, int(points_redeemed or 0))
    new_balance = max(0, previous_balance - redeemed + points_earned)

    last_order_at = order_created_at or datetime.now(timezone.utc).isoformat()

    updated = (
        supabase.table("loyalty_accounts")
        .update({
            "points_balance": new_balance,
            "lifetime_points": lifetime_points + points_earned,
            "last_order_at": last_order_at,
            "customer_email": email,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
        .eq("id", account["id"])
        .execute()
    )

    account_after = updated.data[0] if updated.data else {
        **account,
        "points_balance": new_balance,
        "lifetime_points": lifetime_points + points_earned,
        "last_order_at": last_order_at
    }

    return {
        "previous_balance": previous_balance,
        "points_redeemed": redeemed,
        "points_earned": points_earned,
        "new_balance": new_balance,
        "reward_available_now": loyalty_reward_available(new_balance),
        "points_to_next_reward": loyalty_points_needed_for_next_reward(new_balance),
        "account": account_after
    }


@app.route("/settle-loyalty", methods=["POST", "OPTIONS"])
def settle_loyalty():
    if request.method == "OPTIONS":
        resp = make_response("", 204)
        return add_cors_headers(resp)

    if supabase is None:
        resp = make_response(jsonify({
            "ok": False,
            "error": "Supabase not configured"
        }), 500)
        return add_cors_headers(resp)

    try:
        payload = request.get_json(silent=True) or {}
        order_id = payload.get("order_id")

        if not order_id:
            resp = make_response(jsonify({
                "ok": False,
                "error": "order_id is required"
            }), 400)
            return add_cors_headers(resp)

        body, status_code = settle_loyalty_for_order(order_id)
        resp = make_response(jsonify(body), status_code)
        return add_cors_headers(resp)

    except Exception as e:
        print("[settle-loyalty] FAILED:", repr(e), flush=True)
        resp = make_response(jsonify({
            "ok": False,
            "error": str(e)
        }), 500)
        return add_cors_headers(resp)


def build_loyalty_summary(phone: str | None):
    account = get_loyalty_account_by_phone(phone)
    if not account:
        return {
            "points_balance": 0,
            "lifetime_points": 0,
            "reward_available": 0.0,
            "points_to_next_reward": LOYALTY_REWARD_POINTS
        }

    points_balance = int(account.get("points_balance") or 0)

    return {
        "points_balance": points_balance,
        "lifetime_points": int(account.get("lifetime_points") or 0),
        "reward_available": loyalty_reward_available(points_balance),
        "points_to_next_reward": loyalty_points_needed_for_next_reward(points_balance),
        "last_order_at": account.get("last_order_at")
    }


def find_order(order_id: str | None, token: str | None):
    """
    Try to find the order by id (UUID) first, then by order_ref (token).
    Returns a dict or None.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("[WARN] Supabase env vars not set; skipping DB update.")
        return None

    base = f"{SUPABASE_URL}/rest/v1/orders"

    # 1) Try by id
    if order_id:
        try:
            r = requests.get(
                base,
                headers=supabase_headers(),
                params={"id": f"eq.{order_id}", "select": "id,proposed_time,status"},
                timeout=5,
            )
            r.raise_for_status()
            rows = r.json()
            if rows:
                return rows[0]
        except Exception as e:
            print("[ERROR] find_order by id failed:", e)

    # 2) Try by order_ref (token)
    if token:
        try:
            r = requests.get(
                base,
                headers=supabase_headers(),
                params={"order_ref": f"eq.{token}", "select": "id,proposed_time,status"},
                timeout=5,
            )
            r.raise_for_status()
            rows = r.json()
            if rows:
                return rows[0]
        except Exception as e:
            print("[ERROR] find_order by order_ref failed:", e)

    print("[WARN] No matching order found for id/token", order_id, token)
    return None


def update_order_time_accept(order_id: str | None, token: str | None):
    """
    When customer ACCEPTS proposed time:
    - Find order
    - Keep preferred_time unchanged (original customer request)
    - Copy proposed_time -> confirmed_time
    - Set status to 'customer_accepted_time'
    """
    order = find_order(order_id, token)
    if not order:
        return

    oid = order["id"]
    proposed_time = order.get("proposed_time")

    update_body = {
        "status": "customer_accepted_time",
    }

    if proposed_time:
        update_body["confirmed_time"] = proposed_time

    try:
        base = f"{SUPABASE_URL}/rest/v1/orders"
        r = requests.patch(
            base,
            headers=supabase_headers(),
            params={"id": f"eq.{oid}"},
            json=update_body,
            timeout=5,
        )
        r.raise_for_status()
        print("[INFO] Order time accepted & updated in Supabase", oid, update_body)
    except Exception as e:
        print("[ERROR] update_order_time_accept failed:", e)


def update_order_time_decline(order_id: str | None, token: str | None):
    """
    When customer DECLINES proposed time:
    - Find order
    - Keep preferred_time unchanged
    - Keep proposed_time unchanged (so admin can still see what was suggested)
    - Set status to 'customer_declined_time'
    """
    order = find_order(order_id, token)
    if not order:
        return

    oid = order["id"]

    update_body = {
        "status": "customer_declined_time",
    }

    try:
        base = f"{SUPABASE_URL}/rest/v1/orders"
        r = requests.patch(
            base,
            headers=supabase_headers(),
            params={"id": f"eq.{oid}"},
            json=update_body,
            timeout=5,
        )
        r.raise_for_status()
        print("[INFO] Order time declined & updated in Supabase", oid, update_body)
    except Exception as e:
        print("[ERROR] update_order_time_decline failed:", e)
        raise


@app.route("/loyalty-balance", methods=["POST", "OPTIONS"])
def loyalty_balance():
    if request.method == "OPTIONS":
        resp = make_response("", 204)
        return add_cors_headers(resp)

    if supabase is None:
        resp = make_response(jsonify({
            "ok": False,
            "error": "Supabase not configured"
        }), 500)
        return add_cors_headers(resp)

    try:
        payload = request.get_json(silent=True) or {}
        phone = payload.get("phone")

        print("[loyalty-balance] phone =", repr(phone), flush=True)

        summary = build_loyalty_summary(phone)

        print("[loyalty-balance] summary =", repr(summary), flush=True)

        resp = make_response(jsonify({
            "ok": True,
            "loyalty": summary
        }), 200)
        return add_cors_headers(resp)

    except Exception as e:
        print("[loyalty-balance] FAILED:", repr(e), flush=True)
        resp = make_response(jsonify({
            "ok": False,
            "error": str(e)
        }), 500)
        return add_cors_headers(resp)


def html_response(body: str, title: str = "Rung's Thai Kitchen"):
  html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{title}</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
  </head>
  <body style="font-family:system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
               padding:2rem;max-width:480px;margin:0 auto;text-align:center;">
    {body}
  </body>
</html>"""
  resp = make_response(html, 200)
  return add_cors_headers(resp)


@app.get("/orders/<order_id>/time/accept")
def time_accept(order_id):
    token = request.args.get("token", "")
    print("[INFO] Customer ACCEPTED proposed time", order_id, token)

    # NEW: update Supabase
    update_order_time_accept(order_id, token)

    body = """
      <h1>Thank you!</h1>
      <p>Your proposed collection/delivery time has been accepted.</p>
      <p>You don’t need to do anything else – we’ll see you then.</p>
    """
    return html_response(body, title="Time accepted")


@app.get("/orders/<order_id>/time/decline")
def time_decline(order_id):
    token = request.args.get("token", "")
    print("[INFO] Customer DECLINED proposed time", order_id, token)

    try:
        update_order_time_decline(order_id, token)

        body = """
          <h1>Thanks for letting us know</h1>
          <p>We’ve noted that this time doesn’t work for you.</p>
          <p>Please contact the restaurant to arrange another time.</p>
        """
        return html_response(body, title="Time declined")

    except Exception as e:
        import traceback
        print("[ERROR] time_decline failed:", repr(e), flush=True)
        traceback.print_exc()

        body = """
          <h1>Sorry</h1>
          <p>We couldn’t process that response just now.</p>
          <p>Please contact the restaurant (on0113 469 9564) and we’ll try to find a suitable time for you.</p>
        """
        return html_response(body, title="Unable to process response")
