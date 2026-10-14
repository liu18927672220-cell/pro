"""
Smart Medicine Box - Server (server.py)
========================================
نظام علبة الدواء الذكية - الكود الخلفي
الجديد: تأكيد أخذ الدواء بالتقاط صورة من الكاميرا
"""

from flask import Flask, render_template, jsonify, request, send_from_directory
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
import threading
import base64
import os
import re

app = Flask(__name__)

# ─────────────────────────────────────────────
#  مجلد حفظ صور التأكيد
# ─────────────────────────────────────────────
CONFIRMATIONS_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "static", "confirmations"
)
os.makedirs(CONFIRMATIONS_DIR, exist_ok=True)

# ─────────────────────────────────────────────
#  بيانات النظام
# ─────────────────────────────────────────────
system_state = {
    "connected": True,
    "battery": 78,
    "wifi_signal": -62,
    "last_seen": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "active_alarm": None,  # الإنذار النشط الحالي للجرعة
    "chambers": {
        "1": {"name": "باراسيتامول 500mg", "status": "closed", "pills_left": 14, "auto_opened_at": None},
        "2": {"name": "أموكسيسيلين 250mg", "status": "closed", "pills_left": 7,  "auto_opened_at": None},
        "3": {"name": "فيتامين C 1000mg",  "status": "closed", "pills_left": 30, "auto_opened_at": None},
        "4": {"name": "أوميغا 3",           "status": "closed", "pills_left": 20, "auto_opened_at": None},
    }
}

# ─────────────────────────────────────────────
#  جدول المواعيد
# ─────────────────────────────────────────────
schedule_data = [
    {
        "id": 1, "medicine": "باراسيتامول 500mg", "chamber": "1",
        "dose": "حبة واحدة", "times": ["08:00", "14:00", "20:00"],
        "days": ["السبت","الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة"],
        "notes": "بعد الأكل"
    },
    {
        "id": 2, "medicine": "أموكسيسيلين 250mg", "chamber": "2",
        "dose": "حبتان", "times": ["09:00", "21:00"],
        "days": ["السبت","الاثنين","الأربعاء"],
        "notes": "مع كوب ماء كامل"
    },
    {
        "id": 3, "medicine": "فيتامين C 1000mg", "chamber": "3",
        "dose": "حبة واحدة", "times": ["07:30"],
        "days": ["السبت","الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة"],
        "notes": "على معدة فارغة"
    },
    {
        "id": 4, "medicine": "أوميغا 3", "chamber": "4",
        "dose": "حبة واحدة", "times": ["13:00"],
        "days": ["السبت","الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة"],
        "notes": "مع الوجبة"
    },
]

# ─────────────────────────────────────────────
#  سجلات التأكيد بالصور
# ─────────────────────────────────────────────
confirmation_records = []   # قائمة الصور المحفوظة

# ─────────────────────────────────────────────
#  سجل الأحداث
# ─────────────────────────────────────────────
event_logs = [
    {"id": 1, "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
     "type": "info", "event": "النظام بدأ التشغيل", "chamber": "-",
     "photo": None},
]

_lock = threading.Lock()

def add_log(event_type: str, event_msg: str, chamber: str = "-", photo: str = None):
    with _lock:
        new_id = max((log["id"] for log in event_logs), default=0) + 1
        event_logs.append({
            "id":        new_id,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "type":      event_type,
            "event":     event_msg,
            "chamber":   chamber,
            "photo":     photo,   # مسار الصورة إن وُجدت
        })


# ══════════════════════════════════════════════════════════
#  نظام الجدولة التلقائية
# ══════════════════════════════════════════════════════════
ARABIC_DAYS = {
    "السبت": 6, "الأحد": 7, "الاثنين": 1,
    "الثلاثاء": 2, "الأربعاء": 3, "الخميس": 4, "الجمعة": 5,
}
_opened_today = set()

