package com.aurora.agent;

import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.os.RemoteException;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.SpeechRecognizer;

/**
 * 어시스턴트 등록에 필요한 음성인식 서비스. 직접 인식하지 않고 기기의 실제 음성인식 서비스(구글 등)로 전달만 한다.
 * (기본 음성인식 서비스가 Aurora로 바뀌어도 다른 앱의 음성 입력이 망가지지 않게 하기 위함)
 */
public class AuroraRecognitionProxyService extends RecognitionService {
    private SpeechRecognizer inner;

    @Override
    protected void onStartListening(Intent intent, final Callback callback) {
        try {
            if (inner != null) inner.destroy();
            ComponentName real = AuroraDevicePlugin.pickRealRecognizer(this);
            if (real == null) { callback.error(SpeechRecognizer.ERROR_CLIENT); return; }
            inner = SpeechRecognizer.createSpeechRecognizer(this, real);
            inner.setRecognitionListener(new RecognitionListener() {
                public void onReadyForSpeech(Bundle p) { try { callback.readyForSpeech(p); } catch (RemoteException ignored) { } }
                public void onBeginningOfSpeech() { try { callback.beginningOfSpeech(); } catch (RemoteException ignored) { } }
                public void onRmsChanged(float v) { try { callback.rmsChanged(v); } catch (RemoteException ignored) { } }
                public void onBufferReceived(byte[] b) { try { callback.bufferReceived(b); } catch (RemoteException ignored) { } }
                public void onEndOfSpeech() { try { callback.endOfSpeech(); } catch (RemoteException ignored) { } }
                public void onError(int e) { try { callback.error(e); } catch (RemoteException ignored) { } }
                public void onResults(Bundle r) { try { callback.results(r); } catch (RemoteException ignored) { } }
                public void onPartialResults(Bundle r) { try { callback.partialResults(r); } catch (RemoteException ignored) { } }
                public void onEvent(int t, Bundle p) { }
            });
            inner.startListening(intent);
        } catch (Throwable t) { try { callback.error(SpeechRecognizer.ERROR_CLIENT); } catch (RemoteException ignored) { } }
    }

    @Override protected void onCancel(Callback callback) { if (inner != null) inner.cancel(); }
    @Override protected void onStopListening(Callback callback) { if (inner != null) inner.stopListening(); }
    @Override public void onDestroy() { if (inner != null) { inner.destroy(); inner = null; } super.onDestroy(); }
}
