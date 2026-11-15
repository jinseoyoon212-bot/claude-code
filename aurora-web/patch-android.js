// `cap add android` 로 생성된 android/ 프로젝트에 네이티브 플러그인(폰 제어)을 주입한다. 여러 번 실행해도 안전.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'android'), native = path.join(__dirname, 'android-native');
const appId = JSON.parse(fs.readFileSync(path.join(__dirname, 'capacitor.config.json'), 'utf8')).appId;
const javaDir = path.join(root, 'app/src/main/java', ...appId.split('.')), res = path.join(root, 'app/src/main/res');
if (!fs.existsSync(root)) { console.error('android/ 가 없어요. 먼저 npx cap add android'); process.exit(1); }
const pkg = (f) => fs.readFileSync(path.join(native, f), 'utf8').replace(/^package .*;/m, `package ${appId};`);
fs.mkdirSync(javaDir, { recursive: true });
for (const f of ['AuroraDevicePlugin.java', 'AuroraAccessibilityService.java', 'AssistActivity.java', 'AuroraVoiceService.java', 'AuroraSessionService.java', 'AuroraSession.java', 'AuroraRecognitionProxyService.java', 'AuroraAssistState.java', 'ShizukuHelper.java']) fs.writeFileSync(path.join(javaDir, f), pkg(f));
fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), `package ${appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuroraDevicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);
fs.mkdirSync(path.join(res, 'xml'), { recursive: true }); fs.mkdirSync(path.join(res, 'values'), { recursive: true });
fs.copyFileSync(path.join(native, 'aurora_accessibility.xml'), path.join(res, 'xml/aurora_accessibility.xml'));
fs.copyFileSync(path.join(native, 'aurora_strings.xml'), path.join(res, 'values/aurora_strings.xml'));
fs.copyFileSync(path.join(native, 'aurora_styles.xml'), path.join(res, 'values/aurora_styles.xml'));
fs.mkdirSync(path.join(res, 'values-v31'), { recursive: true }); fs.copyFileSync(path.join(native, 'aurora_styles_v31.xml'), path.join(res, 'values-v31/aurora_styles.xml'));
fs.copyFileSync(path.join(native, 'aurora_voice_interaction.xml'), path.join(res, 'xml/aurora_voice_interaction.xml'));

const mf = path.join(root, 'app/src/main/AndroidManifest.xml'); let m = fs.readFileSync(mf, 'utf8');
// 권한: 이미 있는 건 건너뛰고 빠진 것만 추가
const perms = ['MANAGE_EXTERNAL_STORAGE', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'QUERY_ALL_PACKAGES', 'WRITE_SECURE_SETTINGS', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS']
  .filter((p) => !m.includes(`android.permission.${p}`)).map((p) => `    <uses-permission android:name="android.permission.${p}" />\n`).join('');
if (perms) m = m.replace('<application', perms + '    <application');
if (!m.includes('requestLegacyExternalStorage')) m = m.replace('<application', '<application android:requestLegacyExternalStorage="true"');
if (!m.includes('AuroraAccessibilityService')) {
  m = m.replace('</application>', `        <service
            android:name="${appId}.AuroraAccessibilityService"
            android:exported="true"
            android:label="Aurora Agent"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data android:name="android.accessibilityservice" android:resource="@xml/aurora_accessibility" />
        </service>
    </application>`);
}
fs.writeFileSync(mf, m);

// Shizuku 연동: 라이브러리 + 프로바이더 + minSdk 24
const bg = path.join(root, 'app/build.gradle'); let g = fs.readFileSync(bg, 'utf8');
if (!g.includes('dev.rikka.shizuku')) { g = g.replace(/dependencies\s*\{/, "dependencies {\n    implementation 'dev.rikka.shizuku:api:13.1.5'\n    implementation 'dev.rikka.shizuku:provider:13.1.5'"); fs.writeFileSync(bg, g); }
const vg = path.join(root, 'variables.gradle');
if (fs.existsSync(vg)) fs.writeFileSync(vg, fs.readFileSync(vg, 'utf8').replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 24'));
let m2 = fs.readFileSync(mf, 'utf8');
if (!m2.includes('ShizukuProvider')) {
  m2 = m2.replace('</application>', `        <provider
            android:name="rikka.shizuku.ShizukuProvider"
            android:authorities="${appId}.shizuku"
            android:multiprocess="false"
            android:enabled="true"
            android:exported="true"
            android:permission="android.permission.INTERACT_ACROSS_USERS_FULL" />
    </application>`);
  fs.writeFileSync(mf, m2);
}


// 어시스턴트(홈 길게 누르기): 오버레이 액티비티 + 음성 상호작용 서비스 + 음성인식 프록시
let m3 = fs.readFileSync(mf, 'utf8');
if (!m3.includes('AuroraVoiceService')) {
  m3 = m3.replace('</application>', `        <activity
            android:name="${appId}.AssistActivity"
            android:theme="@style/AuroraAssistTheme"
            android:exported="true"
            android:launchMode="singleTask"
            android:taskAffinity=""
            android:excludeFromRecents="true"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation">
            <intent-filter>
                <action android:name="android.intent.action.ASSIST" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.VOICE" />
            </intent-filter>
        </activity>
        <service
            android:name="${appId}.AuroraVoiceService"
            android:label="Aurora Agent"
            android:exported="true"
            android:permission="android.permission.BIND_VOICE_INTERACTION">
            <meta-data android:name="android.voice_interaction" android:resource="@xml/aurora_voice_interaction" />
            <intent-filter>
                <action android:name="android.service.voice.VoiceInteractionService" />
            </intent-filter>
        </service>
        <service
            android:name="${appId}.AuroraSessionService"
            android:exported="true"
            android:permission="android.permission.BIND_VOICE_INTERACTION" />
        <service
            android:name="${appId}.AuroraRecognitionProxyService"
            android:label="Aurora Agent"
            android:exported="true">
            <intent-filter>
                <action android:name="android.speech.RecognitionService" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
        </service>
    </application>`);
  fs.writeFileSync(mf, m3);
}

// Gradle 래퍼를 8.7로 (JDK 17/21 모두 지원)
const gw = path.join(root, 'gradle/wrapper/gradle-wrapper.properties');
if (fs.existsSync(gw)) fs.writeFileSync(gw, fs.readFileSync(gw, 'utf8').replace(/gradle-[\d.]+-(bin|all)\.zip/, 'gradle-8.7-bin.zip'));
console.log('네이티브 플러그인 주입 완료:', appId);
