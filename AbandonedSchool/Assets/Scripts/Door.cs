using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>경첩(pivot)을 기준으로 열리는 문. requiredKeyId가 있으면 잠겨 있다.</summary>
    public class Door : Interactable
    {
        public Transform pivot;
        public float openAngle = -90f;
        public string requiredKeyId = "";
        public string lockedMessage = "문이 잠겨 있다.";
        public string unlockMessage = "열쇠로 문을 열었다.";
        public float rotateSpeed = 140f;

        bool locked;
        bool open;
        Quaternion closedRot;
        Quaternion openRot;

        void Start()
        {
            locked = !string.IsNullOrEmpty(requiredKeyId);
            closedRot = pivot.localRotation;
            openRot = closedRot * Quaternion.Euler(0f, openAngle, 0f);
        }

        void Update()
        {
            var target = open ? openRot : closedRot;
            pivot.localRotation = Quaternion.RotateTowards(pivot.localRotation, target, rotateSpeed * Time.deltaTime);
        }

        public override string GetPrompt()
        {
            if (locked) return "잠긴 문";
            return open ? "문 닫기" : "문 열기";
        }

        public override void Interact(PlayerController player)
        {
            var gm = GameManager.Instance;
            if (locked)
            {
                if (!gm.HasItem(requiredKeyId))
                {
                    gm.Say(lockedMessage);
                    return;
                }
                locked = false;
                open = true;
                gm.Say(unlockMessage);
                return;
            }
            open = !open;
        }
    }
}
