package com.aurora.agent;

import android.graphics.Color;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/** 홈 버튼 길게 누르기로 뜨는 반투명 오버레이 화면. 같은 웹 UI를 쓰되 플러그인이 "어시스턴트 모드"로 알려준다. */
public class AssistActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuroraDevicePlugin.class);
        super.onCreate(savedInstanceState);
        try { getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT); } catch (Throwable ignored) { }
    }
}
