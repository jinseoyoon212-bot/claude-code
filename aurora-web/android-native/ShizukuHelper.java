package com.aurora.agent;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Method;

import rikka.shizuku.Shizuku;

/** Shizuku(adb 권한)로 화면 캡처 (screencap -p 의 PNG를 표준출력으로 받는다) */
public class ShizukuHelper {
    public static boolean granted() {
        try { return Shizuku.pingBinder() && Shizuku.checkSelfPermission() == android.content.pm.PackageManager.PERMISSION_GRANTED; }
        catch (Throwable t) { return false; }
    }

    public static Bitmap screencap() {
        if (!granted()) return null;
        try {
            Method m = Shizuku.class.getDeclaredMethod("newProcess", String[].class, String[].class, String.class);
            m.setAccessible(true);
            final Process p = (Process) m.invoke(null, new String[]{ "screencap", "-p" }, null, null);
            new Thread(new Runnable() { public void run() { try (InputStream e = p.getErrorStream()) { byte[] b = new byte[1024]; while (e.read(b) > 0) { } } catch (Exception ignored) { } } }).start();
            ByteArrayOutputStream out = new ByteArrayOutputStream(4 * 1024 * 1024);
            try (InputStream in = p.getInputStream()) { byte[] b = new byte[65536]; int n; while ((n = in.read(b)) > 0) out.write(b, 0, n); }
            p.waitFor();
            byte[] png = out.toByteArray();
            return png.length > 1000 ? BitmapFactory.decodeByteArray(png, 0, png.length) : null;
        } catch (Throwable t) { return null; }
    }
}
