export class MixAudio {
  private ctx: AudioContext | null = null
  private filter: BiquadFilterNode | null = null
  private gain: GainNode | null = null
  private blobGain: GainNode | null = null
  enabled = false
  private viscosity = 0.72

  setViscosity(t: number): void {
    this.viscosity = t
    if (this.filter) {
      this.filter.frequency.value = 420 - t * 280
    }
  }

  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on
    if (!on) {
      if (this.gain) this.gain.gain.value = 0
      return
    }
    await this.ensure()
  }

  private async ensure(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    this.ctx = ctx
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noise.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      last = last * 0.93 + white * 0.07
      data[i] = last
    }
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 420 - this.viscosity * 280
    filter.Q.value = 0.7

    const gain = ctx.createGain()
    gain.gain.value = 0

    const blobGain = ctx.createGain()
    blobGain.gain.value = 0

    src.connect(filter)
    filter.connect(gain)
    filter.connect(blobGain)
    gain.connect(ctx.destination)
    blobGain.connect(ctx.destination)
    src.start()

    this.filter = filter
    this.gain = gain
    this.blobGain = blobGain
    if (ctx.state === 'suspended') await ctx.resume()
  }

  stir(speed: number): void {
    if (!this.enabled || !this.gain || !this.ctx) return
    const t = this.ctx.currentTime
    const level = Math.min(0.12, speed * 0.35) * (0.55 + this.viscosity * 0.7)
    this.gain.gain.cancelScheduledValues(t)
    this.gain.gain.setTargetAtTime(level, t, 0.04)
    this.gain.gain.setTargetAtTime(0.0001, t + 0.12, 0.08)
  }

  blob(): void {
    if (!this.enabled || !this.blobGain || !this.ctx || !this.filter) return
    const t = this.ctx.currentTime
    this.filter.frequency.setTargetAtTime(180 - this.viscosity * 80, t, 0.01)
    this.filter.frequency.setTargetAtTime(420 - this.viscosity * 280, t + 0.18, 0.08)
    this.blobGain.gain.cancelScheduledValues(t)
    this.blobGain.gain.setValueAtTime(0.09, t)
    this.blobGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
  }
}
