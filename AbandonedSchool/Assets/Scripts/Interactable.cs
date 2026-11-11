using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>E 키로 상호작용할 수 있는 모든 오브젝트의 기반 클래스.</summary>
    public abstract class Interactable : MonoBehaviour
    {
        public string prompt = "조사하기";

        public virtual string GetPrompt() => prompt;

        public abstract void Interact(PlayerController player);
    }
}
