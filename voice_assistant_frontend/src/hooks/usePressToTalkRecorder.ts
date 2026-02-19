"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RecorderStatus = "idle" | "recording" | "stopping" | "error";

type UsePressToTalkRecorderOptions = {
  mimeType?: string;
  timesliceMs?: number;
};

type UsePressToTalkRecorderReturn = {
  status: RecorderStatus;
  error: string | null;
  hasPermission: boolean | null;

  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;

  // UI helpers
  level: number; // 0..1 approximate volume
  streamActive: boolean;
};

/**
 * PUBLIC_INTERFACE
 * Press-to-talk recorder hook that captures mic audio using MediaRecorder and provides
 * a simple "level" meter for waveform/recording indicator.
 */
export function usePressToTalkRecorder(
  options?: UsePressToTalkRecorderOptions,
): UsePressToTalkRecorderReturn {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [level, setLevel] = useState<number>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const streamActive = useMemo(() => {
    return Boolean(streamRef.current && streamRef.current.active);
  }, [status]);

  const cleanupAnalyser = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    analyserRef.current = null;

    if (audioContextRef.current) {
      // Close to release audio hardware resources
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    setLevel(0);
  }, []);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
    }
    streamRef.current = null;
  }, []);

  const startLevelMeter = useCallback((stream: MediaStream) => {
    try {
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);

      const loop = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);

        // Compute simple RMS
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        setLevel(Math.max(0, Math.min(1, rms * 2.5)));

        rafIdRef.current = requestAnimationFrame(loop);
      };

      rafIdRef.current = requestAnimationFrame(loop);
    } catch {
      // Level meter is optional; ignore if AudioContext fails.
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);

    if (status === "recording" || status === "stopping") return;

    try {
      setStatus("idle");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setHasPermission(true);
      streamRef.current = stream;

      startLevelMeter(stream);

      const mimeType =
        options?.mimeType ||
        (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm");

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onerror = () => {
        setStatus("error");
        setError("Recording error occurred.");
      };

      recorder.start(options?.timesliceMs);
      setStatus("recording");
    } catch (e) {
      setHasPermission(false);
      setStatus("error");
      setError(
        e instanceof Error ? e.message : "Microphone permission denied.",
      );
      cleanupAnalyser();
      cleanupStream();
    }
  }, [cleanupAnalyser, cleanupStream, options?.mimeType, options?.timesliceMs, startLevelMeter, status]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    if (status !== "recording") return null;

    setStatus("stopping");

    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      setStatus("idle");
      cleanupAnalyser();
      cleanupStream();
      return null;
    }

    const blob: Blob = await new Promise((resolve) => {
      const finalize = () => {
        const mime = recorder.mimeType || "audio/webm";
        const out = new Blob(chunksRef.current, { type: mime });
        resolve(out);
      };

      recorder.onstop = finalize;

      try {
        recorder.stop();
      } catch {
        finalize();
      }
    });

    mediaRecorderRef.current = null;
    chunksRef.current = [];

    cleanupAnalyser();
    cleanupStream();
    setStatus("idle");

    return blob;
  }, [cleanupAnalyser, cleanupStream, status]);

  useEffect(() => {
    return () => {
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      cleanupAnalyser();
      cleanupStream();
    };
  }, [cleanupAnalyser, cleanupStream]);

  return {
    status,
    error,
    hasPermission,
    start,
    stop,
    level,
    streamActive,
  };
}
