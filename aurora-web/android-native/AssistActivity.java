package com.aurora.agent;

import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;

import com.getcapacitor.BridgeActivity;

/** 홈 버튼 길게 누르기로 뜨는 투명 오버레이 화면. 같은 웹 UI를 쓰되 플러그인이 "어시스턴트 모드"로 알려준다. */
public class AssistActivity extends BridgeActivity {
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuroraDevicePlugin.class);
        super.onCreate(savedInstanceState);
        AuroraAssistState.alive = true;
        try { getWindow().setBackgroundDrawableResource(android.R.color.transparent); } catch (Throwable ignored) { }
        applyTransparent();
        // 화면이 준비되기 전(흰 화면/깜빡임)에는 숨기고, 웹이 assistReady()를 부르면 보여준다. 안전장치: 1.5초 뒤엔 무조건 표시
        try { getBridge().getWebView().setAlpha(0f); } catch (Throwable ignored) { }
        handler.postDelayed(new Runnable() { public void run() { showWeb(); } }, 1500);
    }

    private void applyTransparent() {
        try {
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
            Window w = getWindow(); w.getDecorView().setBackgroundColor(Color.TRANSPARENT);
        } catch (Throwable ignored) { }
    }

    public void showWeb() {
        runOnUiThread(new Runnable() { public void run() {
            try { View v = getBridge().getWebView(); v.setBackgroundColor(Color.TRANSPARENT); v.animate().alpha(1f).setDuration(180).start(); } catch (Throwable ignored) { }
        }});
    }

    @Override public void onResume() { super.onResume(); applyTransparent(); }
    @Override public void onDestroy() { AuroraAssistState.alive = false; handler.removeCallbacksAndMessages(null); super.onDestroy(); }
}
