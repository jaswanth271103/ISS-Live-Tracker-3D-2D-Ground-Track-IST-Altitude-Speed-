@app.route("/env/test")
def env_test():
    # push a manual test sample into memory and CSV
    from datetime import datetime
    ts = datetime.utcnow().isoformat() + "Z"
    sample_power = {"ts": ts, "source": "POWER", "parameter": "T2M", "value": 22.5, "lat": 40.7128, "lon": -74.0060}
    sample_solar = {"ts": ts, "source": "POWER", "parameter": "ALLSKY_SFC_SW_DWN", "value": 350.0, "lat": 40.7128, "lon": -74.0060}
    sample_firms = {"ts": ts, "source": "FIRMS", "parameter": "fire_count_24h", "value": 5, "lat": 40.7128, "lon": -74.0060}
    # append to in-memory env_samples (thread-safe)
    try:
        with latest_lock:
            env_samples.appendleft(sample_power)
            env_samples.appendleft(sample_solar)
            env_samples.appendleft(sample_firms)
        # also append to CSV for persistence
        append_csv([ts, "POWER", "T2M", 22.5, 40.7128, -74.0060, "test"])
        append_csv([ts, "POWER", "ALLSKY_SFC_SW_DWN", 350.0, 40.7128, -74.0060, "test"])
        append_csv([ts, "FIRMS", "fire_count_24h", 5, 40.7128, -74.0060, "test"])
        return jsonify({"ok": True, "message": "test samples injected"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})
