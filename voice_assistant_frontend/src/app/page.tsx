"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Settings } from "@/lib/api";
import { getHealth, getHistory, sendAudioForAssistant } from "@/lib/api";
import { usePressToTalkRecorder } from "@/hooks/usePressToTalkRecorder";

function isoNow(): string {
  return new Date().toISOString();
}

function newId(): string {
  // Good enough for UI-only identity.
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// PUBLIC_INTERFACE
export default function Home() {
  const [settings, setSettings] = useState<Settings>({
    language: "en",
    voice: "default",
    wakeWordEnabled: false,
  });

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: newId(),
      role: "assistant",
      content:
        "SYSTEM ONLINE. Hold the mic button to talk.\n\nTip: backend currently only exposes `/` health check; history/assist calls will show a friendly error until backend endpoints are implemented.",
      createdAt: isoNow(),
    },
  ]);

  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [statusText, setStatusText] = useState<string>("Idle.");
  const [busy, setBusy] = useState<boolean>(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const recorder = usePressToTalkRecorder();

  const waveBars = useMemo(() => {
    // Generate 16 bars; height scales with recorder.level
    const bars = Array.from({ length: 16 }, (_, i) => i);
    const base = recorder.status === "recording" ? 0.35 : 0.12;
    return bars.map((i) => {
      const jitter =
        recorder.status === "recording"
          ? Math.sin((Date.now() / 180) * (1 + i / 8)) * 0.12
          : 0;
      const v = Math.max(
        0,
        Math.min(1, base + recorder.level * 0.85 + jitter),
      );
      return v;
    });
  }, [recorder.level, recorder.status]);

  useEffect(() => {
    // Keep transcript scrolled to bottom when new messages arrive
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await getHealth();
        if (active) setBackendOk(true);
      } catch {
        if (active) setBackendOk(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Attempt to load history; backend may not have this endpoint yet.
    let active = true;
    (async () => {
      try {
        const hist = await getHistory();
        if (!active) return;
        if (hist && hist.length > 0) {
          setMessages(hist);
        }
      } catch {
        // Ignore; will be available once backend implements it.
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function handleStartTalking(): Promise<void> {
    setStatusText("Requesting microphone…");
    await recorder.start();
    if (recorder.error) setStatusText(recorder.error);
    else setStatusText("Recording… (release to send)");
  }

  async function handleStopTalking(): Promise<void> {
    setStatusText("Finalizing recording…");
    const blob = await recorder.stop();
    if (!blob) {
      setStatusText("Idle.");
      return;
    }

    setBusy(true);

    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      content: "(voice message)",
      createdAt: isoNow(),
    };
    setMessages((m) => [...m, userMsg]);

    try {
      setStatusText("Sending audio to assistant…");
      const resp = await sendAudioForAssistant({
        audio: blob,
        language: settings.language,
        voice: settings.voice,
      });

      // If backend returns transcript + reply, render them nicely.
      const transcript = resp.transcript?.trim();
      const replyText = resp.replyText?.trim();

      setMessages((m) => {
        const next = [...m];
        // Replace placeholder user content with transcript if available
        if (transcript) {
          const idx = next.findIndex((x) => x.id === userMsg.id);
          if (idx >= 0) next[idx] = { ...next[idx], content: transcript };
        }
        if (replyText) {
          next.push({
            id: newId(),
            role: "assistant",
            content: replyText,
            createdAt: isoNow(),
          });
        } else {
          next.push({
            id: newId(),
            role: "assistant",
            content:
              "No reply returned (backend endpoint may not be implemented yet).",
            createdAt: isoNow(),
          });
        }
        return next;
      });

      // If backend provides a URL for audio playback, attempt to play it.
      if (resp.ttsAudioUrl) {
        try {
          const audio = new Audio(resp.ttsAudioUrl);
          // Non-blocking play
          void audio.play();
        } catch {
          // ignore
        }
      }

      setStatusText("Idle.");
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          content:
            e instanceof Error
              ? `Backend error: ${e.message}`
              : "Backend error occurred.",
          createdAt: isoNow(),
        },
      ]);
      setStatusText("Idle (error).");
    } finally {
      setBusy(false);
    }
  }

  const connectionLabel =
    backendOk === null ? "Checking…" : backendOk ? "Connected" : "Offline";

  return (
    <main className="app">
      <div className="shell">
        <section className="panel" aria-label="Chat transcript">
          <header className="panelHeader">
            <div className="titleRow">
              <div>
                <div className="h1">RETRO VOICE ASSISTANT</div>
                <div className="subtle">
                  Press-and-hold to talk • STT → LLM → TTS
                </div>
              </div>

              <div className="pill" aria-label="Backend connection status">
                <span
                  className={[
                    "pillDot",
                    backendOk === null
                      ? ""
                      : backendOk
                        ? "good"
                        : "bad",
                  ].join(" ")}
                />
                <span className="subtle">{connectionLabel}</span>
              </div>
            </div>
          </header>

          <div className="chatBody" ref={scrollRef}>
            {messages.map((m) => (
              <div
                key={m.id}
                className={["bubbleRow", m.role].join(" ")}
                aria-label={m.role === "user" ? "User message" : "Assistant message"}
              >
                <article className={["bubble", m.role].join(" ")}>
                  <div className="mono">{m.content}</div>
                  <div className="bubbleMeta">{formatTime(m.createdAt)}</div>
                </article>
              </div>
            ))}
          </div>
        </section>

        <aside className="panel" aria-label="Settings">
          <header className="panelHeader">
            <div className="titleRow">
              <div>
                <div className="h1">SETTINGS</div>
                <div className="subtle">Personalize language / voice.</div>
              </div>
              <button
                type="button"
                className="smallBtn"
                onClick={() => {
                  setMessages((m) => [
                    ...m,
                    {
                      id: newId(),
                      role: "assistant",
                      content:
                        "History persistence will appear here once backend exposes /history + persistence.",
                      createdAt: isoNow(),
                    },
                  ]);
                }}
              >
                Log
              </button>
            </div>
          </header>

          <div className="settingsBody">
            <div className="field">
              <div className="labelRow">
                <label className="label" htmlFor="language">
                  Language
                </label>
                <span className="subtle">STT locale</span>
              </div>
              <select
                id="language"
                className="select"
                value={settings.language}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, language: e.target.value }))
                }
              >
                <option value="en">English (en)</option>
                <option value="es">Español (es)</option>
                <option value="fr">Français (fr)</option>
                <option value="de">Deutsch (de)</option>
                <option value="hi">Hindi (hi)</option>
                <option value="ja">日本語 (ja)</option>
              </select>
              <div className="help">
                Choose the spoken language you’ll use when you talk.
              </div>
            </div>

            <div className="field">
              <div className="labelRow">
                <label className="label" htmlFor="voice">
                  Voice
                </label>
                <span className="subtle">TTS preset</span>
              </div>
              <select
                id="voice"
                className="select"
                value={settings.voice}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, voice: e.target.value }))
                }
              >
                <option value="default">Default</option>
                <option value="retro">Retro</option>
                <option value="calm">Calm</option>
                <option value="bright">Bright</option>
              </select>
              <div className="help">
                Voice options will map to backend provider voices later.
              </div>
            </div>

            <div className="toggleRow" role="group" aria-label="Wake word toggle">
              <div>
                <div className="label">Wake word</div>
                <div className="help">
                  Optional. (UI toggle only; backend not implemented yet.)
                </div>
              </div>
              <button
                type="button"
                className={["toggleBtn", settings.wakeWordEnabled ? "on" : ""].join(
                  " ",
                )}
                aria-pressed={settings.wakeWordEnabled}
                onClick={() =>
                  setSettings((s) => ({
                    ...s,
                    wakeWordEnabled: !s.wakeWordEnabled,
                  }))
                }
              >
                <span className="srOnly">
                  {settings.wakeWordEnabled ? "Disable" : "Enable"} wake word
                </span>
              </button>
            </div>

            <div className="field">
              <div className="labelRow">
                <span className="label">Status</span>
                <span className="subtle">
                  {busy ? "Working…" : recorder.status}
                </span>
              </div>
              <div className="help">
                {recorder.hasPermission === false
                  ? "Microphone permission denied. Check browser permissions."
                  : recorder.error
                    ? recorder.error
                    : statusText}
              </div>
            </div>

            <div className="help">
              Backend base URL:{" "}
              <code>{process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"}</code>
            </div>
          </div>
        </aside>
      </div>

      <div className="bottomBar" aria-label="Press-to-talk controls">
        <div className="bottomInner">
          <div className="wave" aria-hidden="true">
            {waveBars.map((v, i) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                className={["waveDot", recorder.status === "recording" ? "on" : ""].join(
                  " ",
                )}
                style={{
                  height: `${Math.round(10 + v * 18)}px`,
                  opacity: recorder.status === "recording" ? 0.9 : 0.55,
                }}
              />
            ))}
          </div>

          <button
            type="button"
            className={[
              "micBtn",
              recorder.status === "recording" ? "recording" : "",
            ].join(" ")}
            disabled={busy}
            onMouseDown={() => void handleStartTalking()}
            onMouseUp={() => void handleStopTalking()}
            onMouseLeave={() => {
              // If user drags out while holding, we still stop recording.
              if (recorder.status === "recording") void handleStopTalking();
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              void handleStartTalking();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              void handleStopTalking();
            }}
            aria-label={
              recorder.status === "recording"
                ? "Recording. Release to send."
                : "Hold to talk"
            }
            title={
              recorder.status === "recording"
                ? "Release to send"
                : "Hold to talk"
            }
          >
            <span className="micGlyph" />
          </button>

          <button
            type="button"
            className="smallBtn"
            onClick={() => {
              setMessages((m) => [
                ...m,
                {
                  id: newId(),
                  role: "assistant",
                  content:
                    "Tip: If you're testing locally, set NEXT_PUBLIC_BACKEND_URL=http://localhost:3001",
                  createdAt: isoNow(),
                },
              ]);
            }}
          >
            Help
          </button>
        </div>
      </div>
    </main>
  );
}
