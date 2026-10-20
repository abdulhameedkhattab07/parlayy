"use client";

const TTS_SAMPLE_RATE = 48000;

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function float32ToBase64Pcm16(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Shared, lazily-created AudioContext for playback. */
let playbackCtx: AudioContext | null = null;
function getPlaybackContext(): AudioContext {
  if (!playbackCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    playbackCtx = new Ctor({ sampleRate: TTS_SAMPLE_RATE });
  }
  return playbackCtx;
}

/**
 * Queues 68ms-ish PCM16 chunks and plays them back-to-back, reporting when the
 * queue has fully drained.
 */
export class SpeechPlayer {
  private ctx: AudioContext;
  private nextStart = 0;
  private sources: AudioBufferSourceNode[] = [];
  private analyser: AnalyserNode;
  private data: Uint8Array<ArrayBuffer>;
  private stopped = false;
  onLevel?: (level: number) => void;
  private levelRaf: number | null = null;

  constructor() {
    this.ctx = getPlaybackContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.ctx.destination);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
  }

  get sampleRate(): number {
    return TTS_SAMPLE_RATE;
  }

  async resume() {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  enqueue(bytes: Uint8Array) {
    if (this.stopped || bytes.byteLength < 2) return;
    const sampleCount = Math.floor(bytes.byteLength / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
    const buffer = this.ctx.createBuffer(1, sampleCount, TTS_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      channel[i] = view.getInt16(i * 2, true) / 0x8000;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    const startAt = Math.max(this.ctx.currentTime + 0.03, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
    this.sources.push(source);
    source.onended = () => {
      this.sources = this.sources.filter((s) => s !== source);
    };
  }

  private startMeter() {
    if (this.levelRaf !== null || !this.onLevel) return;
    const tick = () => {
      this.analyser.getByteTimeDomainData(this.data);
      let peak = 0;
      for (let i = 0; i < this.data.length; i += 1) {
        const v = Math.abs(this.data[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      this.onLevel?.(peak);
      this.levelRaf = requestAnimationFrame(tick);
    };
    this.levelRaf = requestAnimationFrame(tick);
  }

  private stopMeter() {
    if (this.levelRaf !== null) {
      cancelAnimationFrame(this.levelRaf);
      this.levelRaf = null;
    }
    this.onLevel?.(0);
  }

  /** Resolves once every queued chunk has finished playing. */
  waitUntilDone(): Promise<void> {
    this.startMeter();
    return new Promise((resolve) => {
      const check = () => {
        if (this.stopped) {
          this.stopMeter();
          resolve();
          return;
        }
        if (this.sources.length === 0 && this.ctx.currentTime >= this.nextStart) {
          this.stopMeter();
          resolve();
          return;
        }
        window.setTimeout(check, 60);
      };
      check();
    });
  }

  stop() {
    this.stopped = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.sources = [];
    this.nextStart = this.ctx.currentTime;
    this.stopMeter();
  }
}

async function fetchToken(attempts = 3): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch("/api/gradium/token", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { token?: string; error?: string }
        | null;
      if (res.ok && data?.token) return data.token;
      lastError = new Error(
        data?.error ?? `Voice token request failed (${res.status}).`,
      );
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, 400 * (attempt + 1)),
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not start a voice session.");
}

export interface SttHandlers {
  onReady?: (delayInFrames?: number) => void;
  onText: (text: string) => void;
  onInactivity: (probability: number, horizonS: number) => void;
  onFlushed?: () => void;
  onError: (message: string) => void;
  onClose?: () => void;
}

export interface SttSession {
  sendAudio: (samples: Float32Array) => void;
  flush: (id: number) => void;
  close: () => void;
}

export async function openSttSession(
  handlers: SttHandlers,
  opts: { language?: string; delayInFrames?: number; sampleRate?: number } = {},
): Promise<SttSession> {
  const token = await fetchToken();
  const url = new URL("wss://api.gradium.ai/api/speech/asr");
  url.searchParams.set("token", token);
  const ws = new WebSocket(url);
  const inputFormat =
    opts.sampleRate === undefined || opts.sampleRate === 24000
      ? "pcm"
      : `pcm_${opts.sampleRate}`;

  let closed = false;
  const queue: Float32Array[] = [];

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Voice transcription timed out connecting."));
    }, 12_000);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "setup",
          model_name: "default",
          input_format: inputFormat,
          json_config: {
            language: opts.language ?? "en",
            delay_in_frames: opts.delayInFrames ?? 16,
          },
        }),
      );
    };

    ws.onmessage = (event) => {
      let msg: {
        type?: string;
        text?: string;
        message?: string;
        code?: number;
        delay_in_frames?: number;
        vad?: { horizon_s?: number; inactivity_prob?: number }[];
      };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case "ready": {
          window.clearTimeout(timeout);
          handlers.onReady?.(msg.delay_in_frames);
          resolve();
          for (const chunk of queue.splice(0)) {
            ws.send(
              JSON.stringify({
                type: "audio",
                audio: float32ToBase64Pcm16(chunk),
              }),
            );
          }
          break;
        }
        case "text":
          if (msg.text) handlers.onText(msg.text);
          break;
        case "step": {
          const vad = msg.vad ?? [];
          let probability = 0;
          let horizonS = 0;
          for (const h of vad) {
            const horizon = h.horizon_s ?? 0;
            if (horizon >= horizonS) {
              horizonS = horizon;
              probability = h.inactivity_prob ?? 0;
            }
          }
          handlers.onInactivity(probability, horizonS);
          break;
        }
        case "flushed":
          handlers.onFlushed?.();
          break;
        case "error":
          window.clearTimeout(timeout);
          handlers.onError(msg.message ?? "Transcription error.");
          reject(new Error(msg.message ?? "Transcription error."));
          break;
        default:
          break;
      }
    };

    ws.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Could not reach the voice service."));
    };

    ws.onclose = () => {
      window.clearTimeout(timeout);
      closed = true;
      handlers.onClose?.();
    };
  });

  await readyPromise;

  return {
    sendAudio(samples: Float32Array) {
      if (closed) return;
      if (ws.readyState !== WebSocket.OPEN) {
        queue.push(samples);
        return;
      }
      ws.send(
        JSON.stringify({ type: "audio", audio: float32ToBase64Pcm16(samples) }),
      );
    },
    flush(id: number) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "flush", flush_id: id }));
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "end_of_stream" }));
        }
      } catch {
        // ignore
      }
      window.setTimeout(() => ws.close(), 150);
    },
  };
}

