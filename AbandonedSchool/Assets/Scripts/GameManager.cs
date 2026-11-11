using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace AbandonedSchool
{
    public enum GameState { Playing, Reading, Keypad, GameOver, Won }

    /// <summary>게임 전체 상태, 인벤토리, 메시지를 관리한다.</summary>
    public class GameManager : MonoBehaviour
    {
        public static GameManager Instance { get; private set; }

        public PlayerController Player { get; set; }
        public Flashlight Flashlight { get; set; }
        public GhostAI Ghost { get; set; }

        public GameState State { get; private set; } = GameState.Playing;
        public int Batteries { get; private set; }
        public string Message { get; private set; } = "";
        public float MessageTimeLeft { get; private set; }
        public string NoteTitle { get; private set; } = "";
        public string NoteBody { get; private set; } = "";
        public LootContainer ActiveLock { get; private set; }
        public string EndReason { get; private set; } = "";
        public float ElapsedTime { get; private set; }
        public int UiOpenedFrame { get; private set; }

        public event Action<string> ItemAcquired;

        readonly Dictionary<string, string> items = new Dictionary<string, string>();

        public IEnumerable<string> ItemNames => items.Values;
        public bool IsPlaying => State == GameState.Playing;

        void Awake()
        {
            Instance = this;
            Time.timeScale = 1f;
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        void Update()
        {
            if (State == GameState.Playing) ElapsedTime += Time.deltaTime;
            if (MessageTimeLeft > 0f) MessageTimeLeft -= Time.deltaTime;

            bool freeCursor = State != GameState.Playing;
            Cursor.lockState = freeCursor ? CursorLockMode.None : CursorLockMode.Locked;
            Cursor.visible = freeCursor;

            if ((State == GameState.GameOver || State == GameState.Won) && Input.GetKeyDown(KeyCode.R))
            {
                SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
            }
        }

        public void Say(string message, float duration = 3.5f)
        {
            Message = message;
            MessageTimeLeft = duration;
        }

        public bool HasItem(string id) => items.ContainsKey(id);

        public void AddItem(string id, string displayName)
        {
            if (id == "battery")
            {
                Batteries++;
                Say("건전지를 주웠다. B 키로 손전등 건전지를 교체할 수 있다.");
            }
            else
            {
                items[id] = displayName;
                Say("획득: " + displayName);
            }
            ItemAcquired?.Invoke(id);
        }

        public bool ConsumeBattery()
        {
            if (Batteries <= 0) return false;
            Batteries--;
            return true;
        }

        public void OpenNote(string title, string body)
        {
            if (State != GameState.Playing) return;
            NoteTitle = title;
            NoteBody = body;
            State = GameState.Reading;
            UiOpenedFrame = Time.frameCount;
        }

        public void OpenKeypad(LootContainer container)
        {
            if (State != GameState.Playing) return;
            ActiveLock = container;
            State = GameState.Keypad;
            UiOpenedFrame = Time.frameCount;
        }

        public void CloseUi()
        {
            if (State != GameState.Reading && State != GameState.Keypad) return;
            State = GameState.Playing;
            ActiveLock = null;
        }

        public void GameOver(string reason)
        {
            if (State == GameState.GameOver || State == GameState.Won) return;
            State = GameState.GameOver;
            EndReason = reason;
            ActiveLock = null;
        }

        public void Win()
        {
            if (State == GameState.GameOver || State == GameState.Won) return;
            State = GameState.Won;
            ActiveLock = null;
        }
    }
}
