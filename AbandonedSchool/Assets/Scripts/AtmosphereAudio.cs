using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>외부 사운드 파일 없이 코드로 만든 환경음(낮은 웅웅거림)과 귀신 접근 시 심장 박동.</summary>
    public class AtmosphereAudio : MonoBehaviour
    {
        AudioSource hum;
        AudioSource heart;

        void Start()
        {
            hum = gameObject.AddComponent<AudioSource>();
            hum.clip = MakeHum();
            hum.loop = true;
            hum.volume = 0.5f;
            hum.spatialBlend = 0f;
            hum.Play();

            heart = gameObject.AddComponent<AudioSource>();
            heart.clip = MakeHeartbeat();
            heart.loop = true;
            heart.volume = 0f;
            heart.spatialBlend = 0f;
            heart.Play();
        }

        void Update()
        {
            var gm = GameManager.Instance;
            float targetVolume = 0f;
            float targetPitch = 1f;
            if (gm != null && gm.IsPlaying && gm.Ghost != null && gm.Ghost.CurrentMode != GhostAI.Mode.Dormant)
            {
                float t = Mathf.InverseLerp(16f, 3f, gm.Ghost.DistanceToPlayer);
                targetVolume = t * 0.9f;
                targetPitch = 1f + t * 0.8f;
            }
            heart.volume = Mathf.MoveTowards(heart.volume, targetVolume, Time.deltaTime * 1.5f);
            heart.pitch = Mathf.Lerp(heart.pitch, targetPitch, Time.deltaTime * 3f);
        }

        static AudioClip MakeHum()
        {
            const int rate = 22050;
            int len = rate * 4;
            var data = new float[len];
            var rng = new System.Random(11);
            float wind = 0f;
            for (int i = 0; i < len; i++)
            {
                float t = i / (float)rate;
                float tone = 0.12f * Mathf.Sin(2f * Mathf.PI * 55f * t)
                           + 0.07f * Mathf.Sin(2f * Mathf.PI * 82.5f * t)
                           + 0.03f * Mathf.Sin(2f * Mathf.PI * 110.25f * t);
                float noise = (float)(rng.NextDouble() * 2.0 - 1.0);
                wind += (noise - wind) * 0.02f;
                data[i] = tone + wind * 0.35f;
            }
            var clip = AudioClip.Create("hum", len, 1, rate, false);
            clip.SetData(data, 0);
            return clip;
        }

        static AudioClip MakeHeartbeat()
        {
            const int rate = 22050;
            int len = rate;
            var data = new float[len];
            for (int i = 0; i < len; i++)
            {
                float t = i / (float)rate;
                data[i] = Thump(t, 0f, 0.9f) + Thump(t, 0.28f, 0.6f);
            }
            var clip = AudioClip.Create("heartbeat", len, 1, rate, false);
            clip.SetData(data, 0);
            return clip;
        }

        static float Thump(float t, float start, float amplitude)
        {
            if (t < start) return 0f;
            float dt = t - start;
            return amplitude * Mathf.Exp(-dt * 18f) * Mathf.Sin(2f * Mathf.PI * 55f * dt);
        }
    }
}
