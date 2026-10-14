/**
 * Smart Medicine Box — script.js
 * نظام علبة الدواء الذكية — ملف التفاعل الكامل
 * الميزات:
 * 1. إنذار صوتي عالي جداً (Medical Siren Synthesizer عبر Web Audio API)
 * 2. اهتزاز متواصل للجوال (Web Vibration API)
 * 3. شاشة إجبار طارئة: لا يتوقف الصوت والاهتزاز حتى تلتقط صورة للدواء
 * 4. حفظ وتأكيد صورة الجرعة
 */

/* ════════════════════════════════════════
   متغيرات الحالة العامة
   ════════════════════════════════════════ */
var _audioCtx = null;
var _alarmOscillator1 = null;
var _alarmOscillator2 = null;
var _alarmGainNode = null;
var _alarmTimer = null;
var _isAlarmActive = false;
var _vibrationInterval = null;

// كاميرا التأكيد الطارئ
var _emergencyStream = null;
var _emergencyCapturedPhoto = null;
var _emergencyActiveChamber = null;

// كاميرا النافذة العادية
var _cameraStream = null;
var _capturedDataUrl = null;
var _activeChamber = null;

/* ════════════════════════════════════════
   عند تحميل الصفحة
   ════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", function () {
  startClock();
  fetchTopbarStatus();
  initSidebarToggle();

  // فحص حالة النظام والإنذارات النشطة كل 4 ثوانٍ
  setInterval(pollSystemStatusAndAlarms, 4000);
  setInterval(fetchTopbarStatus, 30000);

  // فتح قفل الصوت على أول لمسة أو ضغطة على الشاشة (للتوافق مع متصفحات الجوال)
  window.addEventListener("click", unlockAudioContext, { once: true });
  window.addEventListener("touchstart", unlockAudioContext, { once: true });
});

/* ════════════════════════════════════════
   نظام فتح قفل الصوت في المتصفح
   ════════════════════════════════════════ */
function unlockAudioContext() {
  try {
    if (!_audioCtx) {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        _audioCtx = new AudioContextClass();
      }
    }
    if (_audioCtx && _audioCtx.state === "suspended") {
      _audioCtx.resume();
    }
  } catch (e) {
    console.warn("AudioContext init error:", e);
  }
}

/* ════════════════════════════════════════
   نظام الصوت العالي (Medical Alarm Siren)
   صفارة إنذار طبية قوية لا تتوقف إلا عند الإيقاف
   ════════════════════════════════════════ */
function startLoudAlarmSound() {
  if (_isAlarmActive && _alarmGainNode) return; // قيد التشغيل بالفعل
  unlockAudioContext();

  try {
    if (!_audioCtx) {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      _audioCtx = new AudioContextClass();
    }
    if (_audioCtx.state === "suspended") {
      _audioCtx.resume();
    }

    _alarmGainNode = _audioCtx.createGain();
    _alarmGainNode.gain.setValueAtTime(0.85, _audioCtx.currentTime); // صوت عالي جداً
    _alarmGainNode.connect(_audioCtx.destination);

    // مذبذب التردد الأساسي
    _alarmOscillator1 = _audioCtx.createOscillator();
    _alarmOscillator1.type = "sawtooth"; // صوت حاد وملفت للانتباه
    _alarmOscillator1.frequency.setValueAtTime(880, _audioCtx.currentTime);
    _alarmOscillator1.connect(_alarmGainNode);
    _alarmOscillator1.start();

    // مذبذب نغمة متناوبة لعمل صفارة الطوارئ (Siren modulation)
    var isHigh = false;
    _alarmTimer = setInterval(function () {
      if (!_alarmOscillator1 || !_audioCtx) return;
      isHigh = !isHigh;
      // التردد يتناوب بين 880Hz (نغمة A5) و 1320Hz (نغمة E6) بصوت إسعافي عالي
      _alarmOscillator1.frequency.setValueAtTime(isHigh ? 1320 : 880, _audioCtx.currentTime);

      // نبضات متقطعة إضافية لجذب الانتباه
      if (_alarmGainNode) {
        _alarmGainNode.gain.setValueAtTime(isHigh ? 0.9 : 0.4, _audioCtx.currentTime);
      }
    }, 280);

    console.log("[AUDIO] Loud Medical Alarm Siren Started!");
  } catch (err) {
    console.error("Failed to start loud alarm audio:", err);
  }
}

