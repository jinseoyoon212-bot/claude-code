#if UNITY_EDITOR
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace AbandonedSchool.EditorTools
{
    /// <summary>
    /// 메뉴 Tools > 폐교 탈출 > 씬 생성 으로 게임 씬 전체(건물, 퍼즐, 귀신, 플레이어)를 자동 생성한다.
    /// 최초 프로젝트 오픈 시 씬이 없으면 자동으로 한 번 생성된다.
    /// </summary>
    public static class SchoolSceneBuilder
    {
        const string ScenePath = "Assets/Scenes/AbandonedSchool.unity";
        const string MaterialDir = "Assets/Materials";

        const float WallHeight = 3f;
        const float WallThickness = 0.3f;
        const float DoorHeight = 2.2f;
        const float DoorWidth = 1.4f;
        const float DeskTop = 0.75f;

#if UNITY_2022_2_OR_NEWER
        const string BuiltinFont = "LegacyRuntime.ttf";
#else
        const string BuiltinFont = "Arial.ttf";
#endif

        static readonly Dictionary<string, Material> materials = new Dictionary<string, Material>();
        static Transform root;

        [InitializeOnLoadMethod]
        static void AutoCreateOnFirstOpen()
        {
            EditorApplication.delayCall += () =>
            {
                if (EditorApplication.isPlayingOrWillChangePlayMode) return;
                if (!File.Exists(ScenePath)) Build();
            };
        }

        [MenuItem("Tools/폐교 탈출/씬 생성 (Build Scene)")]
        public static void Build()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            materials.Clear();
            EnsureFolder("Assets/Scenes");
            EnsureFolder(MaterialDir);
            Random.InitState(1993);

            root = new GameObject("School").transform;

            BuildShell();
            BuildCorridor();
            BuildClassroom();
            BuildScienceRoom();
            BuildStaffRoom();
            BuildExterior();
            BuildDebris();
            BuildGhost();
            BuildPlayerAndSystems();

            RenderSettings.skybox = null;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.035f, 0.04f, 0.05f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = new Color(0.01f, 0.012f, 0.015f);
            RenderSettings.fogDensity = 0.03f;

            PlayerSettings.productName = "폐교 탈출";

            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.SaveAssets();
            AddToBuildSettings();
            Debug.Log("[폐교 탈출] 씬 생성 완료: " + ScenePath + "  (Play 버튼으로 바로 플레이할 수 있습니다)");
        }

        [MenuItem("Tools/폐교 탈출/Windows 빌드")]
        public static void BuildWindows()
        {
            if (!File.Exists(ScenePath)) Build();
            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = "Builds/AbandonedSchool/AbandonedSchool.exe",
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.None
            };
            BuildPipeline.BuildPlayer(options);
        }

        // ------------------------------------------------------------------ 건물 뼈대

        static void BuildShell()
        {
            Material floor = Mat("Floor", new Color(0.18f, 0.16f, 0.14f), 0.25f);
            Material ceiling = Mat("Ceiling", new Color(0.2f, 0.2f, 0.19f));
            Material wall = Mat("Wall", new Color(0.32f, 0.33f, 0.3f));

            Box("Floor", new Vector3(15f, -0.05f, 4f), new Vector3(30.6f, 0.1f, 12.6f), floor);
            Box("Ceiling", new Vector3(15f, WallHeight + 0.05f, 4f), new Vector3(30.6f, 0.1f, 12.6f), ceiling);

            // 외벽
            Wall("Wall_South", true, -2f, -0.15f, 30.15f, DoorWidth, wall);
            Wall("Wall_North", true, 10f, -0.15f, 30.15f, DoorWidth, wall);
            Wall("Wall_West", false, 0f, -2.15f, 10.15f, DoorWidth, wall);
            // 동쪽 외벽: 정문(폭 2m)이 z=0 위치
            Wall("Wall_East", false, 30f, -2.15f, 10.15f, 2f, wall, 0f);

            // 복도와 교실 사이 벽 (문 3개: 교실, 과학실, 교무실)
            Wall("Wall_Corridor", true, 2f, -0.15f, 30.15f, DoorWidth, wall, 5f, 15f, 25f);
            // 교실 사이 벽
            Wall("Wall_Divider1", false, 10f, 1.85f, 10f, DoorWidth, wall);
            Wall("Wall_Divider2", false, 20f, 1.85f, 10f, DoorWidth, wall);

            // 문
            MakeDoor("Door_Classroom", new Vector3(5f - DoorWidth / 2f, 0f, 2f), true, DoorWidth, "", "", -90f);
            MakeDoor("Door_Science", new Vector3(15f - DoorWidth / 2f, 0f, 2f), true, DoorWidth, "science_key",
                "과학실 문이 잠겨 있다. 열쇠가 필요하다.", -90f);
            MakeDoor("Door_Staff", new Vector3(25f - DoorWidth / 2f, 0f, 2f), true, DoorWidth, "staff_key",
                "교무실 문이 잠겨 있다. 열쇠가 필요하다.", -90f);
            var gate = MakeDoor("Door_Gate", new Vector3(30f, 0f, -1f), false, 2f, "gate_key",
                "정문이 굳게 잠겨 있다. 정문 열쇠가 필요하다.", 90f);
            gate.requiredKeyId = "gate_key";
            gate.unlockMessage = "정문이 열렸다! 밖으로 나가자!";

            Text3D("ExitSign", "EXIT", new Vector3(29.8f, 2.65f, 0f), Quaternion.Euler(0f, 90f, 0f),
                new Color(0.2f, 0.9f, 0.3f), 0.08f);
        }

        // ------------------------------------------------------------------ 복도

        static void BuildCorridor()
        {
            Material locker = Mat("CorridorLocker", new Color(0.22f, 0.28f, 0.3f), 0.3f);
            foreach (float x in new[] { 3f, 7f, 9f, 17f, 21f, 26f })
                Box("HallLocker", new Vector3(x, 0.95f, -1.7f), new Vector3(0.8f, 1.9f, 0.5f), locker);

            // 벤치 + 건전지
            Box("Bench", new Vector3(12f, 0.225f, -1.65f), new Vector3(1.2f, 0.45f, 0.4f), Mat("Wood", new Color(0.25f, 0.17f, 0.1f)));
            Pickup("Battery_Hall", "battery", "건전지", new Vector3(12f, 0.5f, -1.65f), new Vector3(0.1f, 0.1f, 0.2f), new Color(0.3f, 0.9f, 0.3f));

            // 깜빡이는 복도 조명 (벽 너머로 빛이 새지 않도록 그림자 사용)
            foreach (float x in new[] { 6f, 15f, 24f })
                PointLight("HallLight", new Vector3(x, 2.7f, 0f), new Color(0.75f, 0.9f, 0.7f), 0.9f, 8f, true, true);
        }

        // ------------------------------------------------------------------ 교실 (시작 지점)

        static void BuildClassroom()
        {
            Material desk = Mat("Desk", new Color(0.3f, 0.22f, 0.14f));
            Material chair = Mat("Chair", new Color(0.18f, 0.15f, 0.12f));

            Box("Blackboard", new Vector3(5f, 1.7f, 9.82f), new Vector3(6f, 1.3f, 0.05f), Mat("Board", new Color(0.05f, 0.14f, 0.1f)));
            Text3D("BoardText", "GRADUATION\n1993.02.17", new Vector3(5f, 1.7f, 9.78f), Quaternion.identity,
                new Color(0.55f, 0.55f, 0.5f), 0.07f);

            foreach (float x in new[] { 2f, 4f, 6f, 8f })
            {
                foreach (float z in new[] { 4.8f, 6.8f })
                {
                    float yaw = Random.Range(-8f, 8f);
                    var d = Box("Desk", new Vector3(x, DeskTop / 2f, z), new Vector3(0.9f, DeskTop, 0.55f), desk);
                    d.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
                    var c = Box("Chair", new Vector3(x + Random.Range(-0.1f, 0.1f), 0.225f, z - 0.65f), new Vector3(0.4f, 0.45f, 0.4f), chair);
                    c.transform.rotation = Quaternion.Euler(0f, Random.Range(-25f, 25f), 0f);
                }
            }

            // 교탁 + 손전등
            Box("TeacherDesk", new Vector3(5f, 0.4f, 8.7f), new Vector3(1.6f, 0.8f, 0.7f), desk);
            Pickup("Flashlight", "flashlight", "손전등", new Vector3(5f, 0.86f, 8.7f), new Vector3(0.08f, 0.08f, 0.26f), new Color(0.9f, 0.8f, 0.3f));

            // 단서 쪽지
            Note("Note_Graduation", new Vector3(2f, DeskTop + 0.02f, 4.8f), "구겨진 쪽지",
                "마지막 졸업식 날, 칠판에 날짜를 적어 두었다.\n\n사물함은 그 <b>해(年)의 숫자 네 자리</b>로 열린다.\n\n…그 아이는 아직도 그 사물함 앞에 서 있을지도 모른다.");

            // 사물함 (비밀번호 1993) -> 과학실 열쇠
            Material lockerMat = Mat("Locker", new Color(0.2f, 0.3f, 0.32f), 0.3f);
            Box("LockerBody", new Vector3(0.5f, 1f, 6f), new Vector3(0.6f, 2f, 1.2f), lockerMat);
            var pivot = new GameObject("LockerDoorPivot");
            pivot.transform.SetParent(root, false);
            pivot.transform.position = new Vector3(0.82f, 1f, 5.4f);
            var panel = Box("LockerDoor", new Vector3(0.02f, 0f, 0.55f), new Vector3(0.04f, 1.9f, 1.1f), Mat("LockerDoor", new Color(0.26f, 0.38f, 0.4f), 0.3f), pivot.transform);
            Box("LockerLamp", new Vector3(0.03f, 0.1f, 0.9f), new Vector3(0.03f, 0.1f, 0.1f),
                Mat("RedLamp", new Color(0.6f, 0.05f, 0.05f), 0.5f, new Color(0.8f, 0.05f, 0.05f)), pivot.transform);
            var loot = panel.AddComponent<LootContainer>();
            loot.containerName = "사물함";
            loot.requiresCode = true;
            loot.code = "1993";
            loot.rewardId = "science_key";
            loot.rewardName = "과학실 열쇠";
            loot.doorPivot = pivot.transform;
            loot.openAngle = 110f;
            loot.openAxis = Vector3.up;

            PointLight("ClassroomLight", new Vector3(5f, 2.6f, 6f), new Color(0.5f, 0.6f, 0.8f), 0.25f, 7f, false, false);
        }

        // ------------------------------------------------------------------ 과학실

        static void BuildScienceRoom()
        {
            Material table = Mat("LabTable", new Color(0.12f, 0.14f, 0.14f), 0.4f);
            foreach (var p in new[] { new Vector2(13f, 4.5f), new Vector2(17f, 4.5f), new Vector2(13f, 7.5f), new Vector2(17f, 7.5f) })
                Box("LabTable", new Vector3(p.x, 0.45f, p.y), new Vector3(2.4f, 0.9f, 0.9f), table);

            Pickup("Battery_Lab1", "battery", "건전지", new Vector3(13f, 0.96f, 4.5f), new Vector3(0.1f, 0.1f, 0.2f), new Color(0.3f, 0.9f, 0.3f));
            Pickup("Battery_Lab2", "battery", "건전지", new Vector3(17f, 0.96f, 7.5f), new Vector3(0.1f, 0.1f, 0.2f), new Color(0.3f, 0.9f, 0.3f));

            Note("Note_Lab", new Vector3(13f, 0.92f, 7.5f), "실험 일지",
                "약품장 안쪽에 <b>교무실 열쇠</b>를 숨겨 두었다.\n\n그런데 밤마다 복도에서 발소리가 들린다.\n불빛에 반응하는 것 같다. 손전등을 끄고 숨을 죽이면 그것은 그냥 지나간다.\n\n…뛰면 안 된다. 소리를 듣는다.");

            // 약품장 -> 교무실 열쇠
            Box("CabinetBody", new Vector3(19.4f, 1f, 6.2f), new Vector3(0.8f, 2f, 1.6f), Mat("Cabinet", new Color(0.3f, 0.26f, 0.2f)));
            var pivot = new GameObject("CabinetDoorPivot");
            pivot.transform.SetParent(root, false);
            pivot.transform.position = new Vector3(18.98f, 1f, 5.4f);
            var panel = Box("CabinetDoor", new Vector3(-0.02f, 0f, 0.75f), new Vector3(0.04f, 1.9f, 1.5f), Mat("CabinetDoor", new Color(0.36f, 0.3f, 0.22f)), pivot.transform);
            var loot = panel.AddComponent<LootContainer>();
            loot.containerName = "약품장";
            loot.rewardId = "staff_key";
            loot.rewardName = "교무실 열쇠";
            loot.doorPivot = pivot.transform;
            loot.openAngle = -110f;
            loot.openAxis = Vector3.up;

            PointLight("LabLight", new Vector3(15f, 2.6f, 6f), new Color(0.4f, 0.8f, 0.6f), 0.25f, 7f, false, false);
        }

        // ------------------------------------------------------------------ 교무실

        static void BuildStaffRoom()
        {
            Material desk = Mat("StaffDesk", new Color(0.22f, 0.16f, 0.1f));
            foreach (var p in new[] { new Vector2(22.5f, 5f), new Vector2(22.5f, 7.5f), new Vector2(27.5f, 5f) })
                Box("StaffDesk", new Vector3(p.x, 0.4f, p.y), new Vector3(1.4f, 0.8f, 0.8f), desk);

            Pickup("Battery_Staff", "battery", "건전지", new Vector3(22.5f, 0.86f, 5f), new Vector3(0.1f, 0.1f, 0.2f), new Color(0.3f, 0.9f, 0.3f));

            // 교장 책상 + 서랍 -> 정문 열쇠
            Box("PrincipalDesk", new Vector3(26f, 0.4f, 8.5f), new Vector3(2f, 0.8f, 0.9f), desk);
            Note("Note_Principal", new Vector3(26.8f, 0.82f, 8.5f), "교장의 메모",
                "정문 열쇠는 내 책상 <b>서랍</b>에 있다.\n\n학교는 문을 닫았지만 아이들은 아직 돌아가지 못했다.\n\n열쇠를 챙기면 곧장 정문으로 가라. 뒤돌아보지 마라.");

            var pivot = new GameObject("DrawerPivot");
            pivot.transform.SetParent(root, false);
            pivot.transform.position = new Vector3(26f, 0.45f, 8.04f);
            var panel = Box("DrawerFront", new Vector3(0f, 0.1f, -0.02f), new Vector3(0.8f, 0.2f, 0.04f), Mat("Drawer", new Color(0.3f, 0.22f, 0.13f)), pivot.transform);
            var loot = panel.AddComponent<LootContainer>();
            loot.containerName = "서랍";
            loot.rewardId = "gate_key";
            loot.rewardName = "정문 열쇠";
            loot.doorPivot = pivot.transform;
            loot.openAngle = -70f;
            loot.openAxis = Vector3.right;

            foreach (float z in new[] { 4f, 6f, 8f })
                Box("FilingCabinet", new Vector3(29.45f, 0.75f, z), new Vector3(0.7f, 1.5f, 0.6f), Mat("Filing", new Color(0.25f, 0.27f, 0.28f), 0.4f));

            PointLight("StaffLight", new Vector3(25f, 2.6f, 6f), new Color(0.8f, 0.7f, 0.5f), 0.25f, 7f, false, false);
        }

        // ------------------------------------------------------------------ 건물 밖

        static void BuildExterior()
        {
            Box("Ground", new Vector3(15f, -0.15f, 4f), new Vector3(140f, 0.1f, 100f), Mat("Ground", new Color(0.05f, 0.08f, 0.05f)));
            Box("Porch", new Vector3(33f, -0.05f, 0f), new Vector3(6f, 0.1f, 4f), Mat("Porch", new Color(0.2f, 0.2f, 0.2f)));
            PointLight("MoonOutside", new Vector3(34f, 3.5f, 0f), new Color(0.6f, 0.75f, 1f), 1.6f, 14f, false, false);

            var zone = new GameObject("ExitZone");
            zone.transform.SetParent(root, false);
            zone.transform.position = new Vector3(33f, 1f, 0f);
            var col = zone.AddComponent<BoxCollider>();
            col.size = new Vector3(4f, 3f, 5f);
            col.isTrigger = true;
            zone.AddComponent<ExitZone>();
        }

        static void BuildDebris()
        {
            Material paper = Mat("DebrisPaper", new Color(0.5f, 0.48f, 0.42f));
            for (int i = 0; i < 60; i++)
            {
                bool inCorridor = Random.value < 0.4f;
                float x = Random.Range(0.5f, 29.5f);
                float z = inCorridor ? Random.Range(-1.8f, 1.8f) : Random.Range(2.5f, 9.5f);
                var go = Box("Debris", new Vector3(x, 0.01f, z), new Vector3(Random.Range(0.15f, 0.4f), 0.01f, Random.Range(0.1f, 0.3f)), paper);
                go.transform.rotation = Quaternion.Euler(0f, Random.Range(0f, 360f), 0f);
                Object.DestroyImmediate(go.GetComponent<Collider>());
            }
        }

        // ------------------------------------------------------------------ 귀신 / 플레이어

        static void BuildGhost()
        {
            var ghost = new GameObject("Ghost");
            ghost.transform.position = new Vector3(2f, 0f, 0f);

            var cc = ghost.AddComponent<CharacterController>();
            cc.height = 2f;
            cc.radius = 0.4f;
            cc.center = new Vector3(0f, 1f, 0f);
            cc.enabled = false;

            var ai = ghost.AddComponent<GhostAI>();

            var wps = new List<Transform>();
            foreach (float x in new[] { 2f, 14f, 28f, 14f })
            {
                var w = new GameObject("GhostWaypoint");
                w.transform.SetParent(root, false);
                w.transform.position = new Vector3(x, 0f, 0f);
                wps.Add(w.transform);
            }
            ai.waypoints = wps.ToArray();

            var visual = new GameObject("Visual");
            visual.transform.SetParent(ghost.transform, false);

            var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            body.name = "Body";
            body.transform.SetParent(visual.transform, false);
            body.transform.localPosition = new Vector3(0f, 1f, 0f);
            body.transform.localScale = new Vector3(0.8f, 1f, 0.8f);
            body.GetComponent<Renderer>().sharedMaterial = Mat("Ghost", new Color(0.75f, 0.8f, 0.85f), 0.1f, new Color(0.3f, 0.34f, 0.38f));
            Object.DestroyImmediate(body.GetComponent<Collider>());

            Material eye = Mat("GhostEye", new Color(0.1f, 0f, 0f), 0.5f, new Color(1f, 0.05f, 0.05f));
            foreach (float x in new[] { -0.15f, 0.15f })
            {
                var e = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                e.name = "Eye";
                e.transform.SetParent(visual.transform, false);
                e.transform.localPosition = new Vector3(x, 1.6f, 0.3f);
                e.transform.localScale = Vector3.one * 0.12f;
                e.GetComponent<Renderer>().sharedMaterial = eye;
                Object.DestroyImmediate(e.GetComponent<Collider>());
            }

            var lightGo = new GameObject("GhostGlow");
            lightGo.transform.SetParent(visual.transform, false);
            lightGo.transform.localPosition = new Vector3(0f, 1.2f, 0f);
            var l = lightGo.AddComponent<Light>();
            l.type = LightType.Point;
            l.color = new Color(0.5f, 0.7f, 1f);
            l.intensity = 0.8f;
            l.range = 4f;

            visual.SetActive(false);
            ai.visual = visual;
        }

        static void BuildPlayerAndSystems()
        {
            var player = new GameObject("Player");
            player.tag = "Player";
            player.transform.position = new Vector3(5f, 0.05f, 3.3f);

            var cc = player.AddComponent<CharacterController>();
            cc.height = 1.8f;
            cc.radius = 0.3f;
            cc.center = new Vector3(0f, 0.9f, 0f);
            cc.stepOffset = 0.3f;
            cc.slopeLimit = 45f;

            var pc = player.AddComponent<PlayerController>();

            var camGo = new GameObject("Camera");
            camGo.tag = "MainCamera";
            camGo.transform.SetParent(player.transform, false);
            camGo.transform.localPosition = new Vector3(0f, 1.6f, 0f);
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.01f, 0.01f, 0.02f);
            cam.nearClipPlane = 0.05f;
            cam.fieldOfView = 70f;
            camGo.AddComponent<AudioListener>();
            pc.cameraPivot = camGo.transform;

            var lightGo = new GameObject("Flashlight");
            lightGo.transform.SetParent(camGo.transform, false);
            lightGo.transform.localPosition = new Vector3(0.15f, -0.1f, 0.1f);
            var l = lightGo.AddComponent<Light>();
            l.type = LightType.Spot;
            l.range = 18f;
            l.spotAngle = 55f;
            l.intensity = 3.2f;
            l.color = new Color(1f, 0.96f, 0.82f);
            l.shadows = LightShadows.Soft;
            l.enabled = false;
            lightGo.AddComponent<Flashlight>();

            var game = new GameObject("Game");
            game.AddComponent<GameManager>();
            game.AddComponent<GameHud>();
            game.AddComponent<AtmosphereAudio>();
        }

        // ------------------------------------------------------------------ 헬퍼

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int slash = path.LastIndexOf('/');
            AssetDatabase.CreateFolder(path.Substring(0, slash), path.Substring(slash + 1));
        }

        static void AddToBuildSettings()
        {
            var list = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            if (list.Exists(s => s.path == ScenePath)) return;
            list.Insert(0, new EditorBuildSettingsScene(ScenePath, true));
            EditorBuildSettings.scenes = list.ToArray();
        }

        static Material Mat(string name, Color color, float smoothness = 0.1f, Color? emission = null)
        {
            if (materials.TryGetValue(name, out var cached)) return cached;

            string path = MaterialDir + "/" + name + ".mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null)
            {
                m = new Material(Shader.Find("Standard"));
                AssetDatabase.CreateAsset(m, path);
            }
            m.color = color;
            m.SetFloat("_Glossiness", smoothness);
            if (emission.HasValue)
            {
                m.EnableKeyword("_EMISSION");
                m.SetColor("_EmissionColor", emission.Value);
            }
            EditorUtility.SetDirty(m);
            materials[name] = m;
            return m;
        }

        static GameObject Box(string name, Vector3 center, Vector3 size, Material mat, Transform parent = null)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent != null ? parent : root, false);
            go.transform.localPosition = center;
            go.transform.localScale = size;
            go.GetComponent<Renderer>().sharedMaterial = mat;
            return go;
        }

        /// <summary>X축 방향(alongX) 또는 Z축 방향 벽. fixedCoord는 고정 좌표, doors는 문 중심 위치.</summary>
        static void Wall(string name, bool alongX, float fixedCoord, float from, float to, float doorWidth, Material mat, params float[] doors)
        {
            var sorted = new List<float>(doors);
            sorted.Sort();
            float cursor = from;
            foreach (float d in sorted)
            {
                float a = d - doorWidth / 2f;
                float b = d + doorWidth / 2f;
                if (a > cursor) WallSegment(name, alongX, fixedCoord, cursor, a, WallHeight, 0f, mat);
                WallSegment(name + "_Lintel", alongX, fixedCoord, a, b, WallHeight - DoorHeight, DoorHeight, mat);
                cursor = b;
            }
            if (to > cursor) WallSegment(name, alongX, fixedCoord, cursor, to, WallHeight, 0f, mat);
        }

        static void WallSegment(string name, bool alongX, float fixedCoord, float a, float b, float height, float bottom, Material mat)
        {
            float len = b - a;
            float mid = (a + b) / 2f;
            float y = bottom + height / 2f;
            Vector3 center = alongX ? new Vector3(mid, y, fixedCoord) : new Vector3(fixedCoord, y, mid);
            Vector3 size = alongX ? new Vector3(len, height, WallThickness) : new Vector3(WallThickness, height, len);
            Box(name, center, size, mat);
        }

        static Door MakeDoor(string name, Vector3 hinge, bool wallAlongX, float width, string keyId, string lockedMessage, float openAngle)
        {
            var pivot = new GameObject(name + "_Pivot");
            pivot.transform.SetParent(root, false);
            pivot.transform.position = hinge;

            float w = width - 0.02f;
            Vector3 center = wallAlongX ? new Vector3(w / 2f, DoorHeight / 2f, 0f) : new Vector3(0f, DoorHeight / 2f, w / 2f);
            Vector3 size = wallAlongX ? new Vector3(w, DoorHeight, 0.08f) : new Vector3(0.08f, DoorHeight, w);
            Color color = string.IsNullOrEmpty(keyId) ? new Color(0.28f, 0.2f, 0.12f) : new Color(0.2f, 0.14f, 0.1f);
            var panel = Box(name, center, size, Mat("Door_" + (string.IsNullOrEmpty(keyId) ? "Open" : keyId), color), pivot.transform);

            var door = panel.AddComponent<Door>();
            door.pivot = pivot.transform;
            door.requiredKeyId = keyId;
            door.lockedMessage = string.IsNullOrEmpty(lockedMessage) ? "문이 잠겨 있다." : lockedMessage;
            door.openAngle = openAngle;
            return door;
        }

        static GameObject Pickup(string name, string id, string display, Vector3 pos, Vector3 size, Color color)
        {
            var go = Box(name, pos, size, Mat("Item_" + id, color, 0.4f, color * 0.4f));
            var item = go.AddComponent<PickupItem>();
            item.itemId = id;
            item.displayName = display;
            return go;
        }

        static GameObject Note(string name, Vector3 pos, string title, string body)
        {
            var go = Box(name, pos, new Vector3(0.28f, 0.03f, 0.2f), Mat("Paper", new Color(0.85f, 0.82f, 0.7f), 0f, new Color(0.15f, 0.14f, 0.1f)));
            go.transform.rotation = Quaternion.Euler(0f, Random.Range(0f, 360f), 0f);
            var note = go.AddComponent<NoteItem>();
            note.title = title;
            note.body = body;
            return go;
        }

        static GameObject Text3D(string name, string text, Vector3 pos, Quaternion rot, Color color, float size)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            go.transform.SetPositionAndRotation(pos, rot);

            var font = Resources.GetBuiltinResource<Font>(BuiltinFont);
            var tm = go.AddComponent<TextMesh>();
            tm.font = font;
            tm.text = text;
            tm.fontSize = 64;
            tm.characterSize = size;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.color = color;

            var mr = go.GetComponent<MeshRenderer>();
            if (mr == null) mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = font.material;
            return go;
        }

        static void PointLight(string name, Vector3 pos, Color color, float intensity, float range, bool shadows, bool flicker)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            go.transform.position = pos;
            var l = go.AddComponent<Light>();
            l.type = LightType.Point;
            l.color = color;
            l.intensity = intensity;
            l.range = range;
            l.shadows = shadows ? LightShadows.Hard : LightShadows.None;
            if (flicker) go.AddComponent<LightFlicker>();
        }
    }
}
#endif
