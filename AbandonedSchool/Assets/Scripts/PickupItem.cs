using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>바닥/책상 위에서 주울 수 있는 아이템 (손전등, 건전지 등).</summary>
    public class PickupItem : Interactable
    {
        public string itemId = "item";
        public string displayName = "아이템";

        public override string GetPrompt() => "줍기: " + displayName;

        public override void Interact(PlayerController player)
        {
            GameManager.Instance.AddItem(itemId, displayName);
            Destroy(gameObject);
        }
    }
}
