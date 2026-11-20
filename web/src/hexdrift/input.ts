// Controls: keyboard, gamepad and on-screen touch buttons all feed one state.
import type { Input } from "./sim/race.ts";

export type Action = "left" | "right" | "gas" | "brake" | "drift" | "respawn";
export type Command = "restart" | "camera" | "pause";

const KEYS: Record<string, Action | Command> = {
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  ArrowUp: "gas", KeyW: "gas",
  ArrowDown: "brake", KeyS: "brake",
  Space: "drift", ShiftLeft: "drift", ShiftRight: "drift",
  Enter: "respawn", KeyE: "respawn", Backspace: "respawn",
  KeyR: "restart", KeyC: "camera", Escape: "pause", KeyP: "pause",
};

export class Controls {
  private held = new Set<Action>();
  private touch = new Set<Action>();
  private pad: Input = { steer: 0, gas: false, brake: false, drift: false, respawn: false };
  private padPrev: boolean[] = [];
  private off: (() => void)[] = [];
  /** Analog steering from touch tilt-free slider, -1..1 (null = buttons). */
  constructor(private onCommand: (c: Command) => void) {
    const down = (e: KeyboardEvent) => {
      const a = KEYS[e.code];
      if (!a) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (a === "restart" || a === "camera" || a === "pause") { if (!e.repeat) onCommand(a); return; }
      this.held.add(a);
    };
    const up = (e: KeyboardEvent) => { const a = KEYS[e.code]; if (a) this.held.delete(a as Action); };
    const blur = () => { this.held.clear(); this.touch.clear(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    this.off.push(() => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); });
  }

  setTouch(a: Action, on: boolean) { if (on) this.touch.add(a); else this.touch.delete(a); }

  /** Polls gamepads (call once per frame). */
  pollPad() {
    const pads = navigator.getGamepads?.() ?? [];
    let gp: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { this.pad = { steer: 0, gas: false, brake: false, drift: false, respawn: false }; return; }
    const b = (i: number) => (gp!.buttons[i]?.value ?? 0) > 0.3;
    let sx = gp.axes[0] ?? 0;
    if (Math.abs(sx) < 0.15) sx = 0;
    if (b(14)) sx = -1;
    if (b(15)) sx = 1;
    this.pad = { steer: sx, gas: b(7) || b(0) || b(12), brake: b(6) || b(13), drift: b(1) || b(5) || b(4), respawn: b(3) };
    const pressed = (i: number) => b(i) && !this.padPrev[i];
    if (pressed(8)) this.onCommand("restart");
    if (pressed(9)) this.onCommand("pause");
    if (pressed(2)) this.onCommand("camera");
    this.padPrev = gp.buttons.map((x) => x.value > 0.3);
  }

  read(): Input {
    const h = (a: Action) => this.held.has(a) || this.touch.has(a);
    let steer = (h("right") ? 1 : 0) - (h("left") ? 1 : 0);
    if (this.pad.steer !== 0) steer = this.pad.steer;
    return {
      steer,
      gas: h("gas") || this.pad.gas,
      brake: h("brake") || this.pad.brake,
      drift: h("drift") || this.pad.drift,
      respawn: h("respawn") || this.pad.respawn,
    };
  }

  /** True while anything is held (used to start the race timer feel). */
  any() { return this.held.size > 0 || this.touch.size > 0; }

  dispose() { for (const f of this.off) f(); }
}