export interface SpeakHandle {
  stop: () => void;
  done: Promise<void>;
}

/**
 * Streams text to Gradium TTS and plays the resulting audio. Resolves when all
 * audio has finished playing.
 */
export async function speak(
  text: string,
  voiceId: string,
  player: SpeechPlayer,
): Promise<SpeakHandle> {
  const token = await fetchToken();
  const url = new URL("wss://api.gradium.ai/api/speech/tts");
  url.searchParams.set("token", token);
  const ws = new WebSocket(url);

  let settled = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const finish = async () => {
    if (settled) return;
    settled = true;
    await player.waitUntilDone();
    resolveDone();
  };

  const pending: Uint8Array[] = [];
  let bufferedSamples = 0;
  let started = false;
  const startPlayback = () => {
    started = true;
    for (const chunk of pending.splice(0)) player.enqueue(chunk);
    bufferedSamples = 0;
  };

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Voice synthesis timed out connecting."));
    }, 12_000);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "setup",
          model_name: "default",
          voice_id: voiceId,
          output_format: "pcm",
        }),
      );
    };

    ws.onmessage = (event) => {
      let msg: { type?: string; audio?: string; message?: string };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (msg.type === "ready") {
        window.clearTimeout(timeout);
        resolve();
        ws.send(JSON.stringify({ type: "text", text }));
        ws.send(JSON.stringify({ type: "end_of_stream" }));
      } else if (msg.type === "audio" && msg.audio) {
        const bytes = base64ToBytes(msg.audio);
        if (started) {
          player.enqueue(bytes);
        } else {
          pending.push(bytes);
          bufferedSamples += Math.floor(bytes.byteLength / 2);
          if (bufferedSamples >= TTS_SAMPLE_RATE * 0.28) startPlayback();
        }
      } else if (msg.type === "end_of_stream") {
        if (!started) startPlayback();
        void finish();
        window.setTimeout(() => ws.close(), 50);
      } else if (msg.type === "error") {
        window.clearTimeout(timeout);
        reject(new Error(msg.message ?? "Voice synthesis error."));
      }
    };

    ws.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Could not reach the voice service."));
    };

    ws.onclose = () => {
      window.clearTimeout(timeout);
      void finish();
    };
  });

  return {
    stop() {
      player.stop();
      settled = true;
      resolveDone();
      try {
        ws.close();
      } catch {
        // ignore
      }
    },
    done,
  };
}
