#!/usr/bin/env python3
# app.py - ISS + synthetic environment generator (3s cadence)
import threading, time, os, json, math, random
from datetime import datetime
from flask import Flask, jsonify, render_template, send_file
from flask_cors import CORS
from openpyxl import Workbook, load_workbook
from openpyxl.utils import get_column_letter
from collections import deque
import requests

# CONFIG
POLL_INTERVAL = 3            # seconds (ISS + synthetic env cadence)
ENV_CSV = "realtime_env.csv"
EXCEL_FILE = "realtime_iss.xlsx"
ENV_EXCEL_SHEET = "environment_log"
ENV_MEMORY_LIMIT = 1000

# External ISS API (same as before)
ISS_API = "https://api.wheretheiss.at/v1/satellites/25544"

app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)

# Shared state
latest_lock = threading.Lock()
latest_data = None
env_samples = deque(maxlen=ENV_MEMORY_LIMIT)   # newest at left

def log(msg):
    print(f"[{datetime.utcnow().isoformat()}] {msg}")

# --- File helpers ---
def ensure_excel():
    if not os.path.exists(EXCEL_FILE):
        log("Creating Excel file")
        wb = Workbook()
        ws = wb.active
        ws.title = "iss_log"
        headers = ["timestamp_utc_iso", "epoch_unix", "latitude", "longitude", "altitude_km", "velocity_kmph", "raw_payload"]
        ws.append(headers)
        widths = [22,12,12,12,14,14,60]
        for i,w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        wb.save(EXCEL_FILE)

