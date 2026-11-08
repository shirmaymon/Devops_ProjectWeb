"""
api.py — VM Calculator backend
Handles save/load of user data in PostgreSQL (table saved_files).
Every route needs a logged-in user (session cookie, see common.py).
"""

import json
import re
from datetime import datetime

import psycopg2
from psycopg2.extras import Json
from flask import Flask, request, jsonify, Response, g

from common import db, login_required

app = Flask(__name__)

MAX_FILES_PER_USER = 5


# ── Helpers ──────────────────────────────────────────────────────────────

def list_user_files(cur, user_id: int) -> list[dict]:
    """Return list of saved files for a user (oldest first)."""
    cur.execute(
        """
        SELECT filename, created_at, octet_length(data::text)
        FROM saved_files
        WHERE user_id = %s
        ORDER BY created_at, id
        """,
        (user_id,),
    )
    return [
        {
            "filename": filename,
            "saved_at": created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "size_kb": round(size / 1024, 1),
        }
        for filename, created_at, size in cur.fetchall()
    ]


def insert_file(cur, user_id: int, user_name: str, data: dict) -> str:
    """
    Insert a saved file and return its filename.
    Every save gets its own ID (the table's id column), and the ID is part of the filename:
    <name>_DD-MM-YYYY_HH-MM_<id>.json. Two saves in the same minute never collide.
    """
    cur.execute("SELECT nextval(pg_get_serial_sequence('saved_files', 'id'))")
    file_id = cur.fetchone()[0]
    slug = re.sub(r"[^a-z0-9]+", "-", (user_name or "").lower()).strip("-") or "user"
    now = datetime.now().strftime("%d-%m-%Y_%H-%M")
    filename = f"{slug}_{now}_{file_id}.json"
    cur.execute(
        """
        INSERT INTO saved_files (id, user_id, filename, data)
        VALUES (%s, %s, %s, %s)
        """,
        (file_id, user_id, filename, Json(data)),
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
@login_required
def save_data():
    """
    Save current session data to the database.
    Body: { data: { hosts, users, machines } }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Invalid JSON body"}), 400

    data = body.get("data")
    if not data or not validate_vmcalc_data(data):
        return jsonify({"error": "Invalid data structure"}), 400

    with db() as cur:
        files = list_user_files(cur, g.user["id"])

        # Enforce 5-file limit — return conflict so the frontend can ask the user
        if len(files) >= MAX_FILES_PER_USER:
            return jsonify({
                "error": "limit_reached",
                "oldest": files[0],
                "count": len(files),
            }), 409

        filename = insert_file(cur, g.user["id"], g.user["name"], data)

    return jsonify({"message": "Saved", "filename": filename}), 201


@app.route("/api/save/force", methods=["POST"])
@login_required
def force_save():
    """
    Delete the named file and save the new one.
    Body: { data, delete_filename }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Invalid JSON body"}), 400

    data            = body.get("data")
    delete_filename = str(body.get("delete_filename", "")).strip()

    if not delete_filename:
        return jsonify({"error": "Missing required fields"}), 400
    if not data or not validate_vmcalc_data(data):
        return jsonify({"error": "Invalid data structure"}), 400

    with db() as cur:
        cur.execute(
            "DELETE FROM saved_files WHERE user_id = %s AND filename = %s",
            (g.user["id"], delete_filename),
        )
        filename = insert_file(cur, g.user["id"], g.user["name"], data)

    return jsonify({"message": "Saved", "filename": filename}), 201


@app.route("/api/files", methods=["GET"])
@login_required
def get_files():
    """List the saved files of the logged-in user."""
    with db() as cur:
        files = list_user_files(cur, g.user["id"])
    return jsonify({"files": files}), 200


def fetch_data(user_id: int, filename: str):
    """Return the saved JSON of a file, or None if it does not exist."""
    with db() as cur:
        cur.execute(
            "SELECT data FROM saved_files WHERE user_id = %s AND filename = %s",
            (user_id, filename),
        )
        row = cur.fetchone()
    return row[0] if row else None


@app.route("/api/files/download", methods=["GET"])
@login_required
def download_file():
    """
    Download a specific saved file as a .json attachment.
    Query params: filename
    """
    filename = request.args.get("filename", "").strip()
    if not filename:
        return jsonify({"error": "Missing parameters"}), 400

    data = fetch_data(g.user["id"], filename)
    if data is None:
        return jsonify({"error": "File not found"}), 404

    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.route("/api/files/load", methods=["GET"])
@login_required
def load_file():
    """
    Load and return the contents of a saved file as JSON.
    Query params: filename
    """
    filename = request.args.get("filename", "").strip()
    if not filename:
        return jsonify({"error": "Missing parameters"}), 400

    data = fetch_data(g.user["id"], filename)
    if data is None:
        return jsonify({"error": "File not found"}), 404

    return jsonify(data), 200


@app.route("/api/files/delete", methods=["DELETE"])
@login_required
def delete_file():
    """
    Delete a specific saved file.
    Body: { filename }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Invalid JSON body"}), 400

    filename = str(body.get("filename", "")).strip()
    if not filename:
        return jsonify({"error": "Missing required fields"}), 400

    with db() as cur:
        cur.execute(
            "DELETE FROM saved_files WHERE user_id = %s AND filename = %s",
            (g.user["id"], filename),
        )
        deleted = cur.rowcount

    if deleted == 0:
        return jsonify({"error": "File not found"}), 404
    return jsonify({"message": "Deleted"}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
