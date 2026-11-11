using UnityEngine;

namespace AbandonedSchool
{
    /// <summary>읽을 수 있는 쪽지. 단서를 전달한다.</summary>
    public class NoteItem : Interactable
    {
        public string title = "쪽지";
        [TextArea(3, 10)] public string body = "";

        public override string GetPrompt() => "읽기: " + title;

        public override void Interact(PlayerController player)
        {
            GameManager.Instance.OpenNote(title, body);
        }
    }
}
