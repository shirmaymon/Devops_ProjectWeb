"""
api.py — VM Calculator backend
Handles save/load of user data to /web-data/
"""

import os
import json
import glob
from datetime import datetime
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DATA_DIR = "/web-data"
MAX_FILES_PER_USER = 5


# ── Helpers ──────────────────────────────────────────────────────────────

def user_dir(first: str, last: str) -> str:
    """Return the storage directory for a given user."""
    username = f"{first.strip().lower()}_{last.strip().lower()}"
    return os.path.join(DATA_DIR, username)


def list_user_files(first: str, last: str) -> list[dict]:
    """Return sorted list of saved files for a user (oldest first)."""
    path = user_dir(first, last)
    if not os.path.isdir(path):
        return []
    files = glob.glob(os.path.join(path, "*.json"))
    result = []
    for f in files:
        stat = os.stat(f)
        result.append({
            "filename": os.path.basename(f),
            "saved_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            "size_kb": round(stat.st_size / 1024, 1),
        })
    result.sort(key=lambda x: x["saved_at"])
    return result


def validate_vmcalc_data(data: dict) -> bool:
    """Validate that a JSON payload matches the expected VM Calc structure."""
    return (
        isinstance(data, dict)
        and "hosts" in data and isinstance(data["hosts"], list)
        and "users" in data and isinstance(data["users"], list)
        and "machines" in data and isinstance(data["machines"], dict)
    )


# ── Routes ───────────────────────────────────────────────────────────────

@app.route("/api/save", methods=["POST"])
def save_data():
    """
    Save current session data to /web-data/<user>/<filename>.json
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

    udir = user_dir(first, last)
    os.makedirs(udir, exist_ok=True)

    files = list_user_files(first, last)

    # Enforce 5-file limit — return conflict so the frontend can ask the user
    if len(files) >= MAX_FILES_PER_USER:
        oldest = files[0]
        return jsonify({
            "error": "limit_reached",
            "oldest": oldest,
            "count": len(files),
        }), 409

    # Build filename: firstname_lastname_DD-MM-YYYY_HH-MM.json
    now = datetime.now().strftime("%d-%m-%Y_%H-%M")
    username = f"{first.lower()}_{last.lower()}"
    filename = f"{username}_{now}.json"
    filepath = os.path.join(udir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return jsonify({"message": "Saved", "filename": filename}), 201


@app.route("/api/save/force", methods=["POST"])
def force_save():
    """
    Delete oldest file and save new one.
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

    udir     = user_dir(first, last)
    del_path = os.path.join(udir, delete_filename)

    if os.path.isfile(del_path):
        os.remove(del_path)

    now      = datetime.now().strftime("%d-%m-%Y_%H-%M")
    username = f"{first.lower()}_{last.lower()}"
    filename = f"{username}_{now}.json"
    filepath = os.path.join(udir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

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

    files = list_user_files(first, last)
    return jsonify({"files": files}), 200


@app.route("/api/files/download", methods=["GET"])
def download_file():
    """
    Download a specific saved file.
    Query params: first, last, filename
    """
    first    = request.args.get("first", "").strip()
    last     = request.args.get("last", "").strip()
    filename = request.args.get("filename", "").strip()

    if not first or not last or not filename:
        return jsonify({"error": "Missing parameters"}), 400

    # Prevent path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        return jsonify({"error": "Invalid filename"}), 400

    filepath = os.path.join(user_dir(first, last), filename)
    if not os.path.isfile(filepath):
        return jsonify({"error": "File not found"}), 404

    return send_file(filepath, as_attachment=True, download_name=filename)


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

    if "/" in filename or "\\" in filename or ".." in filename:
        return jsonify({"error": "Invalid filename"}), 400

    filepath = os.path.join(user_dir(first, last), filename)
    if not os.path.isfile(filepath):
        return jsonify({"error": "File not found"}), 404

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

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

    if "/" in filename or "\\" in filename or ".." in filename:
        return jsonify({"error": "Invalid filename"}), 400

    filepath = os.path.join(user_dir(first, last), filename)
    if not os.path.isfile(filepath):
        return jsonify({"error": "File not found"}), 404

    os.remove(filepath)
    return jsonify({"message": "Deleted"}), 200


if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    app.run(host="0.0.0.0", port=5000)
