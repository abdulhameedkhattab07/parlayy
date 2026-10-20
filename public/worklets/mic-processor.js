class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(1920);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0];
      for (let i = 0; i < channel.length; i += 1) {
        this._buffer[this._offset] = channel[i];
        this._offset += 1;
        if (this._offset === this._buffer.length) {
          this.port.postMessage(this._buffer.slice(0));
          this._offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);
