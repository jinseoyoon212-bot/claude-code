using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>손전등. F: 켜기/끄기, B: 건전지 교체. 배터리가 닳으면 깜빡이다 꺼진다.</summary>
    [RequireComponent(typeof(Light))]
    public class Flashlight : MonoBehaviour
    {
        public float maxCharge = 100f;
        public float drainPerSecond = 0.9f;
        public float baseIntensity = 3.2f;

        public float Charge { get; private set; }
        public bool IsOn { get; private set; }

        Light lightSource;

        void Awake()
        {
            lightSource = GetComponent<Light>();
            Charge = maxCharge;
            lightSource.enabled = false;
        }

        void Start()
        {
            if (GameManager.Instance != null) GameManager.Instance.Flashlight = this;
        }

        void Update()
        {
            var gm = GameManager.Instance;
            if (gm == null || !gm.IsPlaying || !gm.HasItem("flashlight")) return;

            if (Input.GetKeyDown(KeyCode.F)) Toggle(gm);
            if (Input.GetKeyDown(KeyCode.B)) ReplaceBattery(gm);

            if (IsOn)
            {
                Charge -= drainPerSecond * Time.deltaTime;
                if (Charge <= 0f)
                {
                    Charge = 0f;
                    IsOn = false;
                    gm.Say("손전등이 꺼졌다! B 키로 건전지를 교체하자.");
                }
            }

            float intensity = baseIntensity;
            if (Charge < 15f)
            {
                intensity *= Mathf.PerlinNoise(Time.time * 18f, 0.3f) > 0.35f ? 0.7f : 0.1f;
            }
            lightSource.intensity = intensity;
            lightSource.enabled = IsOn;
        }

        void Toggle(GameManager gm)
        {
            if (Charge <= 0f)
            {
                gm.Say("배터리가 없다. B 키로 건전지를 교체하자.");
                return;
            }
            IsOn = !IsOn;
        }

        void ReplaceBattery(GameManager gm)
        {
            if (!gm.ConsumeBattery())
            {
                gm.Say("남은 건전지가 없다.");
                return;
            }
            Charge = maxCharge;
            gm.Say("건전지를 교체했다.");
        }
    }
}