function stopLoudAlarmSound() {
  if (_alarmTimer) {
    clearInterval(_alarmTimer);
    _alarmTimer = null;
  }
  if (_alarmOscillator1) {
    try {
      _alarmOscillator1.stop();
      _alarmOscillator1.disconnect();
    } catch (e) {}
    _alarmOscillator1 = null;
  }
  if (_alarmGainNode) {
    try {
      _alarmGainNode.disconnect();
    } catch (e) {}
    _alarmGainNode = null;
  }
  console.log("[AUDIO] Alarm sound stopped.");
}

/* ════════════════════════════════════════
   نظام اهتزاز الجوال المتواصل (Vibration API)
   ════════════════════════════════════════ */
function startContinuousVibration() {
  if (!("vibrate" in navigator)) {
    console.log("[VIBRATION] Not supported on this desktop/device.");
    return;
  }

  // نمط اهتزاز متواصل: اهتزاز 700ms، توقف 200ms، اهتزاز 700ms، توقف 200ms، اهتزاز 1200ms
  var pattern = [700, 200, 700, 200, 1200, 400];
  try {
    navigator.vibrate(pattern);
    // تكرار الاهتزاز دورياً حتى لا يتوقف
    _vibrationInterval = setInterval(function () {
      if (_isAlarmActive && "vibrate" in navigator) {
        navigator.vibrate(pattern);
      }
    }, 2800);
    console.log("[VIBRATION] Mobile vibration loop started!");
  } catch (err) {
    console.warn("Vibration error:", err);
  }
}

function stopContinuousVibration() {
  if (_vibrationInterval) {
    clearInterval(_vibrationInterval);
    _vibrationInterval = null;
  }
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate(0); // إيقاف الاهتزاز فوراً
    } catch (e) {}
  }
  console.log("[VIBRATION] Mobile vibration stopped.");
}

/* ════════════════════════════════════════
   شاشة الإنذار الطارئ الإلزامية
   🚨 صوت عالي + اهتزاز + كاميرا التقاط
   ════════════════════════════════════════ */
function triggerEmergencyAlarm(alarmData) {
  _isAlarmActive = true;
  _emergencyActiveChamber = alarmData.chamber || "1";
  _emergencyCapturedPhoto = null;

  // ملء بيانات الإنذار في الشاشة
  var chamberEl = document.getElementById("emergencyChamberNum");
  var medEl = document.getElementById("emergencyMedicineInfo");
  if (chamberEl) chamberEl.textContent = "الحجرة رقم " + _emergencyActiveChamber;
  if (medEl) {
    medEl.textContent = (alarmData.medicine || "دواء موعد الآن") + " — " + (alarmData.dose || "الجرعة المحددة");
  }

  // إظهار نافذة الطوارئ
  var overlay = document.getElementById("emergencyAlarmOverlay");
  if (overlay) overlay.classList.add("active");

  // تشغيل الصوت العالي والاهتزاز
  startLoudAlarmSound();
  startContinuousVibration();

  // تشغيل كاميرا الطوارئ
  startEmergencyCamera();

  // إشعار
  showToast("🚨 إنذار وقت الدواء! التقط صورة للدواء لإيقاف الصوت والاهتزاز", "danger");
}

function stopEmergencyAlarm() {
  _isAlarmActive = false;
  stopLoudAlarmSound();
  stopContinuousVibration();
  stopEmergencyCamera();

  var overlay = document.getElementById("emergencyAlarmOverlay");
  if (overlay) overlay.classList.remove("active");

  // إعادة ضبط أزرار كاميرا الطوارئ
  var video = document.getElementById("emergencyVideo");
  var canvas = document.getElementById("emergencyCanvas");
  var badge = document.getElementById("emergencyCapturedBadge");
  var btnCap = document.getElementById("btnEmergencyCapture");
  var btnRet = document.getElementById("btnEmergencyRetake");
  var btnSub = document.getElementById("btnEmergencySubmit");

  if (video) video.style.display = "block";
  if (canvas) canvas.style.display = "none";
  if (badge) badge.classList.remove("visible");
  if (btnCap) btnCap.style.display = "flex";
  if (btnRet) btnRet.style.display = "none";
  if (btnSub) {
    btnSub.classList.remove("ready");
    btnSub.style.display = "none";
  }
}

