#!/usr/bin/env python3
"""
app_live_history.py — ISS tracker backend with:
  - Live polling every 3s (lat, lon, altitude_km, velocity_kmh)
  - Past history buffer for ground track
  - Future ground track endpoint (next N minutes) using where-the-iss-at positions

Routes:
  GET /          -> templates/index.html
  GET /latest    -> latest record
  GET /history   -> list of recent records (most recent last)
  GET /future?n=45&step=60 -> future ground track (minutes ahead, step seconds)

Run:
  python app_live_history.py
Open:
  http://127.0.0.1:5000
"""
import threading, time, requests, os, sys
from flask import Flask, jsonify, send_from_directory, request
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

app = Flask(__name__, static_folder="static", template_folder=TEMPLATES_DIR)

# APIs
WTIA_LATEST = "https://api.wheretheiss.at/v1/satellites/25544"
WTIA_POSITIONS = "https://api.wheretheiss.at/v1/satellites/25544/positions"

# config
POLL_SECONDS = 3
HISTORY_MAX = 2000  # ~100 minutes if poll=3s

history = []
lock = threading.Lock()

def _now_iso_utc():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def poller():
    """Background: poll WTIA every POLL_SECONDS."""
    sess = requests.Session()
    while True:
        rec = {
            "timestamp_utc": _now_iso_utc(),
            "latitude": None, "longitude": None,
            "altitude_km": None,
            "velocity_kmh": None,
            "velocity_km_s": None,
            "source": "wheretheiss.at"
        }
        try:
            r = sess.get(WTIA_LATEST, timeout=8)
            r.raise_for_status()
            j = r.json()
            lat = float(j["latitude"])
            lon = float(j["longitude"])
            alt_km = float(j.get("altitude") or 0.0)
            vel_kmh = float(j.get("velocity") or 0.0)

            rec.update({
                "latitude": lat,
                "longitude": lon,
                "altitude_km": alt_km,
                "velocity_kmh": vel_kmh,
                "velocity_km_s": vel_kmh / 3600.0
            })
        except Exception:
            # keep None values, still append a heartbeat row
            pass

        with lock:
            history.append(rec)
            if len(history) > HISTORY_MAX:
                del history[0: len(history) - HISTORY_MAX]

        time.sleep(POLL_SECONDS)

@app.route("/")
def index():
    return send_from_directory(TEMPLATES_DIR, "index.html")

@app.route("/latest")
def latest():
    with lock:
        if not history:
            return jsonify({
                "timestamp_utc": _now_iso_utc(),
                "latitude": None, "longitude": None,
                "altitude_km": None, "velocity_kmh": None, "velocity_km_s": None,
                "source": "wheretheiss.at"
            })
        return jsonify(history[-1])

@app.route("/history")
def get_history():
    with lock:
        return jsonify(history)

@app.route("/future")
def future():
    """Future ground track for next n minutes (default 45), step seconds (default 60)."""
    try:
        n_min = int(request.args.get("n", 45))
        step = int(request.args.get("step", 60))
        n_min = max(1, min(n_min, 180))   # clamp 1..180 minutes
        step = max(10, min(step, 180))    # clamp 10..180 sec

        # Generate UNIX timestamps in the future
        now_ts = int(time.time())
        stamps = list(range(now_ts + step, now_ts + n_min*60 + 1, step))
        params = {
            "timestamps": ",".join(str(s) for s in stamps),
            "units": "kilometers"
        }
        r = requests.get(WTIA_POSITIONS, params=params, timeout=10)
        r.raise_for_status()
        arr = r.json()
        out = []
        for p in arr:
            try:
                out.append({
                    "timestamp_utc": datetime.utcfromtimestamp(int(p["timestamp"])).replace(microsecond=0).isoformat()+"Z",
                    "latitude": float(p["latitude"]),
                    "longitude": float(p["longitude"]),
                    "altitude_km": float(p.get("altitude") or 0.0),
                    "velocity_kmh": float(p.get("velocity") or 0.0),
                    "velocity_km_s": float(p.get("velocity") or 0.0) / 3600.0
                })
            except Exception:
                pass
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": "future_failed", "detail": str(e)}), 500

if __name__ == "__main__":
    threading.Thread(target=poller, daemon=True).start()
    print("ISS tracker w/ past+future running on http://127.0.0.1:5000")
    sys.stdout.flush()
    app.run(host="0.0.0.0", port=5000, debug=False)
