/* input.js — キーボード（2人分）+ ゲームパッド入力
   1台目のパッド=1P / 2台目=2P。メニュー操作はどの入力からでも可能 */
(function (root) {
  "use strict";

  const KEYMAPS = [
    { // 1P
      left: ["KeyA"], right: ["KeyD"], soft: ["KeyS"], hard: ["KeyW"],
      rotCW: ["KeyG"], rotCCW: ["KeyF"], hold: ["ShiftLeft", "KeyQ"],
    },
    { // 2P
      left: ["ArrowLeft"], right: ["ArrowRight"], soft: ["ArrowDown"], hard: ["ArrowUp"],
      rotCW: ["KeyK", "Enter"], rotCCW: ["KeyL"], hold: ["ShiftRight", "KeyO"],
    },
  ];

  // 標準ゲームパッド配置
  const PAD = {
    rotCW: [0, 1],   // A, B
    rotCCW: [2, 3],  // X, Y
    hold: [4, 5],    // L, R
    pause: [9],      // START
    up: 12, down: 13, left: 14, right: 15,
  };
  const AXIS_TH = 0.5;

  const Input = {
    keys: new Set(),
    keyEdges: new Set(),
    padOrder: [],          // 接続順の gamepad index
    padPrev: {},           // index -> 前フレームのボタン押下配列
    padEdges: {},          // index -> 今フレームに押された button index の Set
    padAxisPrev: {},       // index -> {x, y}
    padAxisEdges: {},      // index -> {up,down,left,right} 軸の入り端
    pads: {},              // index -> Gamepad

    init() {
      root.addEventListener("keydown", (e) => {
        if (e.repeat) return this.preventGameKeys(e);
        this.keys.add(e.code);
        this.keyEdges.add(e.code);
        this.preventGameKeys(e);
      });
      root.addEventListener("keyup", (e) => this.keys.delete(e.code));
      root.addEventListener("blur", () => this.keys.clear());
      root.addEventListener("gamepadconnected", (e) => {
        if (!this.padOrder.includes(e.gamepad.index)) this.padOrder.push(e.gamepad.index);
      });
      root.addEventListener("gamepaddisconnected", (e) => {
        this.padOrder = this.padOrder.filter((i) => i !== e.gamepad.index);
      });
    },

    preventGameKeys(e) {
      const block = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"];
      if (block.includes(e.code)) e.preventDefault();
    },

    // 毎フレーム呼ぶ：パッドの状態とエッジを更新
    update() {
      this.pads = {};
      const list = (navigator.getGamepads && navigator.getGamepads()) || [];
      for (const gp of list) {
        if (!gp) continue;
        this.pads[gp.index] = gp;
        if (!this.padOrder.includes(gp.index)) this.padOrder.push(gp.index);
        const prev = this.padPrev[gp.index] || [];
        const edges = new Set();
        for (let b = 0; b < gp.buttons.length; b++) {
          const p = !!(gp.buttons[b] && gp.buttons[b].pressed);
          if (p && !prev[b]) edges.add(b);
          prev[b] = p;
        }
        this.padPrev[gp.index] = prev;
        this.padEdges[gp.index] = edges;

        const ax = { x: gp.axes[0] || 0, y: gp.axes[1] || 0 };
        const pv = this.padAxisPrev[gp.index] || { x: 0, y: 0 };
        this.padAxisEdges[gp.index] = {
          up: ax.y < -AXIS_TH && pv.y >= -AXIS_TH,
          down: ax.y > AXIS_TH && pv.y <= AXIS_TH,
          left: ax.x < -AXIS_TH && pv.x >= -AXIS_TH,
          right: ax.x > AXIS_TH && pv.x <= AXIS_TH,
        };
        this.padAxisPrev[gp.index] = ax;
      }
    },

    endFrame() {
      this.keyEdges.clear();
      for (const k in this.padEdges) this.padEdges[k].clear();
      for (const k in this.padAxisEdges) {
        this.padAxisEdges[k] = { up: false, down: false, left: false, right: false };
      }
    },

    padForSlot(slot) {
      const idx = this.padOrder[slot];
      return idx !== undefined ? this.pads[idx] : null;
    },
    padCount() { return this.padOrder.filter((i) => this.pads[i]).length; },

    keyHeld(codes) { return codes.some((c) => this.keys.has(c)); },
    keyEdge(codes) { return codes.some((c) => this.keyEdges.has(c)); },
    padBtnHeld(gp, btns) { return !!gp && btns.some((b) => gp.buttons[b] && gp.buttons[b].pressed); },
    padBtnEdge(gp, btns) {
      if (!gp) return false;
      const e = this.padEdges[gp.index];
      return !!e && btns.some((b) => e.has(b));
    },

    // メニュー操作（全入力ソース統合）。エッジのみ
    menuActions() {
      const a = { up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false };
      a.up = this.keyEdge(["ArrowUp", "KeyW"]);
      a.down = this.keyEdge(["ArrowDown", "KeyS"]);
      a.left = this.keyEdge(["ArrowLeft", "KeyA"]);
      a.right = this.keyEdge(["ArrowRight", "KeyD"]);
      a.confirm = this.keyEdge(["Enter", "Space", "KeyG", "KeyK"]);
      a.back = this.keyEdge(["Escape", "Backspace", "KeyF", "KeyL"]);
      a.pause = this.keyEdge(["Escape", "KeyP"]);
      for (const idx of this.padOrder) {
        const gp = this.pads[idx];
        if (!gp) continue;
        const ae = this.padAxisEdges[idx] || {};
        a.up = a.up || this.padBtnEdge(gp, [PAD.up]) || ae.up;
        a.down = a.down || this.padBtnEdge(gp, [PAD.down]) || ae.down;
        a.left = a.left || this.padBtnEdge(gp, [PAD.left]) || ae.left;
        a.right = a.right || this.padBtnEdge(gp, [PAD.right]) || ae.right;
        a.confirm = a.confirm || this.padBtnEdge(gp, PAD.rotCW);
        a.back = a.back || this.padBtnEdge(gp, PAD.rotCCW);
        a.pause = a.pause || this.padBtnEdge(gp, PAD.pause);
      }
      return a;
    },
  };

  // 人間プレイヤー用コントローラ
  function HumanController(playerIdx) {
    this.keymap = KEYMAPS[playerIdx];
    this.padSlot = playerIdx;
  }
  HumanController.prototype.poll = function () {
    const km = this.keymap;
    const gp = Input.padForSlot(this.padSlot);
    const ax = gp ? (Input.padAxisPrev[gp.index] || { x: 0, y: 0 }) : { x: 0, y: 0 };
    const axEdge = gp ? (Input.padAxisEdges[gp.index] || {}) : {};
    return {
      left: Input.keyHeld(km.left) || Input.padBtnHeld(gp, [PAD.left]) || ax.x < -AXIS_TH,
      right: Input.keyHeld(km.right) || Input.padBtnHeld(gp, [PAD.right]) || ax.x > AXIS_TH,
      soft: Input.keyHeld(km.soft) || Input.padBtnHeld(gp, [PAD.down]) || ax.y > AXIS_TH,
      hard: Input.keyEdge(km.hard) || Input.padBtnEdge(gp, [PAD.up]) || !!axEdge.up,
      rotCW: Input.keyEdge(km.rotCW) || Input.padBtnEdge(gp, PAD.rotCW),
      rotCCW: Input.keyEdge(km.rotCCW) || Input.padBtnEdge(gp, PAD.rotCCW),
      hold: Input.keyEdge(km.hold) || Input.padBtnEdge(gp, PAD.hold),
    };
  };

  root.Input = Input;
  root.HumanController = HumanController;
  if (typeof module !== "undefined" && module.exports) module.exports = { Input, HumanController, KEYMAPS, PAD };
})(typeof window !== "undefined" ? window : globalThis);