/* ── كاميرا الطوارئ ── */
function startEmergencyCamera() {
  var video = document.getElementById("emergencyVideo");
  if (!video) return;
  video.style.display = "block";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("الكاميرا غير مدعومة على هذا المتصفح", "danger");
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
    .then(function (stream) {
      _emergencyStream = stream;
      video.srcObject = stream;
      video.play();
    })
    .catch(function (err) {
      console.warn("Emergency Camera Error:", err);
      showToast("يرجى السماح بالوصول للكاميرا لتأكيد الدواء: " + err.message, "danger");
    });
}

function stopEmergencyCamera() {
  if (_emergencyStream) {
    _emergencyStream.getTracks().forEach(function (t) { t.stop(); });
    _emergencyStream = null;
  }
  var video = document.getElementById("emergencyVideo");
  if (video) video.srcObject = null;
}

function captureEmergencyPhoto() {
  var video = document.getElementById("emergencyVideo");
  var canvas = document.getElementById("emergencyCanvas");
  if (!video || !canvas) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  var ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  _emergencyCapturedPhoto = canvas.toDataURL("image/jpeg", 0.85);

  // إيقاف بث الفيديو وعرض الصورة
  stopEmergencyCamera();
  video.style.display = "none";
  canvas.style.display = "block";

  // تحديث عناصر التحكم
  document.getElementById("emergencyCapturedBadge").classList.add("visible");
  document.getElementById("btnEmergencyCapture").style.display = "none";
  document.getElementById("btnEmergencyRetake").style.display = "flex";

  var submitBtn = document.getElementById("btnEmergencySubmit");
  submitBtn.style.display = "flex";
  submitBtn.classList.add("ready");

  showToast("تم التقاط الصورة! اضغط 'تأكيد الجرعة' لإيقاف الصوت والاهتزاز", "info");
}

function retakeEmergencyPhoto() {
  _emergencyCapturedPhoto = null;
  var video = document.getElementById("emergencyVideo");
  var canvas = document.getElementById("emergencyCanvas");
  if (video) video.style.display = "block";
  if (canvas) canvas.style.display = "none";

  document.getElementById("emergencyCapturedBadge").classList.remove("visible");
  document.getElementById("btnEmergencyCapture").style.display = "flex";
  document.getElementById("btnEmergencyRetake").style.display = "none";

  var submitBtn = document.getElementById("btnEmergencySubmit");
  submitBtn.style.display = "none";
  submitBtn.classList.remove("ready");

  startEmergencyCamera();
}

function submitEmergencyConfirmation() {
  if (!_emergencyCapturedPhoto) {
    showToast("يرجى التقاط صورة للدواء أولاً!", "warning");
    return;
  }

  var btn = document.getElementById("btnEmergencySubmit");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحقق وإيقاف الإنذار...';

  fetch("/api/chamber/" + _emergencyActiveChamber + "/taken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo_base64: _emergencyCapturedPhoto })
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check-circle"></i> تأكيد الجرعة وإيقاف الصوت والاهتزاز ✓';

      if (data.status === "ok") {
        // نجاح: إيقاف الصوت والاهتزاز فوراً وإغلاق شاشة الطوارئ!
        stopEmergencyAlarm();
        showToast("✓ تم التحقق بنجاح! تم إيقاف الصوت والاهتزاز وإغلاق الحجرة.", "success");
        if (data.warning) showToast(data.warning, "warning");

        // تحديث حالة الحجرات والسجلات
        setTimeout(pollSystemStatusAndAlarms, 400);
      } else {
        showToast(data.message || "فشل التحقق من الجرعة.", "danger");
      }
    })
    .catch(function (err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check-circle"></i> تأكيد الجرعة وإيقاف الصوت والاهتزاز ✓';
      showToast("تعذّر الاتصال بالخادم. تأكد من عمل الشبكة.", "danger");
    });
}

