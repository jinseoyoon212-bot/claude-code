package com.aurora.agent;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.service.voice.VoiceInteractionSession;

/** 어시스턴트가 호출되면(홈 길게 누르기) 오버레이 액티비티를 띄운다. 세션 자체 UI는 쓰지 않는다. */
public class AuroraSession extends VoiceInteractionSession {
    public AuroraSession(Context context) { super(context); }

    @Override
    public void onCreate() {
        super.onCreate();
        try { setUiEnabled(false); } catch (Throwable ignored) { }
    }

    @Override
    public void onShow(Bundle args, int showFlags) {
        super.onShow(args, showFlags);
        Intent i = new Intent(getContext(), AssistActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try { startAssistantActivity(i); }
        catch (Throwable t) { try { getContext().startActivity(i); } catch (Throwable ignored) { } }
    }
}
