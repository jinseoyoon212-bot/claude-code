using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>
    /// 복도를 순찰하는 귀신. activateOnItemId 아이템을 얻으면 깨어난다.
    /// 손전등을 켜고 있거나 달리면 더 멀리서 발견당한다. 벽 뒤로 숨으면 추격이 끊긴다.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public class GhostAI : MonoBehaviour
    {
        public enum Mode { Dormant, Patrol, Chase }

        public Transform[] waypoints;
        public GameObject visual;
        public string activateOnItemId = "staff_key";
        public float patrolSpeed = 1.8f;
        public float chaseSpeed = 3.8f;
        public float sightWithLight = 14f;
        public float sightWithoutLight = 5f;
        public float runNoiseBonus = 4f;
        public float catchDistance = 1.1f;
        public float loseSightTime = 4f;

        public Mode CurrentMode { get; private set; } = Mode.Dormant;
        public float DistanceToPlayer { get; private set; } = 999f;

        CharacterController cc;
        int waypointIndex;
        float loseTimer;

        void Awake()
        {
            cc = GetComponent<CharacterController>();
        }

        void Start()
        {
            var gm = GameManager.Instance;
            gm.Ghost = this;
            gm.ItemAcquired += OnItemAcquired;
            if (visual != null) visual.SetActive(false);
            cc.enabled = false;
        }

        void OnDestroy()
        {
            if (GameManager.Instance != null) GameManager.Instance.ItemAcquired -= OnItemAcquired;
        }

        void OnItemAcquired(string id)
        {
            if (CurrentMode != Mode.Dormant || id != activateOnItemId) return;
            Awaken();
        }

        void Awaken()
        {
            if (waypoints != null && waypoints.Length > 0) transform.position = waypoints[0].position;
            cc.enabled = true;
            if (visual != null) visual.SetActive(true);
            waypointIndex = waypoints != null && waypoints.Length > 1 ? 1 : 0;
            CurrentMode = Mode.Patrol;
            GameManager.Instance.Say("…복도 어딘가에서 무언가가 깨어났다. 불빛을 끄고 숨을 죽여라.", 5f);
        }

        void Update()
        {
            var gm = GameManager.Instance;
            if (gm == null || CurrentMode == Mode.Dormant || !gm.IsPlaying || gm.Player == null) return;

            Vector3 playerPos = gm.Player.transform.position;
            Vector3 flat = playerPos - transform.position;
            flat.y = 0f;
            DistanceToPlayer = flat.magnitude;

            if (DistanceToPlayer < catchDistance)
            {
                gm.GameOver("귀신에게 붙잡혔다…");
                return;
            }

            bool sees = CanSee(gm, playerPos);

            if (CurrentMode == Mode.Patrol)
            {
                if (sees)
                {
                    CurrentMode = Mode.Chase;
                    loseTimer = loseSightTime;
                    gm.Say("뒤에서 무언가 쫓아온다! 도망쳐!", 3f);
                }
                else
                {
                    Patrol();
                }
            }

            if (CurrentMode == Mode.Chase)
            {
                if (sees)
                {
                    loseTimer = loseSightTime;
                }
                else
                {
                    loseTimer -= Time.deltaTime;
                    if (loseTimer <= 0f)
                    {
                        CurrentMode = Mode.Patrol;
                        waypointIndex = NearestWaypoint();
                        gm.Say("발소리가 멀어진다…");
                    }
                }

                if (CurrentMode == Mode.Chase) MoveToward(playerPos, chaseSpeed);
            }

            if (visual != null)
            {
                visual.transform.localPosition = new Vector3(0f, Mathf.Sin(Time.time * 2f) * 0.1f, 0f);
            }
        }

        bool CanSee(GameManager gm, Vector3 playerPos)
        {
            float range = gm.Flashlight != null && gm.Flashlight.IsOn ? sightWithLight : sightWithoutLight;
            if (gm.Player.IsRunning) range += runNoiseBonus;
            if (DistanceToPlayer > range) return false;

            Vector3 eye = transform.position + Vector3.up * 1.5f;
            Vector3 target = playerPos + Vector3.up * 1.2f;
            if (Physics.Linecast(eye, target, out RaycastHit hit, ~0, QueryTriggerInteraction.Ignore))
            {
                return hit.collider.GetComponentInParent<PlayerController>() != null;
            }
            return true;
        }

        void Patrol()
        {
            if (waypoints == null || waypoints.Length == 0) return;
            Vector3 target = waypoints[waypointIndex].position;
            Vector3 d = target - transform.position;
            d.y = 0f;
            if (d.magnitude < 0.6f) waypointIndex = (waypointIndex + 1) % waypoints.Length;
            MoveToward(target, patrolSpeed);
        }

        int NearestWaypoint()
        {
            if (waypoints == null || waypoints.Length == 0) return 0;
            int best = 0;
            float bestDist = float.MaxValue;
            for (int i = 0; i < waypoints.Length; i++)
            {
                float dist = (waypoints[i].position - transform.position).sqrMagnitude;
                if (dist < bestDist)
                {
                    bestDist = dist;
                    best = i;
                }
            }
            return best;
        }

        void MoveToward(Vector3 target, float speed)
        {
            Vector3 d = target - transform.position;
            d.y = 0f;
            if (d.sqrMagnitude < 0.0004f) return;
            d.Normalize();
            cc.Move(d * speed * Time.deltaTime);
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(d), 6f * Time.deltaTime);
        }
    }
}