/* ════════════════════════════════════════
   زر تجربة الإنذار والاهتزاز الفوري
   (للاختبار أمام لجنة التخرج أو للتجربة)
   ════════════════════════════════════════ */
function triggerTestAlarmNow() {
  unlockAudioContext();
  fetch("/api/alarm/trigger-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chamber: "1" })
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.status === "ok" && data.alarm) {
        triggerEmergencyAlarm(data.alarm);
      } else {
        showToast("فشل تفعيل الإنذار التجريبي", "danger");
      }
    })
    .catch(function () {
      // تجربة محلية فورية في حال عدم توفر الخادم
      triggerEmergencyAlarm({
        chamber: "1",
        medicine: "باراسيتامول 500mg (تجربة إنذار واهتزاز)",
        dose: "حبة واحدة"
      });
    });
}

/* ════════════════════════════════════════
   فحص دوري لحالة النظام والإنذارات النشطة
   ════════════════════════════════════════ */
function pollSystemStatusAndAlarms() {
  fetch("/api/status")
    .then(function (r) { return r.json(); })
    .then(function (json) {
      if (json.status !== "ok") return;
      var data = json.data;

      // تحديث واجهة الحجرات الأربع
      if (data.chambers) {
        Object.entries(data.chambers).forEach(function (entry) {
          var id = entry[0], ch = entry[1];
          var card = document.getElementById("chamber-card-" + id);
          var badge = document.getElementById("status-badge-" + id);
          var btn = document.getElementById("btn-" + id);
          if (card) {
            updateChamberUI(id, ch.status === "open", card, badge, btn);
          }
        });
      }

      // إذا وُجد إنذار نشط من الجدولي ولم يتم تشغيل شاشة الطوارئ بعد
      if (data.active_alarm && !_isAlarmActive) {
        triggerEmergencyAlarm(data.active_alarm);
      }
    })
    .catch(function () {});
}

/* ════════════════════════════════════════
   الساعة الجانبية
   ════════════════════════════════════════ */
function startClock() {
  var clockEl = document.getElementById("sidebar-clock");
  if (!clockEl) return;
  function update() {
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    clockEl.textContent = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }
  update();
  setInterval(update, 1000);
}

/* ════════════════════════════════════════
   تحديث الشريط العلوي
   ════════════════════════════════════════ */
function fetchTopbarStatus() {
  fetch("/api/status")
    .then(function (r) { return r.json(); })
    .then(function (json) {
      if (json.status !== "ok") return;
      var d = json.data;
      var bEl = document.getElementById("topbar-battery");
      if (bEl) bEl.textContent = d.battery + "%";
      var wEl = document.getElementById("topbar-wifi");
      if (wEl) {
        var s = d.wifi_signal;
        var lbl = s >= -50 ? "ممتازة" : s >= -65 ? "جيدة" : s >= -75 ? "متوسطة" : "ضعيفة";
        wEl.textContent = lbl + " (" + s + " dBm)";
      }
    })
    .catch(function () {});
}

/* ════════════════════════════════════════
   فتح/إغلاق الحجرات يدوياً
   ════════════════════════════════════════ */
function toggleChamber(chamberId) {
  var btn = document.getElementById("btn-" + chamberId);
  var card = document.getElementById("chamber-card-" + chamberId);
  var badge = document.getElementById("status-badge-" + chamberId);
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري...';

  fetch("/api/chamber/" + chamberId + "/toggle", { method: "POST" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      btn.disabled = false;
      if (data.status !== "ok") {
        showToast(data.message || "حدث خطأ.", "danger");
        resetBtn(btn, card);
        return;
      }
      var isOpen = data.new_status === "open";
      updateChamberUI(chamberId, isOpen, card, badge, btn);
      showToast(isOpen ? "تم فتح الحجرة " + chamberId + "!" : "تم إغلاق الحجرة " + chamberId + "!",
        isOpen ? "success" : "info");
    })
    .catch(function () {
      btn.disabled = false;
      resetBtn(btn, card);
      showToast("تعذّر الاتصال بالخادم.", "danger");
    });
}

