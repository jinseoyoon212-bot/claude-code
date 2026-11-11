using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>고장 난 형광등처럼 깜빡이는 조명.</summary>
    [RequireComponent(typeof(Light))]
    public class LightFlicker : MonoBehaviour
    {
        public float minFactor = 0.25f;
        public float speed = 6f;
        public float blackoutRate = 0.4f;

        Light lightSource;
        float baseIntensity;
        float seed;
        float blackout;

        void Awake()
        {
            lightSource = GetComponent<Light>();
            baseIntensity = lightSource.intensity;
            seed = Random.value * 100f;
        }

        void Update()
        {
            if (blackout > 0f) blackout -= Time.deltaTime;
            else if (Random.value < blackoutRate * Time.deltaTime) blackout = Random.Range(0.05f, 0.35f);

            float n = Mathf.PerlinNoise(seed, Time.time * speed);
            float factor = Mathf.Lerp(minFactor, 1f, n);
            lightSource.intensity = blackout > 0f ? 0f : baseIntensity * factor;
        }
    }
}
