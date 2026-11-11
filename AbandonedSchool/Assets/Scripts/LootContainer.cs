using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>사물함/서랍/약품장. 열면 아이템이 나온다. requiresCode이면 숫자 자물쇠를 풀어야 한다.</summary>
    public class LootContainer : Interactable
    {
        public string containerName = "서랍";
        public bool requiresCode;
        public string code = "0000";
        public string rewardId = "";
        public string rewardName = "";
        public string emptyMessage = "안은 비어 있다.";
        public Transform doorPivot;
        public float openAngle = -110f;
        public Vector3 openAxis = Vector3.up;

        bool opened;
        Quaternion closedRot;
        Quaternion openRot;

        void Start()
        {
            if (doorPivot == null) return;
            closedRot = doorPivot.localRotation;
            openRot = closedRot * Quaternion.AngleAxis(openAngle, openAxis);
        }

        void Update()
        {
            if (!opened || doorPivot == null) return;
            doorPivot.localRotation = Quaternion.RotateTowards(doorPivot.localRotation, openRot, 150f * Time.deltaTime);
        }

        public override string GetPrompt()
        {
            if (opened) return containerName + " (비어 있음)";
            return requiresCode ? containerName + " 비밀번호 입력" : containerName + " 열기";
        }

        public override void Interact(PlayerController player)
        {
            var gm = GameManager.Instance;
            if (opened)
            {
                gm.Say(emptyMessage);
                return;
            }
            if (requiresCode)
            {
                gm.OpenKeypad(this);
                return;
            }
            Open();
        }

        /// <summary>숫자 자물쇠 입력 확인. 맞으면 true.</summary>
        public bool TrySubmit(string input)
        {
            if (input == code)
            {
                Open();
                return true;
            }
            GameManager.Instance.Say("찰칵... 열리지 않는다. 번호가 틀린 것 같다.");
            return false;
        }

        void Open()
        {
            opened = true;
            var gm = GameManager.Instance;
            if (!string.IsNullOrEmpty(rewardId)) gm.AddItem(rewardId, rewardName);
            else gm.Say(emptyMessage);
        }
    }
}