function resetBtn(btn, card) {
  var isOpen = card && card.classList.contains("chamber-open");
  btn.innerHTML = isOpen
    ? '<i class="fas fa-lock"></i> إغلاق الحجرة'
    : '<i class="fas fa-lock-open"></i> فتح الحجرة';
}

function updateChamberUI(id, isOpen, card, badge, btn) {
  if (card) {
    card.classList.toggle("chamber-open", isOpen);
    card.classList.toggle("chamber-closed", !isOpen);
  }
  if (badge) {
    badge.innerHTML = isOpen
      ? '<i class="fas fa-lock-open"></i> مفتوحة'
      : '<i class="fas fa-lock"></i> مغلقة';
  }
  if (btn) {
    btn.dataset.status = isOpen ? "open" : "closed";
    btn.innerHTML = isOpen
      ? '<i class="fas fa-lock"></i> إغلاق الحجرة'
      : '<i class="fas fa-lock-open"></i> فتح الحجرة';
  }
  var btnT = document.getElementById("btn-taken-" + id);
  if (btnT) {
    if (isOpen) {
      btnT.disabled = false;
      btnT.classList.remove("btn-taken-disabled");
    } else {
      btnT.disabled = true;
      btnT.classList.add("btn-taken-disabled");
    }
  }
}

/* ════════════════════════════════════════
   نافذة الكاميرا العادية (عند الضغط اليدوي)
   ════════════════════════════════════════ */
function markTaken(chamberId) {
  _activeChamber = chamberId;
  _capturedDataUrl = null;

  var card = document.getElementById("chamber-card-" + chamberId);
  var medNameEl = document.getElementById("cam-medicine-name");
  var medLabelEl = document.getElementById("cam-chamber-label");
  if (card) {
    var nameEl = card.querySelector(".chamber-medicine-name");
    if (medNameEl && nameEl) medNameEl.textContent = nameEl.textContent;
  }
  if (medLabelEl) medLabelEl.textContent = "الحجرة " + chamberId;

  resetCameraUI();
  var modal = document.getElementById("cameraModal");
  if (modal) modal.classList.add("active");
  startCamera();
}

function startCamera() {
  var video = document.getElementById("cameraVideo");
  if (!video) return;
  video.style.display = "block";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("المتصفح لا يدعم الكاميرا.", "danger");
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
    .then(function (stream) {
      _cameraStream = stream;
      video.srcObject = stream;
      video.play();
    })
    .catch(function (err) {
      console.error("Camera error:", err);
      showToast("تعذّر فتح الكاميرا: " + err.message, "danger");
      video.style.display = "none";
    });
}

function stopCamera() {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(function (t) { t.stop(); });
    _cameraStream = null;
  }
  var video = document.getElementById("cameraVideo");
  if (video) video.srcObject = null;
}

function capturePhoto() {
  var video = document.getElementById("cameraVideo");
  var canvas = document.getElementById("capturedCanvas");
  if (!video || !video.srcObject || !canvas) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  var ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  _capturedDataUrl = canvas.toDataURL("image/jpeg", 0.85);

  stopCamera();
  video.style.display = "none";
  canvas.style.display = "block";

  var badge = document.getElementById("capturedBadge");
  if (badge) badge.classList.add("visible");
  var scan = document.getElementById("scanLine");
  if (scan) scan.style.display = "none";
  var bCap = document.getElementById("btnCapture");
  if (bCap) bCap.style.display = "none";
  var bRet = document.getElementById("btnRetake");
  if (bRet) bRet.classList.add("visible");
  var bSend = document.getElementById("btnConfirmSend");
  if (bSend) bSend.classList.add("ready");

  showToast("تم التقاط الصورة! اضغط 'تأكيد وتسجيل' للإرسال.", "success");
}

