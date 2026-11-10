// `cap add android` 로 생성된 android/ 프로젝트에 네이티브 플러그인(폰 제어)을 주입한다. 여러 번 실행해도 안전.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'android'), native = path.join(__dirname, 'android-native');
const appId = JSON.parse(fs.readFileSync(path.join(__dirname, 'capacitor.config.json'), 'utf8')).appId;
const javaDir = path.join(root, 'app/src/main/java', ...appId.split('.')), res = path.join(root, 'app/src/main/res');
if (!fs.existsSync(root)) { console.error('android/ 가 없어요. 먼저 npx cap add android'); process.exit(1); }
const pkg = (f) => fs.readFileSync(path.join(native, f), 'utf8').replace(/^package .*;/m, `package ${appId};`);
fs.mkdirSync(javaDir, { recursive: true });
for (const f of ['AuroraDevicePlugin.java', 'AuroraAccessibilityService.java']) fs.writeFileSync(path.join(javaDir, f), pkg(f));
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

const mf = path.join(root, 'app/src/main/AndroidManifest.xml'); let m = fs.readFileSync(mf, 'utf8');
if (!m.includes('AuroraAccessibilityService')) {
  const perms = ['MANAGE_EXTERNAL_STORAGE', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'QUERY_ALL_PACKAGES']
    .filter((p) => !m.includes(`android.permission.${p}`)).map((p) => `    <uses-permission android:name="android.permission.${p}" />\n`).join('');
  m = m.replace('<application', perms + '    <application android:requestLegacyExternalStorage="true"');
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
  fs.writeFileSync(mf, m);
}
// Gradle 래퍼를 8.7로 (JDK 17/21 모두 지원)
const gw = path.join(root, 'gradle/wrapper/gradle-wrapper.properties');
if (fs.existsSync(gw)) fs.writeFileSync(gw, fs.readFileSync(gw, 'utf8').replace(/gradle-[\d.]+-(bin|all)\.zip/, 'gradle-8.7-bin.zip'));
console.log('네이티브 플러그인 주입 완료:', appId);
