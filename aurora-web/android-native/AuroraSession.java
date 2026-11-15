package com.aurora.agent;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.voice.VoiceInteractionSession;
import android.view.View;

/**
 * 어시스턴트 호출(홈 길게 누르기) 처리.
 * 1) 호출 순간의 화면을 캡처(시스템 스크린샷 또는 Shizuku) → 써클 투 서치용
 * 2) 세션에 묶이지 않는 일반 액티비티로 오버레이를 띄움 (세션이 닫혀도 오버레이가 사라지지 않게)
 */
public class AuroraSession extends VoiceInteractionSession {
    private final Handler main = new Handler(Looper.getMainLooper());

    public AuroraSession(Context context) { super(context); }

    @Override
    public View onCreateContentView() {
        View v = new View(getContext());               // 보이지 않는 1개짜리 뷰 (프로세스에 보이는 창을 유지해서 액티비티 시작이 막히지 않게)
        v.setLayoutParams(new android.view.ViewGroup.LayoutParams(1, 1));
        return v;
    }

    @Override
    public void onShow(Bundle args, int showFlags) {
        super.onShow(args, showFlags);
        AuroraAssistState.clear();
        final boolean systemShot = (showFlags & SHOW_WITH_SCREENSHOT) != 0;   // 시스템이 곧 스크린샷을 줄 예정
        if (!systemShot) {
            Bitmap b = ShizukuHelper.screencap();                              // 오버레이가 뜨기 전에 캡처해야 원래 화면이 찍힌다
            if (b != null) AuroraAssistState.setShot(b);
        }
        final Intent i = new Intent(getContext(), AssistActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        try { getContext().startActivity(i); } catch (Throwable ignored) { }
        // 일반 시작이 막혀서 안 떴다면 어시스턴트 전용 시작으로 재시도
        main.postDelayed(new Runnable() { public void run() {
            if (!AuroraAssistState.alive) { try { startAssistantActivity(i); } catch (Throwable ignored) { } }
            else { try { hide(); } catch (Throwable ignored) { } }
        }}, 700);
    }

    @Override
    public void onHandleScreenshot(Bitmap screenshot) {
        if (screenshot != null) AuroraAssistState.setShot(screenshot);
    }
}
