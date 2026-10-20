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
  private bufferSampleRate = TTS_SAMPLE_RATE;
  private generation = 0;
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
    return this.bufferSampleRate;
  }

  setSampleRate(rate: number) {
    if (Number.isFinite(rate) && rate >= 8000 && rate <= 192000) {
      this.bufferSampleRate = rate;
    }
  }

  async resume() {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  enqueue(bytes: Uint8Array) {
    if (bytes.byteLength < 2) return;
    const sampleCount = Math.floor(bytes.byteLength / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
    const buffer = this.ctx.createBuffer(
      1,
      sampleCount,
      this.bufferSampleRate,
    );
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      channel[i] = view.getInt16(i * 2, true) / 0x8000;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    const startAt = Math.max(this.ctx.currentTime + 0.08, this.nextStart);
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
    const generation = this.generation;
    this.startMeter();
    return new Promise((resolve) => {
      const check = () => {
        if (generation !== this.generation) {
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
    this.generation += 1;
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

export type GradiumRegion = "eu" | "us";

export interface GradiumToken {
  token: string;
  region: GradiumRegion;
  expiresAt: string | null;
  expiresInMs: number | null;
}

const MIN_CLIENT_TOKEN_MS = 750;

async function fetchToken(attempts = 3): Promise<GradiumToken> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch("/api/gradium/token", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | {
            token?: string;
            region?: string;
            expires_at?: string | null;
            expires_in_ms?: number | null;
            error?: string;
          }
        | null;

      if (res.ok && data?.token) {
        const region: GradiumRegion =
          data.region === "eu" || data.region === "us" ? data.region : "us";
        const parsed = data.expires_at ? Date.parse(data.expires_at) : Number.NaN;
        const expiresInMs = Number.isFinite(parsed)
          ? parsed - Date.now()
          : typeof data.expires_in_ms === "number"
            ? data.expires_in_ms
            : null;

        if (expiresInMs !== null && expiresInMs <= 0) {
          lastError = new Error("The voice token expired before use.");
        } else if (
          expiresInMs !== null &&
          expiresInMs < MIN_CLIENT_TOKEN_MS &&
          attempt < attempts - 1
        ) {
          lastError = new Error("The voice token was too close to expiry.");
        } else {
          return {
            token: data.token,
            region,
            expiresAt: data.expires_at ?? null,
            expiresInMs,
          };
        }
      } else {
        lastError = new Error(
          data?.error ?? `Voice token request failed (${res.status}).`,
        );
      }
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
  const { token, region } = await fetchToken();
  const url = new URL(`wss://${region}.api.gradium.ai/api/speech/asr`);
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
 * Streams text to Gradium TTS and plays the audio as chunks arrive. A short
 * prebuffer absorbs network jitter, and a byte carry keeps sample boundaries
 * aligned when the server splits a PCM frame across messages.
 */
async function speakOnce(
  text: string,
  voiceId: string,
  player: SpeechPlayer,
  tokenInfo: GradiumToken,
): Promise<SpeakHandle> {
  const url = new URL(
    `wss://${tokenInfo.region}.api.gradium.ai/api/speech/tts`,
  );
  url.searchParams.set("token", tokenInfo.token);
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

  const PREBUFFER_SECONDS = 0.35;
  const empty = new Uint8Array(0);
  const pending: Uint8Array[] = [];
  let pendingSamples = 0;
  let started = false;
  let carry = empty;
  let totalSamples = 0;
  let completed = false;
  let sampleRate = TTS_SAMPLE_RATE;

  const startPlayback = () => {
    started = true;
    for (const chunk of pending.splice(0)) player.enqueue(chunk);
    pendingSamples = 0;
  };

  const enqueueBytes = (bytes: Uint8Array) => {
    const samples = Math.floor(bytes.byteLength / 2);
    if (samples < 1) return;
    totalSamples += samples;
    if (started) {
      player.enqueue(bytes);
      return;
    }
    pending.push(bytes);
    pendingSamples += samples;
    if (pendingSamples >= sampleRate * PREBUFFER_SECONDS) startPlayback();
  };

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Voice synthesis timed out."));
      window.setTimeout(() => ws.close(), 50);
    }, 20_000);
    let settledReady = false;
    const settleReady = () => {
      if (settledReady) return;
      settledReady = true;
      window.clearTimeout(timeout);
      resolve();
    };

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
      let msg: {
        type?: string;
        audio?: string;
        message?: string;
        code?: number;
        sample_rate?: number;
      };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (msg.type === "ready") {
        if (msg.sample_rate) {
          sampleRate = msg.sample_rate;
          player.setSampleRate(sampleRate);
        }
        ws.send(JSON.stringify({ type: "text", text }));
        ws.send(JSON.stringify({ type: "end_of_stream" }));
      } else if (msg.type === "audio" && msg.audio) {
        const bytes = base64ToBytes(msg.audio);
        let merged = bytes;
        if (carry.byteLength > 0) {
          merged = new Uint8Array(carry.byteLength + bytes.byteLength);
          merged.set(carry);
          merged.set(bytes, carry.byteLength);
        }
        const usable = merged.byteLength - (merged.byteLength % 2);
        if (usable > 0) enqueueBytes(merged.subarray(0, usable));
        carry = usable < merged.byteLength ? merged.slice(usable) : empty;
        if (started) settleReady();
      } else if (msg.type === "end_of_stream") {
        completed = true;
        window.clearTimeout(timeout);
        if (carry.byteLength >= 2) {
          enqueueBytes(carry);
          carry = empty;
        }
        if (totalSamples === 0) {
          reject(new Error("Voice synthesis returned no audio."));
          window.setTimeout(() => ws.close(), 50);
          return;
        }
        if (!started) startPlayback();
        settleReady();
        void finish();
        window.setTimeout(() => ws.close(), 50);
      } else if (msg.type === "error") {
        window.clearTimeout(timeout);
        const detail = msg.message ?? "Voice synthesis error.";
        reject(new Error(msg.code ? `${detail} (code ${msg.code})` : detail));
        window.setTimeout(() => ws.close(), 50);
      }
    };

    ws.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Could not reach the voice service."));
    };

    ws.onclose = (event) => {
      window.clearTimeout(timeout);
      if (!completed && !started) {
        const detail = event.reason ? `: ${event.reason}` : "";
        reject(
          new Error(
            `Voice synthesis connection closed before audio began (${event.code}${detail}).`,
          ),
        );
        return;
      }
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

function isTokenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("token") &&
    (message.includes("invalid") ||
      message.includes("expired") ||
      message.includes("expiry"))
  );
}

/**
 * Mints a fresh token immediately before opening the TTS socket. Tokens expire
 * in a few seconds, so they must not be prefetched across the LLM request.
 */
export async function speak(
  text: string,
  voiceId: string,
  player: SpeechPlayer,
): Promise<SpeakHandle> {
  const first = await fetchToken();
  try {
    return await speakOnce(text, voiceId, player, first);
  } catch (err) {
    if (!isTokenError(err)) throw err;
    const fresh = await fetchToken();
    return speakOnce(text, voiceId, player, fresh);
  }
}
