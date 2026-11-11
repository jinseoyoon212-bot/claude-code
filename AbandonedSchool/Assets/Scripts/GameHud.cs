using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>IMGUI로 그리는 HUD: 안내문, 메시지, 소지품, 배터리, 쪽지, 숫자 자물쇠, 엔딩.</summary>
    public class GameHud : MonoBehaviour
    {
        const float VirtualHeight = 720f;

        GUIStyle label;
        GUIStyle center;
        GUIStyle title;
        GUIStyle button;
        string entry = "";

        void Start()
        {
            GameManager.Instance.Say("…눈을 떠 보니 폐교의 교실이다. 어떻게든 이곳을 빠져나가야 한다.", 6f);
        }

        void Update()
        {
            var gm = GameManager.Instance;
            if (gm == null) return;

            if (gm.State == GameState.Reading)
            {
                entry = "";
                if (Time.frameCount > gm.UiOpenedFrame && (Input.GetKeyDown(KeyCode.E) || Input.GetKeyDown(KeyCode.Escape)))
                    gm.CloseUi();
            }
            else if (gm.State == GameState.Keypad)
            {
                if (Time.frameCount <= gm.UiOpenedFrame) return;
                if (Input.GetKeyDown(KeyCode.Escape))
                {
                    gm.CloseUi();
                    return;
                }
                int maxLen = gm.ActiveLock.code.Length;
                foreach (char c in Input.inputString)
                {
                    if (char.IsDigit(c) && entry.Length < maxLen) entry += c;
                    else if (c == '\b' && entry.Length > 0) entry = entry.Substring(0, entry.Length - 1);
                }
                if (Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter)) SubmitCode(gm);
            }
            else
            {
                entry = "";
            }
        }

        void SubmitCode(GameManager gm)
        {
            var container = gm.ActiveLock;
            if (container == null) return;
            bool ok = container.TrySubmit(entry);
            if (ok) gm.CloseUi();
            entry = "";
        }

        void InitStyles()
        {
            var font = Font.CreateDynamicFontFromOSFont(
                new[] { "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "NanumGothic", "Noto Sans CJK KR", "Noto Sans KR", "Arial" }, 24);

            label = new GUIStyle(GUI.skin.label) { font = font, fontSize = 20, wordWrap = true, richText = true };
            label.normal.textColor = Color.white;

            center = new GUIStyle(label) { alignment = TextAnchor.MiddleCenter, fontSize = 24 };
            title = new GUIStyle(label) { alignment = TextAnchor.MiddleCenter, fontSize = 40, fontStyle = FontStyle.Bold };
            button = new GUIStyle(GUI.skin.button) { font = font, fontSize = 26 };
        }

        void OnGUI()
        {
            var gm = GameManager.Instance;
            if (gm == null) return;
            if (label == null) InitStyles();

            float s = Screen.height / VirtualHeight;
            GUI.matrix = Matrix4x4.Scale(new Vector3(s, s, 1f));
            float vw = Screen.width / s;
            float vh = VirtualHeight;

            if (gm.State == GameState.Playing) DrawPlaying(gm, vw, vh);
            else if (gm.State == GameState.Reading) DrawPlaying(gm, vw, vh, false);
            else if (gm.State == GameState.Keypad) DrawPlaying(gm, vw, vh, false);

            if (gm.State == GameState.Reading) DrawNote(gm, vw);
            if (gm.State == GameState.Keypad) DrawKeypad(gm, vw);
            if (gm.State == GameState.GameOver) DrawEnding(vw, vh, "GAME OVER", gm.EndReason, new Color(0.8f, 0.1f, 0.1f), gm);
            if (gm.State == GameState.Won) DrawEnding(vw, vh, "탈출 성공!", "새벽 공기 속으로 빠져나왔다. 폐교는 등 뒤에서 조용히 멀어진다.", new Color(0.4f, 0.9f, 0.5f), gm);
        }

        void DrawPlaying(GameManager gm, float vw, float vh, bool showPrompt = true)
        {
            // 조준점
            if (showPrompt) Fill(new Rect(vw / 2f - 2f, vh / 2f - 2f, 4f, 4f), new Color(1f, 1f, 1f, 0.6f));

            // 상호작용 안내
            if (showPrompt && gm.Player != null && !string.IsNullOrEmpty(gm.Player.CurrentPrompt))
                Shadowed(new Rect(vw / 2f - 300f, vh * 0.58f, 600f, 40f), gm.Player.CurrentPrompt, center, new Color(1f, 0.95f, 0.6f));

            // 메시지
            if (gm.MessageTimeLeft > 0f)
            {
                float a = Mathf.Clamp01(gm.MessageTimeLeft);
                Shadowed(new Rect(vw / 2f - 450f, vh - 150f, 900f, 60f), gm.Message, center, new Color(1f, 1f, 1f, a));
            }

            // 소지품
            int count = 0;
            foreach (var _ in gm.ItemNames) count++;
            Fill(new Rect(16f, 16f, 270f, 44f + 30f * (count + 1)), new Color(0f, 0f, 0f, 0.45f));
            Shadowed(new Rect(26f, 20f, 250f, 30f), "소지품", label, new Color(0.9f, 0.8f, 0.5f));
            float y = 52f;
            foreach (var name in gm.ItemNames)
            {
                Shadowed(new Rect(26f, y, 250f, 30f), "· " + name, label, Color.white);
                y += 30f;
            }
            Shadowed(new Rect(26f, y, 250f, 30f), "· 건전지 x" + gm.Batteries, label, new Color(0.8f, 0.8f, 0.8f));

            // 손전등 배터리 / 스태미나
            if (gm.Flashlight != null && gm.HasItem("flashlight"))
            {
                float ratio = gm.Flashlight.Charge / gm.Flashlight.maxCharge;
                Fill(new Rect(16f, vh - 52f, 204f, 18f), new Color(0f, 0f, 0f, 0.6f));
                Fill(new Rect(18f, vh - 50f, 200f * ratio, 14f), ratio > 0.2f ? new Color(1f, 0.9f, 0.4f) : new Color(1f, 0.3f, 0.2f));
                Shadowed(new Rect(228f, vh - 56f, 360f, 30f), "손전등 [F] / 교체 [B]" + (gm.Flashlight.IsOn ? "  ON" : ""), label, Color.white);
            }
            if (gm.Player != null)
            {
                float st = gm.Player.Stamina / gm.Player.maxStamina;
                Fill(new Rect(16f, vh - 70f, 204f, 8f), new Color(0f, 0f, 0f, 0.6f));
                Fill(new Rect(18f, vh - 69f, 200f * st, 6f), new Color(0.5f, 0.8f, 1f, 0.9f));
            }

            // 목표 및 조작
            Shadowed(new Rect(vw - 360f, 16f, 344f, 120f),
                "<b>목표</b>  정문 열쇠를 찾아 탈출하라\n\nWASD 이동 · Shift 달리기\nE 상호작용 · F 손전등 · B 건전지",
                label, new Color(1f, 1f, 1f, 0.75f));
        }

        void DrawNote(GameManager gm, float vw)
        {
            Fill(new Rect(0f, 0f, vw, VirtualHeight), new Color(0f, 0f, 0f, 0.65f));
            var panel = new Rect((vw - 700f) / 2f, 120f, 700f, 480f);
            Fill(panel, new Color(0.16f, 0.13f, 0.09f, 0.98f));
            Shadowed(new Rect(panel.x + 20f, panel.y + 16f, panel.width - 40f, 50f), gm.NoteTitle, title, new Color(0.95f, 0.85f, 0.6f));
            GUI.Label(new Rect(panel.x + 40f, panel.y + 90f, panel.width - 80f, 300f), gm.NoteBody, label);
            if (GUI.Button(new Rect(panel.x + panel.width / 2f - 110f, panel.yMax - 76f, 220f, 52f), "닫기 (E)", button)) gm.CloseUi();
        }

        void DrawKeypad(GameManager gm, float vw)
        {
            Fill(new Rect(0f, 0f, vw, VirtualHeight), new Color(0f, 0f, 0f, 0.65f));
            var panel = new Rect((vw - 380f) / 2f, 70f, 380f, 580f);
            Fill(panel, new Color(0.1f, 0.1f, 0.12f, 0.98f));
            Shadowed(new Rect(panel.x, panel.y + 12f, panel.width, 44f), "사물함 자물쇠", center, new Color(0.9f, 0.85f, 0.7f));

            int maxLen = gm.ActiveLock != null ? gm.ActiveLock.code.Length : 4;
            string display = "";
            for (int i = 0; i < maxLen; i++) display += (i < entry.Length ? entry[i].ToString() : "_") + " ";
            Fill(new Rect(panel.x + 40f, panel.y + 66f, panel.width - 80f, 70f), new Color(0f, 0.08f, 0f, 1f));
            Shadowed(new Rect(panel.x + 40f, panel.y + 74f, panel.width - 80f, 56f), display, title, new Color(0.4f, 1f, 0.4f));

            float bx = panel.x + 40f;
            float by = panel.y + 156f;
            for (int i = 0; i < 12; i++)
            {
                int col = i % 3;
                int row = i / 3;
                var r = new Rect(bx + col * 100f, by + row * 76f, 90f, 66f);
                string text;
                if (i < 9) text = (i + 1).ToString();
                else if (i == 9) text = "지움";
                else if (i == 10) text = "0";
                else text = "확인";

                if (!GUI.Button(r, text, button)) continue;
                if (i < 9 || i == 10)
                {
                    if (entry.Length < maxLen) entry += text;
                }
                else if (i == 9) entry = "";
                else SubmitCode(gm);
            }

            if (GUI.Button(new Rect(panel.x + 40f, panel.yMax - 66f, panel.width - 80f, 48f), "닫기 (Esc)", button)) gm.CloseUi();
        }

        void DrawEnding(float vw, float vh, string head, string body, Color color, GameManager gm)
        {
            Fill(new Rect(0f, 0f, vw, vh), new Color(0f, 0f, 0f, 0.88f));
            Shadowed(new Rect(0f, vh * 0.28f, vw, 80f), head, title, color);
            Shadowed(new Rect(vw / 2f - 450f, vh * 0.28f + 90f, 900f, 90f), body, center, Color.white);
            int total = Mathf.FloorToInt(gm.ElapsedTime);
            if (gm.State == GameState.Won)
                Shadowed(new Rect(0f, vh * 0.28f + 190f, vw, 40f), string.Format("탈출 시간  {0:00}:{1:00}", total / 60, total % 60), center, new Color(1f, 0.9f, 0.5f));
            Shadowed(new Rect(0f, vh * 0.28f + 250f, vw, 40f), "R 키를 눌러 다시 시작", center, new Color(1f, 1f, 1f, 0.8f));
        }

        static void Fill(Rect r, Color c)
        {
            var old = GUI.color;
            GUI.color = c;
            GUI.DrawTexture(r, Texture2D.whiteTexture);
            GUI.color = old;
        }

        static void Shadowed(Rect r, string text, GUIStyle style, Color c)
        {
            var old = GUI.color;
            GUI.color = new Color(0f, 0f, 0f, 0.8f * c.a);
            GUI.Label(new Rect(r.x + 2f, r.y + 2f, r.width, r.height), text, style);
            GUI.color = c;
            GUI.Label(r, text, style);
            GUI.color = old;
        }
    }
}