def ensure_env_sheet():
    ensure_excel()
    wb = load_workbook(EXCEL_FILE)
    if ENV_EXCEL_SHEET not in wb.sheetnames:
        ws = wb.create_sheet(ENV_EXCEL_SHEET)
        headers = ["timestamp_utc_iso","source","parameter","value","latitude","longitude","meta"]
        ws.append(headers)
        for i,w in enumerate([22,20,18,12,12,12,60], start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        wb.save(EXCEL_FILE)
    wb.close()

def append_excel_row(sheetname, row):
    try:
        wb = load_workbook(EXCEL_FILE)
        ws = wb[sheetname]
        ws.append(row)
        wb.save(EXCEL_FILE)
        wb.close()
    except Exception as e:
        log(f"Excel append error ({sheetname}): {e}")

def append_csv(row):
    try:
        write_header = not os.path.exists(ENV_CSV)
        with open(ENV_CSV, "a", encoding="utf-8") as f:
            if write_header:
                f.write("timestamp_utc_iso,source,parameter,value,latitude,longitude,meta\n")
            fields = [str(x).replace(",", ";") for x in row[:-1]]
            line = ",".join(fields) + ',"' + str(row[-1]).replace('"', "'") + '"\n'
            f.write(line)
    except Exception as e:
        log(f"CSV append error: {e}")

# --- ISS poller (updates latest_data) ---
def poll_iss(stop_event):
    global latest_data
    ensure_excel()
    log("ISS poller started")
    while not stop_event.is_set():
        try:
            r = requests.get(ISS_API, timeout=8)
            if r.status_code == 200:
                payload = r.json()
                ts_unix = int(payload.get("timestamp", time.time()))
                ts_iso = datetime.utcfromtimestamp(ts_unix).isoformat() + "Z"
                lat = float(payload.get("latitude", 0.0))
                lon = float(payload.get("longitude", 0.0))
                alt = float(payload.get("altitude", 0.0))
                vel_raw = float(payload.get("velocity", 0.0))
                vel = vel_raw if vel_raw > 1000 else vel_raw * 3600.0
                vel = round(vel,2)
                with latest_lock:
                    latest_data = {
                        "timestamp_iso": ts_iso,
                        "timestamp_unix": ts_unix,
                        "latitude": lat,
                        "longitude": lon,
                        "altitude_km": alt,
                        "velocity_kmph": vel,
                        "raw": payload
                    }
                # log to excel iss_log
                row = [ts_iso, ts_unix, round(lat,6), round(lon,6), round(alt,3), vel, json.dumps(payload, ensure_ascii=False)]
                append_excel_row("iss_log", row)
            else:
                log(f"ISS API returned HTTP {r.status_code}")
        except Exception as e:
            log(f"ISS poll error: {e}")
        stop_event.wait(POLL_INTERVAL)

# --- Synthetic environment generator (3s cadence) ---
def synth_env_sample(lat, lon, ts_iso):
    """
    Create synthetic values that vary with position/time:
      - T2M (°C): base 15 + lat influence + sinusoid + noise
      - ALLSKY_SFC_SW_DWN (W/m2): solar proxy using hour angle + noise
      - SST (°C): if over ocean (approx), small variation
      - FIRMS count: random small integer based on latitude zone
    """
    # time factors
    now = datetime.utcnow()
    seconds = now.hour * 3600 + now.minute*60 + now.second
    # simple diurnal factor (-1..1)
    diurnal = math.sin( (seconds / 86400.0) * 2*math.pi )
    # lat influence: warmer near equator
    lat_factor = math.cos(math.radians(lat))  # 1 at equator, 0 at poles
    # T2M
    base_temp = 15.0
    t2m = base_temp + 20.0 * lat_factor * 0.5 + 8.0 * diurnal + random.uniform(-1.5, 1.5)
    t2m = round(t2m, 2)
    # ALLSKY solar (very rough): 0 at night, peak ~1000 at noon scaled by lat/day
    solar_peak = max(0.0, 1000.0 * max(0.0, diurnal) * lat_factor)
    solar = round(solar_peak + random.uniform(-20,20), 2)
    # Determine "ocean" vs "land" roughly by lon/lat check - approximate: if abs(lat) < 60 and (abs(lon) % 180) < 100 => ocean-ish (crude)
    ocean_flag = (abs(lat) < 60 and (abs(lon) % 180) < 100)
    # SST: if ocean flag True, produce a value near t2m - 5 .. +5, else None
    if ocean_flag:
        sst = round(t2m - random.uniform(0,5) + (math.sin(seconds/10000.0)*0.5), 2)
    else:
        sst = None
    # FIRMS count: random small integer, slightly larger in tropics
    fires = int(max(0, round((3.0 * lat_factor) + random.gauss(0,1))))
    # assemble samples
    samples = []
    samples.append({"ts": ts_iso, "source":"POWER", "parameter":"T2M", "value":t2m, "lat":lat, "lon":lon})
    samples.append({"ts": ts_iso, "source":"POWER", "parameter":"ALLSKY_SFC_SW_DWN", "value":solar, "lat":lat, "lon":lon})
    if sst is not None:
        samples.append({"ts": ts_iso, "source":"SST", "parameter":"SST", "value":sst, "lat":lat, "lon":lon})
    else:
        samples.append({"ts": ts_iso, "source":"SST", "parameter":"SST", "value":-999.0, "lat":lat, "lon":lon})
    samples.append({"ts": ts_iso, "source":"FIRMS", "parameter":"fire_count_24h", "value":fires, "lat":lat, "lon":lon})
    return samples

# --- Environmental poller that uses synthetic generator ---
def env_poller(stop_event):
    ensure_env_sheet()
    log("Synthetic ENV poller started (3s cadence)")
    while not stop_event.is_set():
        try:
            with latest_lock:
                lat = latest_data["latitude"] if latest_data else 0.0
                lon = latest_data["longitude"] if latest_data else 0.0
            ts_iso = datetime.utcnow().isoformat() + "Z"
            samples = synth_env_sample(lat, lon, ts_iso)
            # persist and store in memory
            for s in samples:
                # CSV row: ts, source, parameter, value, lat, lon, meta
                meta = ""
                row = [s["ts"], s["source"], s["parameter"], s["value"], s["lat"], s["lon"], meta]
                append_csv(row)
                try:
                    append_excel_row(ENV_EXCEL_SHEET, row)
                except Exception as e:
                    # note: excel might be locked, CSV is authoritative
                    log(f"Excel write warning: {e}")
                with latest_lock:
                    env_samples.appendleft(s)
            # debug log (compact)
            log(f"Synthetic env pushed: {', '.join([s['parameter']+':'+str(s['value']) for s in samples])}")
        except Exception as e:
            log(f"env_poller error: {e}")
        stop_event.wait(POLL_INTERVAL)

# --- start threads ---
stop_event = threading.Event()
iss_thread = threading.Thread(target=poll_iss, args=(stop_event,), daemon=True)
iss_thread.start()

env_stop_event = threading.Event()
env_thread = threading.Thread(target=env_poller, args=(env_stop_event,), daemon=True)
env_thread.start()

# --- HTTP routes ---
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/iss")
def iss():
    with latest_lock:
        if latest_data is None:
            return jsonify({"status":"no_data_yet"}), 503
        return jsonify(latest_data)

@app.route("/env")
def env_route():
    with latest_lock:
        samples = list(env_samples)[:500]
    return jsonify({"status":"ok","samples":samples})

@app.route("/env/test")
def env_test():
    ts = datetime.utcnow().isoformat() + "Z"
    sample = {"ts":ts,"source":"TEST","parameter":"T2M","value":random.uniform(10,30),"lat":0.0,"lon":0.0}
    with latest_lock:
        env_samples.appendleft(sample)
    append_csv([ts,"TEST","T2M",sample["value"],0.0,0.0,"manual"])
    return jsonify({"ok":True,"injected":sample})

@app.route("/download_excel")
def download_excel():
    ensure_excel()
    return send_file(EXCEL_FILE, as_attachment=True)

@app.route("/health")
def health():
    return jsonify({"status":"ok","iss_poll_interval":POLL_INTERVAL})

if __name__ == "__main__":
    try:
        log("Starting Flask app on 0.0.0.0:8080 (synthetic env generator)")
        app.run(host="0.0.0.0", port=8080)
    finally:
        stop_event.set()
        env_stop_event.set()
        log("Stopping threads")
