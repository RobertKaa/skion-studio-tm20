type ScheduleFrame = (callback: FrameRequestCallback) => number;

/** Coalesce changes into one frame, then sleep when camera/scene are stationary. */
export class DemandRenderLoop {
  private pending: number | undefined;
  private active = true;
  private disposed = false;
  private readonly render: (time: number) => boolean;
  private readonly schedule: ScheduleFrame;
  private readonly cancel: (id: number) => void;

  constructor(
    render: (time: number) => boolean,
    schedule: ScheduleFrame = callback => requestAnimationFrame(callback),
    cancel: (id: number) => void = id => cancelAnimationFrame(id),
  ) { this.render = render; this.schedule = schedule; this.cancel = cancel; }

  invalidate() {
    if (this.disposed || !this.active || this.pending !== undefined) return;
    this.pending = this.schedule(time => {
      this.pending = undefined;
      if (this.disposed || !this.active) return;
      if (this.render(time)) this.invalidate();
    });
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (this.pending !== undefined) { this.cancel(this.pending); this.pending = undefined; }
    if (active) this.invalidate();
  }

  dispose() {
    this.disposed = true;
    if (this.pending !== undefined) this.cancel(this.pending);
    this.pending = undefined;
  }
}
