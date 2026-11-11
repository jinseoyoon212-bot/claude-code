using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>정문 밖 영역. 플레이어가 들어오면 탈출 성공.</summary>
    [RequireComponent(typeof(BoxCollider))]
    public class ExitZone : MonoBehaviour
    {
        BoxCollider zone;

        void Awake()
        {
            zone = GetComponent<BoxCollider>();
            zone.isTrigger = true;
        }

        void Update()
        {
            var gm = GameManager.Instance;
            if (gm == null || !gm.IsPlaying || gm.Player == null) return;
            if (zone.bounds.Contains(gm.Player.transform.position + Vector3.up)) gm.Win();
        }
    }
}
