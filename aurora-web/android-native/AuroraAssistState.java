package com.aurora.agent;

import android.graphics.Bitmap;

/** 어시스턴트가 호출된 순간의 화면 캡처를 오버레이로 전달하는 보관소 */
public class AuroraAssistState {
    public static volatile Bitmap screenshot;
    public static volatile long shotTime;
    public static volatile boolean alive;            // AssistActivity가 떠 있는지

    public static void setShot(Bitmap b) { screenshot = b; shotTime = System.currentTimeMillis(); }
    public static void clear() { screenshot = null; shotTime = 0; }
}
