"use client";

export interface MicHandle {
  stop: () => void;
  sampleRate: number;
}

/**
 * Captures microphone audio as 24kHz mono Float32 frames and forwards them to
 * `onSamples`. Uses an AudioWorklet where available and falls back to a
 * ScriptProcessorNode. Also reports a rough input level for the UI meter.
 */
export async function startMicrophone(
  onSamples: (samples: Float32Array) => void,
  onLevel?: (level: number) => void,
): Promise<MicHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;

  let ctx: AudioContext;
  try {
    ctx = new Ctor({ sampleRate: 24000 });
  } catch {
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  if (onLevel) {
    const meter = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = Math.abs(data[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      onLevel(peak);
      raf = requestAnimationFrame(meter);
    };
    raf = requestAnimationFrame(meter);
  }

  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);

  let worklet: AudioWorkletNode | null = null;
  let script: ScriptProcessorNode | null = null;

  if (ctx.audioWorklet) {
    await ctx.audioWorklet.addModule("/worklets/mic-processor.js");
    worklet = new AudioWorkletNode(ctx, "mic-processor");
    worklet.port.onmessage = (event) => {
      onSamples(event.data as Float32Array);
    };
    source.connect(worklet);
    worklet.connect(mute);
  } else {
    script = ctx.createScriptProcessor(4096, 1, 1);
    script.onaudioprocess = (event) => {
      onSamples(event.inputBuffer.getChannelData(0).slice());
    };
    source.connect(script);
    script.connect(mute);
  }

  return {
    sampleRate: ctx.sampleRate,
    stop() {
      cancelAnimationFrame(raf);
      if (worklet) {
        worklet.port.onmessage = null;
        worklet.disconnect();
      }
      if (script) {
        script.onaudioprocess = null;
        script.disconnect();
      }
      source.disconnect();
      analyser.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close().catch(() => {});
      onLevel?.(0);
    },
  };
}
