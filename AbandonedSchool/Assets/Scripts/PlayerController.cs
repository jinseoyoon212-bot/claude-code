using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>1인칭 이동, 시점, 상호작용(E).</summary>
    [RequireComponent(typeof(CharacterController))]
    public class PlayerController : MonoBehaviour
    {
        public Transform cameraPivot;
        public float walkSpeed = 3.2f;
        public float runSpeed = 5.6f;
        public float mouseSensitivity = 2f;
        public float interactDistance = 2.6f;
        public float gravity = -20f;
        public float maxStamina = 5f;

        public string CurrentPrompt { get; private set; } = "";
        public bool IsRunning { get; private set; }
        public float Stamina { get; private set; }

        CharacterController cc;
        AudioSource stepSource;
        static AudioClip stepClip;
        float pitch;
        float verticalVelocity;
        float stepDistance;
        bool exhausted;

        void Awake()
        {
            cc = GetComponent<CharacterController>();
            Stamina = maxStamina;
            stepSource = gameObject.AddComponent<AudioSource>();
            stepSource.spatialBlend = 0f;
            stepSource.playOnAwake = false;
            if (stepClip == null) stepClip = MakeStepClip();
        }

        void Start()
        {
            if (GameManager.Instance != null) GameManager.Instance.Player = this;
        }

        void Update()
        {
            var gm = GameManager.Instance;
            if (gm != null && !gm.IsPlaying)
            {
                CurrentPrompt = "";
                IsRunning = false;
                return;
            }

            Look();
            Move();
            Interact();
        }

        void Look()
        {
            float mx = Input.GetAxis("Mouse X") * mouseSensitivity;
            float my = Input.GetAxis("Mouse Y") * mouseSensitivity;
            transform.Rotate(0f, mx, 0f);
            pitch = Mathf.Clamp(pitch - my, -80f, 80f);
            if (cameraPivot != null) cameraPivot.localEulerAngles = new Vector3(pitch, 0f, 0f);
        }

        void Move()
        {
            float h = Input.GetAxisRaw("Horizontal");
            float v = Input.GetAxisRaw("Vertical");
            Vector3 dir = transform.right * h + transform.forward * v;
            if (dir.sqrMagnitude > 1f) dir.Normalize();
            bool moving = dir.sqrMagnitude > 0.01f;

            bool wantRun = Input.GetKey(KeyCode.LeftShift) && moving && v > 0f;
            if (exhausted && Stamina > 1.5f) exhausted = false;
            IsRunning = wantRun && !exhausted && Stamina > 0f;
            if (IsRunning)
            {
                Stamina -= Time.deltaTime;
                if (Stamina <= 0f)
                {
                    Stamina = 0f;
                    exhausted = true;
                    IsRunning = false;
                }
            }
            else
            {
                Stamina = Mathf.Min(maxStamina, Stamina + 0.8f * Time.deltaTime);
            }

            float speed = IsRunning ? runSpeed : walkSpeed;

            if (cc.isGrounded && verticalVelocity < 0f) verticalVelocity = -2f;
            verticalVelocity += gravity * Time.deltaTime;

            Vector3 motion = dir * speed + Vector3.up * verticalVelocity;
            cc.Move(motion * Time.deltaTime);

            if (moving && cc.isGrounded)
            {
                stepDistance += speed * Time.deltaTime;
                float stride = IsRunning ? 2.2f : 1.8f;
                if (stepDistance >= stride)
                {
                    stepDistance = 0f;
                    stepSource.pitch = Random.Range(0.85f, 1.1f);
                    stepSource.PlayOneShot(stepClip, IsRunning ? 0.6f : 0.35f);
                }
            }
        }

        void Interact()
        {
            CurrentPrompt = "";
            if (cameraPivot == null) return;

            var ray = new Ray(cameraPivot.position, cameraPivot.forward);
            if (!Physics.Raycast(ray, out RaycastHit hit, interactDistance, ~0, QueryTriggerInteraction.Ignore)) return;

            var target = hit.collider.GetComponentInParent<Interactable>();
            if (target == null) return;

            CurrentPrompt = "[E] " + target.GetPrompt();
            if (Input.GetKeyDown(KeyCode.E)) target.Interact(this);
        }

        static AudioClip MakeStepClip()
        {
            const int rate = 22050;
            int len = (int)(rate * 0.16f);
            var data = new float[len];
            var rng = new System.Random(7);
            float lowPass = 0f;
            for (int i = 0; i < len; i++)
            {
                float noise = (float)(rng.NextDouble() * 2.0 - 1.0);
                lowPass += (noise - lowPass) * 0.15f;
                data[i] = lowPass * 2.5f * Mathf.Exp(-i / (float)len * 7f);
            }
            var clip = AudioClip.Create("step", len, 1, rate, false);
            clip.SetData(data, 0);
            return clip;
        }
    }
}
