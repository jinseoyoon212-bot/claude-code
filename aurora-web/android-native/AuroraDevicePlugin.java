package com.aurora.agent;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.accessibility.AccessibilityManager;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import rikka.shizuku.Shizuku;

import java.io.ByteArrayOutputStream;
import java.lang.reflect.Method;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** 폰 자체를 다루는 도구 모음: 셸/파일/앱 실행/화면 조작 */
@CapacitorPlugin(name = "AuroraDevice")
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
        return clip(o.trim(), 20000) + (code != 0 ? "\n[종료코드 " + code + "]" : "");
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