def check_and_open_chambers():
    now = datetime.now()
    current_time_str = now.strftime("%H:%M")
    current_date_str = now.strftime("%Y-%m-%d")
    current_day_iso  = now.isoweekday()

    for entry in schedule_data:
        ch_key = entry["chamber"]
        entry_days = [ARABIC_DAYS.get(d) for d in entry.get("days", [])]
        if current_day_iso not in entry_days:
            continue
        for dose_time in entry["times"]:
            session_key = f"{current_date_str}|{entry['id']}|{dose_time}"
            if dose_time == current_time_str and session_key not in _opened_today:
                _opened_today.add(session_key)
                with _lock:
                    ch = system_state["chambers"].get(ch_key)
                    if ch:
                        ch["status"] = "open"
                        ch["auto_opened_at"] = now.isoformat()
                    system_state["active_alarm"] = {
                        "id": f"alarm_{ch_key}_{now.strftime('%H%M%S')}",
                        "chamber": ch_key,
                        "medicine": entry["medicine"],
                        "dose": entry["dose"],
                        "time": dose_time,
                        "timestamp": now.isoformat(),
                        "requires_photo": True,
                        "alarm_active": True
                    }
                add_log("warning",
                        f"[تنبيه جرعة] حان وقت الدواء! إنذار واهتزاز للحجرة {ch_key} - {entry['medicine']} ({entry['dose']})",
                        ch_key)
                print(f"[AUTO-ALARM] Chamber {ch_key} OPENED at {dose_time}. Loud alarm & vibration active!")

    TIMEOUT = 5
    with _lock:
        for ch_key, ch in system_state["chambers"].items():
            if ch["status"] == "open" and ch.get("auto_opened_at"):
                elapsed = (now - datetime.fromisoformat(ch["auto_opened_at"])).total_seconds() / 60
                if elapsed >= TIMEOUT:
                    ch["status"] = "closed"
                    ch["auto_opened_at"] = None
                    if system_state.get("active_alarm") and str(system_state["active_alarm"].get("chamber")) == ch_key:
                        system_state["active_alarm"] = None
                    add_log("danger",
                            f"[إنذار] جرعة فائتة! الحجرة {ch_key} - {ch['name']} لم يُؤخذ الدواء خلال {TIMEOUT} دقائق",
                            ch_key)

def start_scheduler():
    scheduler = BackgroundScheduler()
    scheduler.add_job(func=check_and_open_chambers, trigger="cron",
                      second=0, id="dose_checker", replace_existing=True)
    scheduler.start()
    print("[SCHEDULER] Auto-dose scheduler started.")
    return scheduler


# ══════════════════════════════════════════════
#  المسارات
# ══════════════════════════════════════════════

