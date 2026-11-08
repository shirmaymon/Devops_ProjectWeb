"""
api.py — VM Calculator backend
Handles save/load of user data in PostgreSQL (table saved_files).
"""

import os
import json
from contextlib import contextmanager
from datetime import datetime

import psycopg2
from psycopg2.extras import Json
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

MAX_FILES_PER_USER = 5

# Database connection settings come from environment variables (set in the Deployment).
DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "vmcalc-db-service.database"),
    "port": os.environ.get("DB_PORT", "5432"),
    "dbname": os.environ.get("DB_NAME", "vmcalc"),
    "user": os.environ.get("DB_USER", "vmcalc"),
    "password": os.environ.get("DB_PASSWORD", ""),
}


# ── Helpers ──────────────────────────────────────────────────────────────

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


def owner(first: str, last: str) -> tuple[str, str]:
    """Return the normalized owner key (lowercase first and last name)."""
    return first.strip().lower(), last.strip().lower()


def list_user_files(cur, first: str, last: str) -> list[dict]:
    """Return list of saved files for a user (oldest first)."""
    cur.execute(
        """
        SELECT filename, created_at, octet_length(data::text)
        FROM saved_files
        WHERE first_name = %s AND last_name = %s
        ORDER BY created_at, id
        """,
        owner(first, last),
    )
    return [
        {
            "filename": filename,
            "saved_at": created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "size_kb": round(size / 1024, 1),
        }
        for filename, created_at, size in cur.fetchall()
    ]


def insert_file(cur, first: str, last: str, data: dict) -> str:
    """
    Insert a saved file and return its filename.
    Every save gets its own ID (the table's id column), and the ID is part of the filename:
    firstname_lastname_DD-MM-YYYY_HH-MM_<id>.json. Two saves in the same minute never collide.
    """
    first, last = owner(first, last)
    cur.execute("SELECT nextval(pg_get_serial_sequence('saved_files', 'id'))")
    file_id = cur.fetchone()[0]
    now = datetime.now().strftime("%d-%m-%Y_%H-%M")
    filename = f"{first}_{last}_{now}_{file_id}.json"
    cur.execute(
        """
        INSERT INTO saved_files (id, first_name, last_name, filename, data)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (file_id, first, last, filename, Json(data)),
    )
    return filename


def validate_vmcalc_data(data: dict) -> bool:
    """Validate that a JSON payload matches the expected VM Calc structure."""
    return (
        isinstance(data, dict)
        and "hosts" in data and isinstance(data["hosts"], list)
        and "users" in data and isinstance(data["users"], list)
        and "machines" in data and isinstance(data["machines"], dict)
    )


@app.errorhandler(psycopg2.Error)
def handle_db_error(e):
    app.logger.error("Database error: %s", e)
    return jsonify({"error": "Database error"}), 500


# ── Routes ───────────────────────────────────────────────────────────────

@app.route("/api/save", methods=["POST"])
def save_data():
    """
    Save current session data to the database.
    Body: { first, last, data: { hosts, users, machines } }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Invalid JSON body"}), 400

    first = body.get("first", "").strip()
    last  = body.get("last", "").strip()
    data  = body.get("data")

    if not first or not last:
        return jsonify({"error": "First and last name are required"}), 400
    if not data or not validate_vmcalc_data(data):
        return jsonify({"error": "Invalid data structure"}), 400

    with db() as cur:
        files = list_user_files(cur, first, last)

        # Enforce 5-file limit — return conflict so the frontend can ask the user
        if len(files) >= MAX_FILES_PER_USER:
            return jsonify({
                "error": "limit_reached",
                "oldest": files[0],
                "count": len(files),
            }), 409

        filename = insert_file(cur, first, last, data)

    return jsonify({"message": "Saved", "filename": filename}), 201


@app.route("/api/save/force", methods=["POST"])
def force_save():
    """
    Delete the named file and save the new one.
    Body: { first, last, data, delete_filename }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Invalid JSON body"}), 400

    first           = body.get("first", "").strip()
    last            = body.get("last", "").strip()
    data            = body.get("data")
    delete_filename = body.get("delete_filename", "").strip()

    if not first or not last or not delete_filename:
        return jsonify({"error": "Missing required fields"}), 400
    if not data or not validate_vmcalc_data(data):
        return jsonify({"error": "Invalid data structure"}), 400

    with db() as cur:
        cur.execute(
            "DELETE FROM saved_files WHERE first_name = %s AND last_name = %s AND filename = %s",
            (*owner(first, last), delete_filename),
        )
        filename = insert_file(cur, first, last, data)

    return jsonify({"message": "Saved", "filename": filename}), 201


@app.route("/api/files", methods=["GET"])
def get_files():
    """
    List saved files for a user.
    Query params: first, last
    """
    first = request.args.get("first", "").strip()
    last  = request.args.get("last", "").strip()

    if not first or not last:
        return jsonify({"error": "First and last name are required"}), 400

    with db() as cur:
        files = list_user_files(cur, first, last)
    return jsonify({"files": files}), 200


def fetch_data(first: str, last: str, filename: str):
    """Return the saved JSON of a file, or None if it does not exist."""
    with db() as cur:
        cur.execute(
            "SELECT data FROM saved_files WHERE first_name = %s AND last_name = %s AND filename = %s",
            (*owner(first, last), filename),
        )
        row = cur.fetchone()
    return row[0] if row else None


@app.route("/api/files/download", methods=["GET"])
def download_file():
    """
    Download a specific saved file as a .json attachment.
    Query params: first, last, filename
    """
    first    = request.args.get("first", "").strip()
    last     = request.args.get("last", "").strip()
    filename = request.args.get("filename", "").strip()

    if not first or not last or not filename:
        return jsonify({"error": "Missing parameters"}), 400

    data = fetch_data(first, last, filename)
    if data is None:
        return jsonify({"error": "File not found"}), 404

    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.route("/api/files/load", methods=["GET"])
def load_file():
    """
    Load and return the contents of a saved file as JSON.
    Query params: first, last, filename
    """
    first    = request.args.get("first", "").strip()
    last     = request.args.get("last", "").strip()
    filename = request.args.get("filename", "").strip()

    if not first or not last or not filename:
        return jsonify({"error": "Missing parameters"}), 400

    data = fetch_data(first, last, filename)
    if data is None:
        return jsonify({"error": "File not found"}), 404

    return jsonify(data), 200


@app.route("/api/files/delete", methods=["DELETE"])
def delete_file():
    """
    Delete a specific saved file.
    Body: { first, last, filename }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Invalid JSON body"}), 400

    first    = body.get("first", "").strip()
    last     = body.get("last", "").strip()
    filename = body.get("filename", "").strip()

    if not first or not last or not filename:
        return jsonify({"error": "Missing required fields"}), 400

    with db() as cur:
        cur.execute(
            "DELETE FROM saved_files WHERE first_name = %s AND last_name = %s AND filename = %s",
            (*owner(first, last), filename),
        )
        deleted = cur.rowcount

    if deleted == 0:
        return jsonify({"error": "File not found"}), 404
    return jsonify({"message": "Deleted"}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
