package com.aurora.agent;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Intent;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** 다른 앱의 화면을 읽고 탭/스와이프/입력/전역 버튼을 수행하는 접근성 서비스 (사용자가 설정에서 직접 켜야 동작) */
public class AuroraAccessibilityService extends AccessibilityService {
    public static volatile AuroraAccessibilityService instance;
    private static final int MAX_NODES = 250;

    @Override protected void onServiceConnected() { super.onServiceConnected(); instance = this; }
    @Override public boolean onUnbind(Intent intent) { instance = null; return super.onUnbind(intent); }
    @Override public void onDestroy() { instance = null; super.onDestroy(); }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { }
    @Override public void onInterrupt() { }

    /** 현재 화면의 보이는 글자/버튼/입력칸 목록 */
    public JSONObject readScreen() throws JSONException {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        JSONObject out = new JSONObject();
        if (root == null) { out.put("error", "화면 정보를 읽을 수 없어요 (잠금 화면이거나 보안 화면일 수 있어요)."); return out; }
        JSONArray nodes = new JSONArray();
        collect(root, nodes, 0);
        out.put("package", String.valueOf(root.getPackageName()));
        out.put("count", nodes.length());
        out.put("nodes", nodes);
        return out;
    }

    private void collect(AccessibilityNodeInfo n, JSONArray out, int depth) throws JSONException {
        if (n == null || out.length() >= MAX_NODES || depth > 40) return;
        CharSequence t = n.getText(), d = n.getContentDescription();
        boolean has = (t != null && t.length() > 0) || (d != null && d.length() > 0);
        if (n.isVisibleToUser() && (has || n.isClickable() || n.isEditable())) {
            Rect r = new Rect(); n.getBoundsInScreen(r);
            JSONObject o = new JSONObject();
            if (t != null && t.length() > 0) o.put("text", t.toString());
            if (d != null && d.length() > 0) o.put("desc", d.toString());
            if (n.getViewIdResourceName() != null) o.put("id", n.getViewIdResourceName());
            if (n.isClickable()) o.put("click", true);
            if (n.isEditable()) o.put("edit", true);
            o.put("x", r.centerX()); o.put("y", r.centerY());
            o.put("bounds", new JSONArray().put(r.left).put(r.top).put(r.right).put(r.bottom));
            out.put(o);
        }
        for (int i = 0; i < n.getChildCount(); i++) collect(n.getChild(i), out, depth + 1);
    }

    private boolean gesture(Path p, long durationMs) {
        if (Build.VERSION.SDK_INT < 24) return false;
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(p, 0, Math.max(1, durationMs)));
        final CountDownLatch latch = new CountDownLatch(1);
        final boolean[] ok = { false };
        boolean sent = dispatchGesture(b.build(), new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription g) { ok[0] = true; latch.countDown(); }
            @Override public void onCancelled(GestureDescription g) { latch.countDown(); }
        }, null);
        if (!sent) return false;
        try { latch.await(durationMs + 2000, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { }
        return ok[0];
    }

    public boolean tap(float x, float y) { Path p = new Path(); p.moveTo(x, y); return gesture(p, 60); }
    public boolean swipe(float x1, float y1, float x2, float y2, long ms) { Path p = new Path(); p.moveTo(x1, y1); p.lineTo(x2, y2); return gesture(p, ms); }

    /** 글자(또는 설명)로 버튼을 찾아 클릭. 클릭 가능한 부모까지 올라가서 시도 */
    public boolean clickText(String text, boolean exact) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        List<AccessibilityNodeInfo> found = root.findAccessibilityNodeInfosByText(text);
        if (found == null) return false;
        for (AccessibilityNodeInfo n : found) {
            if (exact) {
                CharSequence t = n.getText(), d = n.getContentDescription();
                if (!text.contentEquals(t == null ? "" : t) && !text.contentEquals(d == null ? "" : d)) continue;
            }
            AccessibilityNodeInfo cur = n;
            for (int i = 0; i < 8 && cur != null; i++) {
                if (cur.isClickable() && cur.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
                cur = cur.getParent();
            }
            Rect r = new Rect(); n.getBoundsInScreen(r);       // 클릭 가능한 부모가 없으면 좌표로 탭
            if (r.width() > 0 && tap(r.centerX(), r.centerY())) return true;
        }
        return false;
    }

    /** 포커스된(없으면 첫 번째) 입력칸에 글자를 넣는다 */
    public boolean typeText(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo target = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (target == null) target = firstEditable(root, 0);
        if (target == null) return false;
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    }

    private AccessibilityNodeInfo firstEditable(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 40) return null;
        if (n.isEditable() && n.isVisibleToUser()) return n;
        for (int i = 0; i < n.getChildCount(); i++) { AccessibilityNodeInfo r = firstEditable(n.getChild(i), depth + 1); if (r != null) return r; }
        return null;
    }

    public boolean global(String name) {
        switch (name) {
            case "back": return performGlobalAction(GLOBAL_ACTION_BACK);
            case "home": return performGlobalAction(GLOBAL_ACTION_HOME);
            case "recents": return performGlobalAction(GLOBAL_ACTION_RECENTS);
            case "notifications": return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            case "quick_settings": return performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
            default: return false;
        }
    }
}
