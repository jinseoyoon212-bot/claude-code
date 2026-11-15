package com.aurora.agent;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.net.Uri;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.accessibility.AccessibilityManager;

import androidx.activity.result.ActivityResult;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import rikka.shizuku.Shizuku;

import java.io.ByteArrayOutputStream;
import java.lang.reflect.Method;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** 폰 자체를 다루는 도구 모음: 셸/파일/앱 실행/화면 조작 */
@CapacitorPlugin(name = "AuroraDevice", permissions = { @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }) })
public class AuroraDevicePlugin extends Plugin {
    private interface Job { JSObject run() throws Exception; }

    private void async(final PluginCall call, final Job job) {
        new Thread(new Runnable() {
            @Override public void run() {
                try { call.resolve(job.run()); }
                catch (Throwable t) { call.reject(t.getMessage() != null ? t.getMessage() : t.toString()); }
            }
        }).start();
    }

    private Context ctx() { return getContext(); }
    private static final String A11Y_OFF = "접근성 서비스가 꺼져 있어요. open_accessibility_settings 도구로 설정을 열고, 사용자에게 'Aurora Agent'를 켜 달라고 안내하세요. 목록에 없으면 설정 화면의 '접근성 진단' 버튼을 안내하세요.";

    private File resolve(String p) {
        if (p == null || p.isEmpty()) return Environment.getExternalStorageDirectory();
        if (p.equals("~")) return Environment.getExternalStorageDirectory();
        if (p.startsWith("~/")) return new File(Environment.getExternalStorageDirectory(), p.substring(2));
        return new File(p);
    }

