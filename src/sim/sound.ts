/**
 * The heli's sound, made in the browser with Web Audio: the blades' chop (air noise beating at the blade passing
 * rate, two blades a turn, a low buzz under it), and the motor's whine. All follow the head speed; the chop and the
 * rush of air grow with the load, the whine stops with the motor, and the whole fades with distance.
 */
export class RotorSound {
  private context: AudioContext | null = null;
  private nodes: {
    master: GainNode;
    buzz: OscillatorNode;
    buzzGain: GainNode;
    beat: OscillatorNode;
    beatDepth: GainNode;
    rush: BiquadFilterNode;
    rushGain: GainNode;
    whine: OscillatorNode;
    whineGain: GainNode;
  } | null = null;

  /** Starts the sound, or wakes it: browsers let a page start sound only on a click or a key. */
  start() {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    // The rush of air: white noise, its loudness beating at the blade passing rate (the chop).
    const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const rush = context.createBiquadFilter();
    rush.type = 'bandpass';
    rush.Q.value = 0.8;
    const rushGain = context.createGain();
    rushGain.gain.value = 0;
    source.connect(rush).connect(rushGain).connect(master);
    const beat = context.createOscillator();
    const beatDepth = context.createGain();
    beatDepth.gain.value = 0;
    beat.connect(beatDepth).connect(rushGain.gain);

    // A low buzz at the blade passing rate, softened.
    const buzz = context.createOscillator();
    buzz.type = 'sawtooth';
    const soften = context.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 500;
    const buzzGain = context.createGain();
    buzzGain.gain.value = 0;
    buzz.connect(soften).connect(buzzGain).connect(master);

    // The motor's whine, high and quiet.
    const whine = context.createOscillator();
    whine.type = 'triangle';
    const whineGain = context.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain).connect(master);

    for (const started of [source, beat, buzz, whine]) started.start();
    this.context = context;
    this.nodes = {master, buzz, buzzGain, beat, beatDepth, rush, rushGain, whine, whineGain};
  }

  /** Follows the heli: its head speed against the hover's, its load (thrust over weight), its motor, its distance (m). */
  update(rpm: number, hoverRpm: number, load: number, motor: boolean, distance: number, on: boolean) {
    const {context, nodes} = this;
    if (!context || !nodes) return;
    const now = context.currentTime;
    const speed = Math.min(1.3, rpm / hoverRpm);
    const passing = Math.max(0.5, (rpm / 60) * 2);
    const near = Math.max(0.12, Math.min(1, 4 / Math.max(1, distance)));
    const lift = Math.min(2, Math.abs(load));
    const set = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, 0.04);
    set(nodes.master.gain, on ? 0.55 : 0);
    set(nodes.beat.frequency, passing);
    set(nodes.buzz.frequency, passing);
    set(nodes.rush.frequency, 250 + 900 * speed);
    const rush = speed * speed * (0.25 + 0.45 * lift) * near;
    set(nodes.rushGain.gain, rush * 0.6);
    set(nodes.beatDepth.gain, rush * 0.5);
    set(nodes.buzzGain.gain, speed * speed * (0.04 + 0.05 * lift) * near);
    set(nodes.whine.frequency, passing * 9);
    set(nodes.whineGain.gain, motor ? 0.025 * speed * near : 0);
  }

  close() {
    void this.context?.close();
    this.context = null;
    this.nodes = null;
  }
}