function retakePhoto() {
  _capturedDataUrl = null;
  var canvas = document.getElementById("capturedCanvas");
  var video = document.getElementById("cameraVideo");
  if (canvas) canvas.style.display = "none";
  if (video) video.style.display = "block";

  var badge = document.getElementById("capturedBadge");
  if (badge) badge.classList.remove("visible");
  var scan = document.getElementById("scanLine");
  if (scan) scan.style.display = "block";
  var bCap = document.getElementById("btnCapture");
  if (bCap) bCap.style.display = "flex";
  var bRet = document.getElementById("btnRetake");
  if (bRet) bRet.classList.remove("visible");
  var bSend = document.getElementById("btnConfirmSend");
  if (bSend) bSend.classList.remove("ready");
  startCamera();
}

function sendConfirmation() {
  if (!_capturedDataUrl) {
    showToast("يجب التقاط صورة أولاً.", "warning");
    return;
  }
  if (!_activeChamber) return;

  var btn = document.getElementById("btnConfirmSend");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';

  fetch("/api/chamber/" + _activeChamber + "/taken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo_base64: _capturedDataUrl })
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check-double"></i> تأكيد وتسجيل';
      if (data.status === "ok") {
        showToast(data.message, "success");
        if (data.warning) showToast(data.warning, "warning");
        closeCameraModal();
        setTimeout(pollSystemStatusAndAlarms, 400);
      } else {
        showToast(data.message || "حدث خطأ.", "danger");
      }
    })
    .catch(function () {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check-double"></i> تأكيد وتسجيل';
      showToast("تعذّر الاتصال بالخادم.", "danger");
    });
}

function closeCameraModal() {
  stopCamera();
  var modal = document.getElementById("cameraModal");
  if (modal) modal.classList.remove("active");
  _activeChamber = null;
  _capturedDataUrl = null;
}

function resetCameraUI() {
  var canvas = document.getElementById("capturedCanvas");
  var video = document.getElementById("cameraVideo");
  if (canvas) canvas.style.display = "none";
  if (video) video.style.display = "block";
  var badge = document.getElementById("capturedBadge");
  if (badge) badge.classList.remove("visible");
  var scan = document.getElementById("scanLine");
  if (scan) scan.style.display = "block";
  var bCap = document.getElementById("btnCapture");
  if (bCap) bCap.style.display = "flex";
  var bRet = document.getElementById("btnRetake");
  if (bRet) bRet.classList.remove("visible");
  var bSend = document.getElementById("btnConfirmSend");
  if (bSend) {
    bSend.classList.remove("ready");
    bSend.disabled = false;
    bSend.innerHTML = '<i class="fas fa-check-double"></i> تأكيد وتسجيل';
  }
}

/* ════════════════════════════════════════
   Toast Notifications
   ════════════════════════════════════════ */
function showToast(message, type) {
  type = type || "info";
  var container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  var icons = {
    success: "fa-check-circle",
    danger: "fa-times-circle",
    warning: "fa-exclamation-triangle",
    info: "fa-info-circle"
  };
  var toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.innerHTML = '<i class="fas ' + (icons[type] || "fa-info-circle") + '"></i><span>' + message + '</span><i class="fas fa-times toast-close"></i>';
  toast.addEventListener("click", function () { removeToast(toast); });
  container.appendChild(toast);
  setTimeout(function () { removeToast(toast); }, 4500);
}

function removeToast(toast) {
  toast.style.opacity = "0";
  toast.style.transform = "translateX(-30px)";
  toast.style.transition = "all 0.3s ease";
  setTimeout(function () {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 300);
}

/* ════════════════════════════════════════
   Sidebar Toggle (Mobile)
   ════════════════════════════════════════ */
function initSidebarToggle() {
  var btn = document.getElementById("sidebarToggle");
  var sidebar = document.querySelector(".sidebar");
  if (!btn || !sidebar) return;
  btn.addEventListener("click", function () {
    sidebar.classList.toggle("open");
  });
  document.addEventListener("click", function (e) {
    if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !btn.contains(e.target)) {
      sidebar.classList.remove("open");
    }
  });
}
