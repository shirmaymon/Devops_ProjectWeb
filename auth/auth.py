"""
auth.py — VM Calculator auth service
Local accounts (email + password) and login sessions, under /api/auth.
Passwords are hashed with Argon2id (OWASP Password Storage Cheat Sheet).
"""

import re

import psycopg2
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from flask import Flask, request, jsonify, g

from common import (
    db, setup_metrics, setup_health, COOKIE_NAME, create_session, delete_session, login_required,
    set_session_cookie, clear_session_cookie,
)

app = Flask(__name__)
setup_metrics(app)
setup_health(app)
ph = PasswordHasher()   # argon2-cffi default type is Argon2id

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8
MAX_PASSWORD = 128
# Hash checked when the email does not exist, so the answer takes the same time either way.
DUMMY_HASH = ph.hash("not-a-real-password")


def session_response(user: dict, raw: str, csrf: str, status: int = 200):
    resp = jsonify({
        "user": {"id": user["id"], "email": user["email"], "name": user["name"]},
        "csrf_token": csrf,
    })
    resp.status_code = status
    return set_session_cookie(resp, raw)


@app.errorhandler(psycopg2.Error)
def handle_db_error(e):
    app.logger.error("Database error: %s", e)
    return jsonify({"error": "Database error"}), 500


@app.route("/api/auth/register", methods=["POST"])
def register():
    """Body: { email, name, password }. Creates the account and logs the user in."""
    body = request.get_json(silent=True) or {}
    email = str(body.get("email", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    password = str(body.get("password", ""))

    if not EMAIL_RE.match(email):
        return jsonify({"error": "A valid email is required"}), 400
    if not name:
        return jsonify({"error": "Name is required"}), 400
    if not (MIN_PASSWORD <= len(password) <= MAX_PASSWORD):
        return jsonify({"error": f"Password must be {MIN_PASSWORD}-{MAX_PASSWORD} characters"}), 400

    with db() as cur:
        cur.execute("SELECT 1 FROM users WHERE email = %s", (email,))
        if cur.fetchone():
            return jsonify({"error": "This email is already registered"}), 409
        cur.execute(
            "INSERT INTO users (email, name, password_hash) VALUES (%s, %s, %s) RETURNING id",
            (email, name, ph.hash(password)),
        )
        user = {"id": cur.fetchone()[0], "email": email, "name": name}
        raw, csrf = create_session(cur, user["id"])
    return session_response(user, raw, csrf, 201)


@app.route("/api/auth/login", methods=["POST"])
def login():
    """Body: { email, password }. A new session ID is issued; an old one is deleted."""
    body = request.get_json(silent=True) or {}
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))

    with db() as cur:
        cur.execute("SELECT id, name, password_hash FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        stored = row[2] if row and row[2] else DUMMY_HASH
        try:
            ph.verify(stored, password)
            ok = bool(row and row[2])
        except (VerifyMismatchError, InvalidHashError):
            ok = False
        if not ok:
            return jsonify({"error": "Invalid email or password"}), 401

        old = request.cookies.get(COOKIE_NAME)
        if old:
            delete_session(cur, old)
        user = {"id": row[0], "email": email, "name": row[1]}
        raw, csrf = create_session(cur, user["id"])
    return session_response(user, raw, csrf)


@app.route("/api/auth/logout", methods=["POST"])
@login_required
def logout():
    """Deletes the session record on the server and clears the cookie."""
    with db() as cur:
        delete_session(cur, request.cookies.get(COOKIE_NAME))
    return clear_session_cookie(jsonify({"message": "Logged out"})), 200


@app.route("/api/auth/me", methods=["GET"])
@login_required
def me():
    """Who is logged in. The page calls this on load and keeps the CSRF token in memory."""
    return jsonify({
        "user": {"id": g.user["id"], "email": g.user["email"], "name": g.user["name"]},
        "csrf_token": g.user["csrf_token"],
    }), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