@app.route("/")
def index():
    system_state["last_seen"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return render_template("index.html", state=system_state)

@app.route("/schedule")
def schedule():
    return render_template("schedule.html", schedule=schedule_data)

@app.route("/logs")
def logs():
    with _lock:
        sorted_logs = sorted(event_logs, key=lambda x: x["id"], reverse=True)
        logs_copy = list(sorted_logs)
    return render_template("logs.html", logs=logs_copy)

@app.route("/confirmations")
def confirmations_page():
    with _lock:
        records = sorted(confirmation_records, key=lambda x: x["id"], reverse=True)
    return render_template("confirmations.html", records=records)


# ══════════════════════════════════════════════
#  API
# ══════════════════════════════════════════════

@app.route("/api/status")
def api_status():
    system_state["last_seen"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return jsonify({"status": "ok", "data": system_state,
                    "timestamp": datetime.now().isoformat()})

@app.route("/api/chamber/<int:chamber_id>/toggle", methods=["POST"])
def toggle_chamber(chamber_id):
    ch_key = str(chamber_id)
    if ch_key not in system_state["chambers"]:
        return jsonify({"status": "error", "message": f"الحجرة {chamber_id} غير موجودة"}), 404
    with _lock:
        ch = system_state["chambers"][ch_key]
        if ch["status"] == "closed":
            ch["status"] = "open"
            ch["auto_opened_at"] = datetime.now().isoformat()
            msg = f"فُتحت الحجرة {chamber_id} يدوياً - {ch['name']}"
        else:
            ch["status"] = "closed"
            ch["auto_opened_at"] = None
            msg = f"أُغلقت الحجرة {chamber_id} يدوياً - {ch['name']}"
        new_status = ch["status"]
    add_log("info", msg, ch_key)
    return jsonify({"status": "ok", "chamber_id": chamber_id,
                    "new_status": new_status, "message": msg})


# ── تأكيد أخذ الدواء بالصورة ──────────────────────────────
@app.route("/api/chamber/<int:chamber_id>/taken", methods=["POST"])
def medicine_taken(chamber_id):
    """
    يستقبل:
      { "photo_base64": "data:image/jpeg;base64,..." }
    يحفظ الصورة ويُسجّل الحدث.
    """
    ch_key = str(chamber_id)
    if ch_key not in system_state["chambers"]:
        return jsonify({"status": "error", "message": f"الحجرة {chamber_id} غير موجودة"}), 404

    data = request.get_json(force=True) or {}
    photo_b64 = data.get("photo_base64", "")

    # ── التحقق من وجود الصورة ──
    if not photo_b64 or not photo_b64.startswith("data:image"):
        return jsonify({
            "status": "error",
            "message": "يجب التقاط صورة للتأكيد قبل التسجيل."
        }), 400

    # ── حفظ الصورة على القرص ──
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"chamber{chamber_id}_{ts}.jpg"
    filepath = os.path.join(CONFIRMATIONS_DIR, filename)

    try:
        # إزالة رأس base64
        header, encoded = photo_b64.split(",", 1)
        img_bytes = base64.b64decode(encoded)
        with open(filepath, "wb") as f:
            f.write(img_bytes)
        photo_url = f"/static/confirmations/{filename}"
    except Exception as e:
        return jsonify({"status": "error", "message": f"فشل حفظ الصورة: {str(e)}"}), 500

    # ── تحديث حالة الحجرة ──
    with _lock:
        ch = system_state["chambers"][ch_key]
        ch["status"]         = "closed"
        ch["auto_opened_at"] = None
        if ch["pills_left"] > 0:
            ch["pills_left"] -= 1
        ch_name    = ch["name"]
        pills_left = ch["pills_left"]
        if system_state.get("active_alarm") and str(system_state["active_alarm"].get("chamber")) == ch_key:
            system_state["active_alarm"] = None

    # ── تسجيل سجل التأكيد ──
    with _lock:
        rec_id = max((r["id"] for r in confirmation_records), default=0) + 1
        confirmation_records.append({
            "id":        rec_id,
            "chamber":   ch_key,
            "medicine":  ch_name,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "photo_url": photo_url,
            "filename":  filename,
        })

    # ── إضافة للسجل العام ──
    add_log("success",
            f"[مؤكَّد بصورة] تم أخذ الدواء من الحجرة {chamber_id} - {ch_name}",
            ch_key, photo=photo_url)

    warning = None
    if pills_left <= 5:
        warning = f"تحذير: الحبوب المتبقية في الحجرة {chamber_id} ({ch_name}) = {pills_left} فقط!"
        add_log("warning", warning, ch_key)

    return jsonify({
        "status":     "ok",
        "message":    f"تم تأكيد أخذ الدواء بنجاح - {ch_name}",
        "photo_url":  photo_url,
        "pills_left": pills_left,
        "warning":    warning,
    })


# ── API الجدول ──
@app.route("/api/schedule/add", methods=["POST"])
def add_schedule():
    data = request.get_json(force=True)
    for field in ["medicine", "chamber", "dose", "times", "days"]:
        if field not in data:
            return jsonify({"status": "error", "message": f"الحقل '{field}' مطلوب"}), 400
    new_id = max((s["id"] for s in schedule_data), default=0) + 1
    new_entry = {
        "id": new_id, "medicine": data["medicine"], "chamber": str(data["chamber"]),
        "dose": data["dose"], "times": data["times"], "days": data["days"],
        "notes": data.get("notes", ""),
    }
    schedule_data.append(new_entry)
    add_log("success", f"أُضيف دواء جديد: {data['medicine']}", str(data["chamber"]))
    return jsonify({"status": "ok", "entry": new_entry})

@app.route("/api/schedule/delete/<int:schedule_id>", methods=["DELETE"])
def delete_schedule(schedule_id):
    for i, e in enumerate(schedule_data):
        if e["id"] == schedule_id:
            removed = schedule_data.pop(i)
            add_log("warning", f"حُذف الدواء: {removed['medicine']}")
            return jsonify({"status": "ok", "message": "تم الحذف"})
    return jsonify({"status": "error", "message": "الموعد غير موجود"}), 404

@app.route("/api/logs")
def api_logs():
    limit = request.args.get("limit", 20, type=int)
    with _lock:
        result = sorted(event_logs, key=lambda x: x["id"], reverse=True)[:limit]
    return jsonify({"status": "ok", "logs": list(result)})

@app.route("/api/logs/clear", methods=["POST"])
def clear_logs():
    with _lock:
        event_logs.clear()
    add_log("info", "تم مسح جميع السجلات")
    return jsonify({"status": "ok", "message": "تم المسح"})

@app.route("/api/next-dose")
def next_dose():
    now = datetime.now()
    cur = now.strftime("%H:%M")
    day = now.isoweekday()
    upcoming = []
    for entry in schedule_data:
        days_nums = [ARABIC_DAYS.get(d) for d in entry.get("days", [])]
        if day not in days_nums:
            continue
        for t in entry["times"]:
            if t >= cur:
                upcoming.append({"medicine": entry["medicine"], "chamber": entry["chamber"],
                                 "time": t, "dose": entry["dose"]})
    upcoming.sort(key=lambda x: x["time"])
    return jsonify({"status": "ok", "next_dose": upcoming[0] if upcoming else None})

@app.route("/api/test/trigger", methods=["POST"])
def test_trigger():
    check_and_open_chambers()
    return jsonify({"status": "ok", "message": "تم تشغيل الفحص يدوياً."})

# ── API: اختبار الإنذار والاهتزاز الفوري ──
@app.route("/api/alarm/trigger-test", methods=["POST"])
def trigger_test_alarm():
    data = request.get_json(silent=True) or {}
    ch_key = str(data.get("chamber", "1"))
    now = datetime.now()
    with _lock:
        ch = system_state["chambers"].get(ch_key)
        if ch:
            ch["status"] = "open"
            ch["auto_opened_at"] = now.isoformat()
            med_name = ch["name"]
        else:
            med_name = "دواء تجريبي"
        system_state["active_alarm"] = {
            "id": f"test_alarm_{ch_key}_{now.strftime('%H%M%S')}",
            "chamber": ch_key,
            "medicine": med_name,
            "dose": "حبة واحدة",
            "time": now.strftime("%H:%M"),
            "timestamp": now.isoformat(),
            "requires_photo": True,
            "alarm_active": True
        }
    add_log("warning", f"[تجربة إنذار] تشغيل إنذار واهتزاز فوري للحجرة {ch_key} - {med_name}", ch_key)
    return jsonify({
        "status": "ok",
        "message": f"تم تفعيل الإنذار الصوتي والاهتزاز للحجرة {ch_key}",
        "alarm": system_state["active_alarm"]
    })

@app.route("/api/alarm/stop-manual", methods=["POST"])
def stop_manual_alarm():
    with _lock:
        system_state["active_alarm"] = None
    return jsonify({"status": "ok", "message": "تم إيقاف الإنذار يدوياً"})

# ── API: قائمة صور التأكيد ──
@app.route("/api/confirmations")
def api_confirmations():
    with _lock:
        result = sorted(confirmation_records, key=lambda x: x["id"], reverse=True)
    return jsonify({"status": "ok", "confirmations": list(result)})


# ══════════════════════════════════════════════
#  تشغيل
# ══════════════════════════════════════════════
if __name__ == "__main__":
    scheduler = start_scheduler()
    print("=" * 55)
    print("  Smart Medicine Box - Server is running")
    print("  URL: http://127.0.0.1:5000")
    print("  Photo confirmations: ENABLED")
    print("=" * 55)
    try:
        app.run(debug=False, host="0.0.0.0", port=5000, use_reloader=False)
    finally:
        scheduler.shutdown()