    private boolean hasAllFiles() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return ContextCompat.checkSelfPermission(ctx(), Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(ctx(), Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    /** 접근성 서비스가 켜져 있으면 그 컨텍스트로 (백그라운드에서도 화면 전환 가능), 아니면 앱 컨텍스트로 */
    private void startAny(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Context c = AuroraAccessibilityService.instance != null ? AuroraAccessibilityService.instance : ctx();
        c.startActivity(i);
    }

    private static String clip(String s, int n) { return s.length() > n ? s.substring(0, n) + "\n...[" + (s.length() - n) + "자 생략]" : s; }

    // ---------- 정보 ----------
    @PluginMethod public void deviceInfo(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            JSObject o = new JSObject();
            o.put("manufacturer", Build.MANUFACTURER); o.put("model", Build.MODEL);
            o.put("android", Build.VERSION.RELEASE); o.put("sdk", Build.VERSION.SDK_INT);
            Intent b = ctx().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b != null) { int l = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), s = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100); o.put("batteryPercent", l * 100 / Math.max(1, s)); }
            StatFs st = new StatFs(Environment.getExternalStorageDirectory().getPath());
            o.put("storageFreeGB", Math.round(st.getAvailableBytes() / 1e8) / 10.0); o.put("storageTotalGB", Math.round(st.getTotalBytes() / 1e8) / 10.0);
            DisplayMetrics dm = ctx().getResources().getDisplayMetrics();
            o.put("screenWidthPx", dm.widthPixels); o.put("screenHeightPx", dm.heightPixels);
            o.put("allFilesAccess", hasAllFiles()); o.put("accessibilityEnabled", AuroraAccessibilityService.instance != null);
            o.put("storageRoot", Environment.getExternalStorageDirectory().getAbsolutePath());
            return o;
        }});
    }

    @PluginMethod public void requestAllFilesAccess(final PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + ctx().getPackageName()));
                startAny(i);
            } else {
                ActivityCompat.requestPermissions(getActivity(), new String[]{ Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE }, 1001);
            }
            JSObject o = new JSObject(); o.put("opened", true); call.resolve(o);
        } catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    @PluginMethod public void openAccessibilitySettings(final PluginCall call) {
        try { startAny(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); JSObject o = new JSObject(); o.put("opened", true); call.resolve(o); }
        catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    @PluginMethod public void bringToFront(final PluginCall call) {
        try {
            Intent i = ctx().getPackageManager().getLaunchIntentForPackage(ctx().getPackageName());
            if (i != null) { i.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP); startAny(i); }
            JSObject o = new JSObject(); o.put("ok", i != null); call.resolve(o);
        } catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    /** 접근성 '목록'을 거치지 않고 우리 서비스의 상세(켜기/끄기) 페이지로 바로 이동 (안드로이드 14+). 실패하면 일반 접근성 설정으로 대체 */
    @PluginMethod public void openA11yDetails(final PluginCall call) {
        JSObject o = new JSObject();
        try {
            Intent i = new Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS");
            i.putExtra("android.intent.extra.COMPONENT_NAME", new ComponentName(ctx().getPackageName(), AuroraAccessibilityService.class.getName()).flattenToString());
            startAny(i); o.put("opened", "details"); call.resolve(o); return;
        } catch (Throwable t) { /* 아래 대체 경로 */ }
        try { startAny(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); o.put("opened", "list"); call.resolve(o); }
        catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    @PluginMethod public void openAppInfo(final PluginCall call) {
        try {
            startAny(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx().getPackageName())));
            JSObject o = new JSObject(); o.put("opened", true); call.resolve(o);
        } catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    /** 시스템이 우리 접근성 서비스를 인식하는지/켜졌는지/연결됐는지 진단 */
    @PluginMethod public void a11yDiagnose(final PluginCall call) {
        try {
            AccessibilityManager am = (AccessibilityManager) ctx().getSystemService(Context.ACCESSIBILITY_SERVICE);
            boolean registered = false;
            for (AccessibilityServiceInfo i : am.getInstalledAccessibilityServiceList()) {
                if (i.getResolveInfo().serviceInfo.packageName.equals(ctx().getPackageName())) registered = true;
            }
            String en = Settings.Secure.getString(ctx().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            JSObject o = new JSObject();
            o.put("registered", registered);
            o.put("enabledInSettings", en != null && en.contains(ctx().getPackageName()));
            o.put("connected", AuroraAccessibilityService.instance != null);
            o.put("android", Build.VERSION.SDK_INT); o.put("maker", Build.MANUFACTURER);
            call.resolve(o);
        } catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    /** 설정 목록 없이 접근성을 직접 켠다. adb로 WRITE_SECURE_SETTINGS를 1회 허용해 둬야 동작 */
    @PluginMethod public void enableA11yViaSecureSettings(final PluginCall call) {
        try {
            ContentResolver cr = ctx().getContentResolver();
            String cn = ctx().getPackageName() + "/" + AuroraAccessibilityService.class.getName();
            String cur = Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (cur == null) cur = "";
            if (!cur.contains(cn)) cur = cur.isEmpty() ? cn : cur + ":" + cn;
            Settings.Secure.putString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, cur);
            Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 1);
            JSObject o = new JSObject(); o.put("enabled", true); call.resolve(o);
        } catch (SecurityException se) {
            call.reject("권한이 없어요. PC에서 USB 디버깅으로: adb shell pm grant " + ctx().getPackageName() + " android.permission.WRITE_SECURE_SETTINGS");
        } catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    @PluginMethod public void setClipboard(final PluginCall call) {
        final String text = call.getString("text", "");
        getActivity().runOnUiThread(new Runnable() { public void run() {
            try {
                ClipboardManager cm = (ClipboardManager) ctx().getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("aurora", text));
                JSObject o = new JSObject(); o.put("ok", true); call.resolve(o);
            } catch (Throwable t) { call.reject(String.valueOf(t)); }
        }});
    }

    // ---------- 어시스턴트(홈 길게 누르기) / 음성 ----------
    private static TextToSpeech tts;
    private SpeechRecognizer recognizer;

    /** 기기의 실제 음성인식 서비스(우리 프록시 제외)를 찾는다. 구글 서비스를 우선 */
    public static ComponentName pickRealRecognizer(Context c) {
        try {   // 1) 시스템 기본 음성인식기 (Aurora 프록시가 아닌 경우)
            String def = Settings.Secure.getString(c.getContentResolver(), "voice_recognition_service");
            if (def != null) { ComponentName d = ComponentName.unflattenFromString(def); if (d != null && !d.getPackageName().equals(c.getPackageName())) return d; }
        } catch (Throwable ignored) { }
        List<ResolveInfo> l = c.getPackageManager().queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE), 0);
        ComponentName google = null, other = null;
        for (ResolveInfo r : l) {   // 2) 구글 앱 우선, 3) 그 외
            if (r.serviceInfo == null || r.serviceInfo.packageName.equals(c.getPackageName())) continue;
            ComponentName cn = new ComponentName(r.serviceInfo.packageName, r.serviceInfo.name);
            if (r.serviceInfo.packageName.equals("com.google.android.googlequicksearchbox")) return cn;
            if (r.serviceInfo.packageName.contains("google") && google == null) google = cn;
            else if (other == null) other = cn;
        }
        return google != null ? google : other;
    }

    @PluginMethod public void assistReady(final PluginCall call) {
        try { if (getActivity() instanceof AssistActivity) ((AssistActivity) getActivity()).showWeb(); } catch (Throwable ignored) { }
        call.resolve();
    }

    /** 호출 순간의 화면 캡처(JPEG base64). 없으면 image:null */
    @PluginMethod public void getAssistScreenshot(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            android.graphics.Bitmap b = AuroraAssistState.screenshot;
            JSObject o = new JSObject();
            if (b == null) { o.put("image", JSObject.NULL); return o; }
            int max = call.getInt("maxPx", 1600); float q = call.getFloat("quality", 0.82f);
            int w = b.getWidth(), h = b.getHeight(); float s = Math.min(1f, (float) max / Math.max(w, h));
            android.graphics.Bitmap t = s < 1f ? android.graphics.Bitmap.createScaledBitmap(b, Math.round(w * s), Math.round(h * s), true) : b;
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            t.compress(android.graphics.Bitmap.CompressFormat.JPEG, Math.round(q * 100), bo);
            o.put("image", android.util.Base64.encodeToString(bo.toByteArray(), android.util.Base64.NO_WRAP));
            o.put("width", w); o.put("height", h); o.put("sentWidth", t.getWidth()); o.put("sentHeight", t.getHeight());
            return o;
        }});
    }

    @PluginMethod public void isAssistMode(final PluginCall call) {
        JSObject o = new JSObject(); o.put("assist", getActivity() instanceof AssistActivity); call.resolve(o);
    }

    @PluginMethod public void closeAssist(final PluginCall call) {
        try { if (getActivity() instanceof AssistActivity) { getActivity().finish(); getActivity().overridePendingTransition(0, 0); } } catch (Throwable ignored) { }
        call.resolve();
    }

    @PluginMethod public void previewAssist(final PluginCall call) {
        try { startAny(new Intent(ctx(), AssistActivity.class)); JSObject o = new JSObject(); o.put("opened", true); call.resolve(o); }
        catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    @PluginMethod public void openAssistantSettings(final PluginCall call) {
        JSObject o = new JSObject();
        try { startAny(new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)); o.put("opened", "voice-input"); call.resolve(o); return; } catch (Throwable ignored) { }
        try { startAny(new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)); o.put("opened", "default-apps"); call.resolve(o); }
        catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    @PluginMethod public void speak(final PluginCall call) {
        final String text = call.getString("text", "");
        getActivity().runOnUiThread(new Runnable() { public void run() {
            try {
                if (tts == null) {
                    tts = new TextToSpeech(ctx().getApplicationContext(), new TextToSpeech.OnInitListener() {
                        public void onInit(int status) {
                            if (status != TextToSpeech.SUCCESS) { tts = null; call.reject("음성 합성(TTS)을 쓸 수 없어요."); return; }
                            tts.setLanguage(Locale.KOREAN); doSpeak(text, call);
                        }
                    });
                } else doSpeak(text, call);
            } catch (Throwable t) { call.reject(String.valueOf(t)); }
        }});
    }

    private void doSpeak(String text, final PluginCall call) {
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            public void onStart(String id) { }
            public void onDone(String id) { call.resolve(); }
            public void onError(String id) { call.resolve(); }
        });
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "aurora");
    }

    @PluginMethod public void stopSpeak(final PluginCall call) { try { if (tts != null) tts.stop(); } catch (Throwable ignored) { } call.resolve(); }

    @PluginMethod public void listen(final PluginCall call) {
        if (ContextCompat.checkSelfPermission(ctx(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { requestPermissionForAlias("mic", call, "micPermsCallback"); return; }
        startListening(call);
    }

    @PermissionCallback private void micPermsCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(ctx(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startListening(call); else call.reject("마이크 권한이 필요해요.");
    }

    private final android.os.Handler uiHandler = new android.os.Handler(android.os.Looper.getMainLooper());

    private void startListening(final PluginCall call) {
        final ArrayList<String> biasing = new ArrayList<String>();
        try { com.getcapacitor.JSArray ba = call.getArray("biasing"); if (ba != null) for (int k = 0; k < ba.length() && k < 60; k++) { String s = ba.optString(k, ""); if (!s.isEmpty() && s.length() <= 24) biasing.add(s); } } catch (Throwable ignored) { }
        getActivity().runOnUiThread(new Runnable() { public void run() { listenAttempt(call, 0, biasing); } });
    }

    private static String speechErrorName(int e) {
        switch (e) {
            case 1: return "네트워크 시간 초과"; case 2: return "네트워크 오류"; case 3: return "오디오(마이크) 오류"; case 4: return "음성 서버 오류";
            case 5: return "음성 인식 클라이언트 오류"; case 6: return "말소리가 들리지 않음"; case 7: return "인식된 말 없음"; case 8: return "음성 인식기가 사용 중";
            case 9: return "마이크 권한 없음"; case 10: return "요청이 너무 많음"; case 11: return "음성 서버 연결 끊김"; case 12: return "한국어 미지원";
            case 13: return "한국어 음성 팩 없음"; case 14: return "언어 지원 확인 불가"; default: return "알 수 없는 오류";
        }
    }

    /**
     * 시도 0: 전체 옵션(후보 5개·앱 이름 힌트) / 시도 1: 최소 옵션 / 시도 2: 시스템 기본 인식기 + 최소 옵션.
     * 옵션이 원인인 오류(클라이언트/서버/언어/사용 중)면 다음 시도로 자동 재시도한다.
     */
    private void listenAttempt(final PluginCall call, final int attempt, final ArrayList<String> biasing) {
        try {
            if (recognizer != null) { recognizer.destroy(); recognizer = null; }
            ComponentName real = attempt < 2 ? pickRealRecognizer(ctx()) : null;
            if (real == null && !SpeechRecognizer.isRecognitionAvailable(ctx())) { call.reject("이 기기에는 음성 인식 서비스가 없어요. (구글 앱/음성 서비스 필요)"); return; }
            recognizer = real != null ? SpeechRecognizer.createSpeechRecognizer(ctx(), real) : SpeechRecognizer.createSpeechRecognizer(ctx());
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR");
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx().getPackageName());
            if (attempt == 0) {
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ko-KR");
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1600L);
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1300L);
                if (!biasing.isEmpty()) i.putStringArrayListExtra("android.speech.extra.BIASING_STRINGS", biasing);
            } else {
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            }
            final int at = attempt;
            recognizer.setRecognitionListener(new RecognitionListener() {
                public void onReadyForSpeech(Bundle p) { notifyListeners("speechReady", new JSObject()); }
                public void onBeginningOfSpeech() { }
                public void onRmsChanged(float v) { JSObject o = new JSObject(); o.put("rms", v); notifyListeners("speechRms", o); }
                public void onBufferReceived(byte[] b) { }
                public void onEndOfSpeech() { }
                public void onEvent(int t, Bundle p) { }
                public void onError(int e) {
                    boolean retry = (e == 3 || e == 4 || e == 5 || e == 8 || e == 11 || e == 12 || e == 13 || e == 14) && at < 2;
                    if (retry) { final int delay = e == 8 ? 700 : 250; uiHandler.postDelayed(new Runnable() { public void run() { listenAttempt(call, at + 1, biasing); } }, delay); return; }
                    String m = e == 6 || e == 7 ? "말소리가 들리지 않았어요." : e == 9 ? "마이크 권한이 없어요. 설정 → 앱 → Aurora Agent → 권한에서 마이크를 허용하세요." : "음성 인식 오류: " + speechErrorName(e) + " (코드 " + e + ", 시도 " + (at + 1) + "회)";
                    call.reject(m);
                }
                public void onResults(Bundle r) {
                    ArrayList<String> l = r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (l == null || l.isEmpty()) { call.reject("말소리가 들리지 않았어요."); return; }
                    float[] sc = r.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
                    JSArray texts = new JSArray(), scores = new JSArray();
                    for (int k = 0; k < l.size(); k++) { texts.put(l.get(k)); try { scores.put(sc != null && k < sc.length ? (double) sc[k] : 0.0); } catch (Exception ignored) { } }
                    JSObject o = new JSObject(); o.put("text", l.get(0)); o.put("texts", texts); o.put("scores", scores); call.resolve(o);
                }
                public void onPartialResults(Bundle r) {
                    ArrayList<String> l = r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (l != null && !l.isEmpty()) { JSObject o = new JSObject(); o.put("text", l.get(0)); notifyListeners("speechPartial", o); }
                }
            });
            recognizer.startListening(i);
        } catch (Throwable t) {
            if (attempt < 2) listenAttempt(call, attempt + 1, biasing); else call.reject("음성 인식을 시작하지 못했어요: " + t);
        }
    }

    /** 마지막 수단: 시스템(구글) 음성 입력 창을 띄워 결과만 받는다. 인식 서비스 바인딩을 쓰지 않아 다른 경로가 막혀도 되는 경우가 많다 */
    /** 웹뷰를 거치지 않는 네이티브 녹음(16kHz): 말이 시작되면 잡고, 조용해지면 끝낸다. 결과는 WAV(base64) */
    @PluginMethod public void recordWav(final PluginCall call) {
        if (ContextCompat.checkSelfPermission(ctx(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { call.reject("마이크 권한이 없어요."); return; }
        final int maxMs = call.getInt("maxMs", 14000), noSpeechMs = call.getInt("noSpeechMs", 7000), silenceMs = call.getInt("silenceMs", 750);
        async(call, new Job() { public JSObject run() throws Exception {
            final int sr = 16000;
            int min = AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (min <= 0) throw new Exception("이 기기에서 녹음을 시작할 수 없어요.");
            AudioRecord ar = null;
            for (int src : new int[]{ MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC }) {
                try { AudioRecord t = new AudioRecord(src, sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, sr) * 2); if (t.getState() == AudioRecord.STATE_INITIALIZED) { ar = t; break; } t.release(); } catch (Throwable ignored) { }
            }
            if (ar == null) throw new Exception("마이크를 열 수 없어요. 다른 앱이 마이크를 쓰는 중이거나 권한 문제일 수 있어요.");
            ByteArrayOutputStream pcm = new ByteArrayOutputStream();
            short[] frame = new short[1600];                                 // 100ms
            long t0 = System.currentTimeMillis(), speechStart = 0, lastLoud = 0; double floor = 0.006; int speechOffset = 0; boolean any = false;
            try {
                ar.startRecording();
                while (true) {
                    int n = ar.read(frame, 0, frame.length);
                    long now = System.currentTimeMillis();
                    if (n < 0) throw new Exception("녹음 중 오류가 났어요 (" + n + ")");
                    if (n == 0) { if (now - t0 > 3000 && !any) throw new Exception("마이크에서 소리가 들어오지 않아요."); continue; }
                    any = true; double s = 0;
                    for (int i = 0; i < n; i++) { double v = frame[i] / 32768.0; s += v * v; pcm.write(frame[i] & 0xff); pcm.write((frame[i] >> 8) & 0xff); }
                    double rms = Math.sqrt(s / n);
                    JSObject lv = new JSObject(); lv.put("lvl", Math.min(1.0, rms * 9)); notifyListeners("recLevel", lv);
                    if (now - t0 < 250) { floor = Math.min(0.02, Math.max(floor, rms)); continue; }
                    if (rms > Math.max(0.018, floor * 2.6)) {
                        if (speechStart == 0) { speechStart = now; speechOffset = Math.max(0, pcm.size() - 3200 * 4); notifyListeners("recSpeech", new JSObject()); }
                        lastLoud = now;
                    }
                    if (speechStart != 0 && now - lastLoud > silenceMs && now - speechStart > 250) break;
                    if (speechStart == 0 && now - t0 > noSpeechMs) break;
                    if (now - t0 > maxMs) break;
                }
            } finally { try { ar.stop(); } catch (Throwable ignored) { } ar.release(); }
            JSObject o = new JSObject();
            if (speechStart == 0) { o.put("wav", ""); return o; }
            byte[] all = pcm.toByteArray(); int len = all.length - speechOffset;
            ByteArrayOutputStream w = new ByteArrayOutputStream(len + 44);
            byte[] h = new byte[44]; int br = sr * 2;
            String riff = "RIFF", wave = "WAVEfmt ", data = "data";
            for (int i = 0; i < 4; i++) h[i] = (byte) riff.charAt(i);
            int cs = 36 + len; h[4] = (byte) cs; h[5] = (byte) (cs >> 8); h[6] = (byte) (cs >> 16); h[7] = (byte) (cs >> 24);
            for (int i = 0; i < 8; i++) h[8 + i] = (byte) wave.charAt(i);
            h[16] = 16; h[20] = 1; h[22] = 1; h[24] = (byte) sr; h[25] = (byte) (sr >> 8); h[26] = (byte) (sr >> 16); h[27] = (byte) (sr >> 24);
            h[28] = (byte) br; h[29] = (byte) (br >> 8); h[30] = (byte) (br >> 16); h[31] = (byte) (br >> 24); h[32] = 2; h[34] = 16;
            for (int i = 0; i < 4; i++) h[36 + i] = (byte) data.charAt(i);
            h[40] = (byte) len; h[41] = (byte) (len >> 8); h[42] = (byte) (len >> 16); h[43] = (byte) (len >> 24);
            w.write(h, 0, 44); w.write(all, speechOffset, len);
            o.put("wav", android.util.Base64.encodeToString(w.toByteArray(), android.util.Base64.NO_WRAP));
            return o;
        }});
    }

    @PluginMethod public void micStatus(final PluginCall call) {
        JSObject o = new JSObject(); o.put("granted", ContextCompat.checkSelfPermission(ctx(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED); call.resolve(o);
    }

    @PluginMethod public void requestMic(final PluginCall call) {
        if (ContextCompat.checkSelfPermission(ctx(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { JSObject o = new JSObject(); o.put("granted", true); call.resolve(o); return; }
        requestPermissionForAlias("mic", call, "requestMicCallback");
    }

    @PermissionCallback private void requestMicCallback(PluginCall call) {
        JSObject o = new JSObject(); o.put("granted", ContextCompat.checkSelfPermission(ctx(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED); call.resolve(o);
    }

    @PluginMethod public void listenDialog(final PluginCall call) {
        try {
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR");
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            i.putExtra(RecognizerIntent.EXTRA_PROMPT, "말씀하세요");
            startActivityForResult(call, i, "listenDialogResult");
        } catch (Throwable t) { call.reject("시스템 음성 입력 창을 열 수 없어요: " + t); }
    }

    @ActivityCallback private void listenDialogResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ArrayList<String> l = result.getData() != null ? result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || l == null || l.isEmpty()) { call.reject("음성 입력이 취소됐거나 인식되지 않았어요."); return; }
        float[] sc = result.getData().getFloatArrayExtra(RecognizerIntent.EXTRA_CONFIDENCE_SCORES);
        JSArray texts = new JSArray(), scores = new JSArray();
        for (int k = 0; k < l.size(); k++) { texts.put(l.get(k)); try { scores.put(sc != null && k < sc.length ? (double) sc[k] : 0.0); } catch (Exception ignored) { } }
        JSObject o = new JSObject(); o.put("text", l.get(0)); o.put("texts", texts); o.put("scores", scores); call.resolve(o);
    }

    @PluginMethod public void stopListen(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() { public void run() { try { if (recognizer != null) recognizer.stopListening(); } catch (Throwable ignored) { } call.resolve(); } });
    }

    // ---------- Shizuku (PC 없이 무선 디버깅 권한으로 접근성 켜기 / adb 수준 명령) ----------
    private static final int SHIZUKU_REQ = 4242;
    private PluginCall shizukuCall;
    private final Shizuku.OnRequestPermissionResultListener shizukuListener = new Shizuku.OnRequestPermissionResultListener() {
        @Override public void onRequestPermissionResult(int requestCode, int grantResult) {
            if (requestCode != SHIZUKU_REQ) return;
            PluginCall c = shizukuCall; shizukuCall = null;
            if (c != null) { JSObject o = new JSObject(); o.put("granted", grantResult == PackageManager.PERMISSION_GRANTED); c.resolve(o); }
        }
    };
    @Override public void load() { try { Shizuku.addRequestPermissionResultListener(shizukuListener); } catch (Throwable ignored) { } }

    private boolean shizukuRunning() { try { return Shizuku.pingBinder(); } catch (Throwable t) { return false; } }
    private boolean shizukuGranted() { try { return shizukuRunning() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED; } catch (Throwable t) { return false; } }

    private String shizukuExec(String cmd) throws Exception {
        Method m = Shizuku.class.getDeclaredMethod("newProcess", String[].class, String[].class, String.class);
        m.setAccessible(true);
        final Process p = (Process) m.invoke(null, new String[]{ "sh", "-c", cmd }, null, null);
        final ByteArrayOutputStream err = new ByteArrayOutputStream();
        Thread te = new Thread(new Runnable() { public void run() {
            try (InputStream in = p.getErrorStream()) { byte[] b = new byte[2048]; int n; while ((n = in.read(b)) > 0) { synchronized (err) { err.write(b, 0, n); } } } catch (Exception ignored) { }
        }});
        te.start();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = p.getInputStream()) { byte[] b = new byte[4096]; int n; while ((n = in.read(b)) > 0) out.write(b, 0, n); }
        int code = p.waitFor(); te.join(1000);
        String o; synchronized (err) { o = new String(out.toByteArray(), "UTF-8") + new String(err.toByteArray(), "UTF-8"); }
        return clip(o.trim(), 400000) + (code != 0 ? "\n[종료코드 " + code + "]" : "");
    }

    @PluginMethod public void shizukuStatus(final PluginCall call) {
        JSObject o = new JSObject();
        boolean installed = true;
        try { ctx().getPackageManager().getPackageInfo("moe.shizuku.privileged.api", 0); } catch (Throwable t) { installed = false; }
        o.put("installed", installed); o.put("running", shizukuRunning()); o.put("granted", shizukuGranted());
        call.resolve(o);
    }

    @PluginMethod public void shizukuRequestPermission(final PluginCall call) {
        try {
            if (!shizukuRunning()) { call.reject("Shizuku가 실행 중이 아니에요. Shizuku 앱에서 먼저 시작하세요."); return; }
            if (shizukuGranted()) { JSObject o = new JSObject(); o.put("granted", true); call.resolve(o); return; }
            shizukuCall = call; Shizuku.requestPermission(SHIZUKU_REQ);
        } catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    @PluginMethod public void shizukuShell(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            if (!shizukuGranted()) throw new Exception("Shizuku 권한이 없어요. 설정의 [Shizuku로 접근성 켜기]로 먼저 연결하세요.");
            JSObject o = new JSObject(); o.put("output", shizukuExec(call.getString("command", ""))); return o;
        }});
    }

    /** Shizuku(adb 권한)로 접근성 서비스를 직접 켜고, 앞으로를 위해 WRITE_SECURE_SETTINGS도 부여 */
    @PluginMethod public void shizukuEnableAccessibility(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            if (!shizukuGranted()) throw new Exception("Shizuku 권한이 없어요.");
            String cn = ctx().getPackageName() + "/" + AuroraAccessibilityService.class.getName();
            String cur = shizukuExec("settings get secure enabled_accessibility_services").trim();
            if (cur.isEmpty() || cur.equals("null") || cur.contains("[종료코드")) cur = "";
            if (!cur.contains(cn)) cur = cur.isEmpty() ? cn : cur + ":" + cn;
            String r1 = shizukuExec("settings put secure enabled_accessibility_services '" + cur + "'");
            String r2 = shizukuExec("settings put secure accessibility_enabled 1");
            String r3 = shizukuExec("pm grant " + ctx().getPackageName() + " android.permission.WRITE_SECURE_SETTINGS");
            JSObject o = new JSObject(); o.put("enabled", true); o.put("log", (r1 + " " + r2 + " " + r3).trim());
            return o;
        }});
    }

    // ---------- 셸 / 파일 ----------
    @PluginMethod public void runCommand(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            String cmd = call.getString("command", "");
            String cwd = call.getString("cwd", null);
            long timeout = call.getInt("timeoutMs", 60000);
            File dir = cwd != null ? resolve(cwd) : (Environment.getExternalStorageDirectory().exists() ? Environment.getExternalStorageDirectory() : ctx().getFilesDir());
            ProcessBuilder pb = new ProcessBuilder("sh", "-c", cmd).directory(dir).redirectErrorStream(true);
            pb.environment().put("HOME", ctx().getFilesDir().getAbsolutePath());
            final Process pr = pb.start();
            final ByteArrayOutputStream buf = new ByteArrayOutputStream();
            Thread rd = new Thread(new Runnable() { public void run() {
                try (InputStream in = pr.getInputStream()) { byte[] b = new byte[4096]; int n; while ((n = in.read(b)) > 0) { synchronized (buf) { buf.write(b, 0, n); } } } catch (Exception ignored) { }
            }});
            rd.start();
            long end = System.currentTimeMillis() + timeout; Integer code = null; boolean timedOut = false;
            while (code == null) {
                try { code = pr.exitValue(); } catch (IllegalThreadStateException e) {
                    if (System.currentTimeMillis() > end) { pr.destroy(); timedOut = true; break; }
                    Thread.sleep(80);
                }
            }
            rd.join(1500);
            String out; synchronized (buf) { out = new String(buf.toByteArray(), "UTF-8"); }
            JSObject o = new JSObject(); o.put("output", clip(out, 20000)); o.put("exitCode", code == null ? -1 : code); o.put("timedOut", timedOut);
            return o;
        }});
    }

    @PluginMethod public void readFile(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            File f = resolve(call.getString("path", ""));
            if (!f.exists()) throw new Exception("파일이 없어요: " + f);
            if (!f.canRead()) throw new Exception("읽을 수 없어요(권한 없음): " + f + " — request_all_files_access 도구로 권한을 요청해 보세요.");
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try (FileInputStream in = new FileInputStream(f)) { byte[] b = new byte[8192]; int n, total = 0; while ((n = in.read(b)) > 0 && total < 300000) { bo.write(b, 0, n); total += n; } }
            JSObject o = new JSObject(); o.put("content", clip(new String(bo.toByteArray(), "UTF-8"), 100000)); o.put("size", f.length());
            return o;
        }});
    }

    @PluginMethod public void writeFile(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            File f = resolve(call.getString("path", ""));
            boolean append = call.getBoolean("append", false);
            File parent = f.getParentFile(); if (parent != null && !parent.exists()) parent.mkdirs();
            try (FileOutputStream out = new FileOutputStream(f, append)) { out.write(call.getString("content", "").getBytes("UTF-8")); }
            JSObject o = new JSObject(); o.put("path", f.getAbsolutePath()); o.put("size", f.length());
            return o;
        }});
    }

    @PluginMethod public void listDir(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            File d = resolve(call.getString("path", ""));
            File[] fs = d.listFiles();
            if (fs == null) throw new Exception("폴더를 열 수 없어요: " + d + (d.exists() ? " (권한 없음 — request_all_files_access 필요)" : " (없는 경로)"));
            Arrays.sort(fs, new Comparator<File>() { public int compare(File a, File b) { return a.getName().compareToIgnoreCase(b.getName()); } });
            JSArray arr = new JSArray();
            for (int i = 0; i < fs.length && i < 500; i++) {
                JSObject e = new JSObject(); e.put("name", fs[i].getName()); e.put("dir", fs[i].isDirectory()); e.put("size", fs[i].length()); e.put("modified", fs[i].lastModified());
                arr.put(e);
            }
            JSObject o = new JSObject(); o.put("path", d.getAbsolutePath()); o.put("entries", arr); o.put("total", fs.length);
            return o;
        }});
    }

    // ---------- 앱 ----------
    @PluginMethod public void listApps(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            PackageManager pm = ctx().getPackageManager();
            Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> rs = pm.queryIntentActivities(main, 0);
            final List<String[]> apps = new ArrayList<String[]>();
            for (ResolveInfo r : rs) apps.add(new String[]{ String.valueOf(r.loadLabel(pm)), r.activityInfo.packageName });
            Collections.sort(apps, new Comparator<String[]>() { public int compare(String[] a, String[] b) { return a[0].compareToIgnoreCase(b[0]); } });
            JSArray arr = new JSArray();
            for (String[] a : apps) { JSObject e = new JSObject(); e.put("name", a[0]); e.put("package", a[1]); arr.put(e); }
            JSObject o = new JSObject(); o.put("apps", arr); return o;
        }});
    }

    @PluginMethod public void launchApp(final PluginCall call) {
        try {
            String pkg = call.getString("package", "");
            Intent i = ctx().getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) { call.reject("실행할 수 없는 앱이에요: " + pkg); return; }
            startAny(i); JSObject o = new JSObject(); o.put("launched", pkg); call.resolve(o);
        } catch (Throwable t) { call.reject(String.valueOf(t)); }
    }

    @PluginMethod public void openIntent(final PluginCall call) {
        try {
            Intent i = new Intent(call.getString("action", Intent.ACTION_VIEW));
            String uri = call.getString("uri", null), type = call.getString("mimeType", null), pkg = call.getString("package", null);
            if (uri != null && type != null) i.setDataAndType(Uri.parse(uri), type); else if (uri != null) i.setData(Uri.parse(uri)); else if (type != null) i.setType(type);
            if (pkg != null) i.setPackage(pkg);
            startAny(i); JSObject o = new JSObject(); o.put("opened", true); call.resolve(o);
        } catch (Throwable t) { call.reject("열 수 없어요: " + t); }
    }

    // ---------- 화면 조작 (접근성) ----------
    @PluginMethod public void screenRead(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            AuroraAccessibilityService s = AuroraAccessibilityService.instance; if (s == null) throw new Exception(A11Y_OFF);
            return JSObject.fromJSONObject(s.readScreen());
        }});
    }
    @PluginMethod public void screenTap(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            AuroraAccessibilityService s = AuroraAccessibilityService.instance; if (s == null) throw new Exception(A11Y_OFF);
            JSObject o = new JSObject(); o.put("ok", s.tap(call.getFloat("x", 0f), call.getFloat("y", 0f))); return o;
        }});
    }
    @PluginMethod public void screenSwipe(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            AuroraAccessibilityService s = AuroraAccessibilityService.instance; if (s == null) throw new Exception(A11Y_OFF);
            JSObject o = new JSObject();
            o.put("ok", s.swipe(call.getFloat("x1", 0f), call.getFloat("y1", 0f), call.getFloat("x2", 0f), call.getFloat("y2", 0f), call.getInt("durationMs", 350)));
            return o;
        }});
    }
    @PluginMethod public void screenClickText(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            AuroraAccessibilityService s = AuroraAccessibilityService.instance; if (s == null) throw new Exception(A11Y_OFF);
            JSObject o = new JSObject(); o.put("ok", s.clickText(call.getString("text", ""), call.getBoolean("exact", false))); return o;
        }});
    }
    @PluginMethod public void screenType(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            AuroraAccessibilityService s = AuroraAccessibilityService.instance; if (s == null) throw new Exception(A11Y_OFF);
            JSObject o = new JSObject(); o.put("ok", s.typeText(call.getString("text", ""))); return o;
        }});
    }
    @PluginMethod public void screenGlobal(final PluginCall call) {
        async(call, new Job() { public JSObject run() throws Exception {
            AuroraAccessibilityService s = AuroraAccessibilityService.instance; if (s == null) throw new Exception(A11Y_OFF);
            JSObject o = new JSObject(); o.put("ok", s.global(call.getString("action", ""))); return o;
        }});
    }
}
