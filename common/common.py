"""
common.py — shared by the Flask API (api.py) and the auth service (auth.py).
Database connection, login sessions and the login_required decorator.

Sessions: the browser holds a random session ID in an HttpOnly cookie. The session
record lives in the PostgreSQL table `sessions`, so any pod of any service can check it.
Only a SHA-256 hash of the ID is stored, so a copy of the table cannot be used to log in.
"""

import os
import hashlib
import hmac
import secrets
from contextlib import contextmanager
from functools import wraps

import psycopg2
from flask import request, jsonify, g

# ── Settings (environment variables, set in the Deployment) ──────────────────

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "vmcalc-db-service.database"),
    "port": os.environ.get("DB_PORT", "5432"),
    "dbname": os.environ.get("DB_NAME", "vmcalc"),
    "user": os.environ.get("DB_USER", "vmcalc"),
    "password": os.environ.get("DB_PASSWORD", ""),
}

COOKIE_NAME = "vmcalc_session"
# Secure flag: off while the site runs over plain HTTP, set COOKIE_SECURE=true once HTTPS is on.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
# Idle timeout: no request for this long ends the session. Absolute timeout: hard limit since login.
IDLE_MINUTES = int(os.environ.get("SESSION_IDLE_MINUTES", "30"))
ABSOLUTE_HOURS = int(os.environ.get("SESSION_ABSOLUTE_HOURS", "8"))


@contextmanager
def db():
    """Open a connection and yield a cursor. Commits on success, rolls back on error."""
    conn = psycopg2.connect(connect_timeout=5, **DB_CONFIG)
    try:
        with conn:
            with conn.cursor() as cur:
                yield cur
    finally:
        conn.close()


# ── Sessions ─────────────────────────────────────────────────────────────────

def hash_id(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def create_session(cur, user_id: int) -> tuple[str, str]:
    """Create a session. Returns (session ID for the cookie, CSRF token for the page)."""
    # Remove sessions that are already over (keeps the table small).
    cur.execute(
        """
        DELETE FROM sessions
        WHERE expires_at < now() OR last_seen < now() - make_interval(mins => %s)
        """,
        (IDLE_MINUTES,),
    )
    raw = secrets.token_urlsafe(32)        # 256 bits from the OS secure random generator
    csrf = secrets.token_urlsafe(32)
    cur.execute(
        """
        INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at)
        VALUES (%s, %s, %s, now() + make_interval(hours => %s))
        """,
        (hash_id(raw), user_id, csrf, ABSOLUTE_HOURS),
    )
    return raw, csrf


def get_session(cur, raw: str):
    """Return {id, email, name, csrf_token} for a valid session, or None. Refreshes last_seen."""
    cur.execute(
        """
        SELECT u.id, u.email, u.name, s.csrf_token
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id_hash = %s
          AND s.expires_at > now()
          AND s.last_seen > now() - make_interval(mins => %s)
        """,
        (hash_id(raw), IDLE_MINUTES),
    )
    row = cur.fetchone()
    if not row:
        return None
    cur.execute("UPDATE sessions SET last_seen = now() WHERE id_hash = %s", (hash_id(raw),))
    return {"id": row[0], "email": row[1], "name": row[2], "csrf_token": row[3]}


def delete_session(cur, raw: str) -> None:
    cur.execute("DELETE FROM sessions WHERE id_hash = %s", (hash_id(raw),))


def set_session_cookie(resp, raw: str):
    resp.set_cookie(
        COOKIE_NAME, raw,
        httponly=True, secure=COOKIE_SECURE, samesite="Strict", path="/",
    )
    return resp


def clear_session_cookie(resp):
    resp.delete_cookie(COOKIE_NAME, path="/")
    return resp


def login_required(fn):
    """
    Allow the request only with a valid session cookie. The user is available as g.user.
    Requests that change data (not GET) must also send the session's CSRF token
    in the X-CSRF-Token header.
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        raw = request.cookies.get(COOKIE_NAME)
        sess = None
        if raw:
            with db() as cur:
                sess = get_session(cur, raw)
        if not sess:
            return clear_session_cookie(jsonify({"error": "not_logged_in"})), 401
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            sent = request.headers.get("X-CSRF-Token", "")
            if not hmac.compare_digest(sent, sess["csrf_token"]):
                return jsonify({"error": "csrf_failed"}), 403
        g.user = sess
        return fn(*args, **kwargs)
    return wrapper
