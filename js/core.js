/* core.js — テトリスの中核ロジック（盤面・ピース・SRS回転・7種バッグ・攻撃計算）
   ブラウザ/Node 両対応（Nodeはヘッドレステスト用） */
(function (root) {
  "use strict";

  const COLS = 10;
  const VISIBLE_ROWS = 20;
  const HIDDEN_ROWS = 4;
  const ROWS = VISIBLE_ROWS + HIDDEN_ROWS; // 内部行数（上4行は不可視）

  // ピース定義: 4回転状態それぞれのセル座標 [x, y]（y下向き正）
  // SRSスーパーローテーション準拠
  const PIECES = {
    I: {
      color: "#00e5ff",
      rotations: [
        [[0, 1], [1, 1], [2, 1], [3, 1]],
        [[2, 0], [2, 1], [2, 2], [2, 3]],
        [[0, 2], [1, 2], [2, 2], [3, 2]],
        [[1, 0], [1, 1], [1, 2], [1, 3]],
      ],
      size: 4,
    },
    O: {
      color: "#ffd500",
      rotations: [
        [[1, 0], [2, 0], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [2, 1]],
      ],
      size: 4,
    },
    T: {
      color: "#c238ff",
      rotations: [
        [[1, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [1, 2]],
        [[1, 0], [0, 1], [1, 1], [1, 2]],
      ],
      size: 3,
    },
    S: {
      color: "#2bff5d",
      rotations: [
        [[1, 0], [2, 0], [0, 1], [1, 1]],
        [[1, 0], [1, 1], [2, 1], [2, 2]],
        [[1, 1], [2, 1], [0, 2], [1, 2]],
        [[0, 0], [0, 1], [1, 1], [1, 2]],
      ],
      size: 3,
    },
    Z: {
      color: "#ff3355",
      rotations: [
        [[0, 0], [1, 0], [1, 1], [2, 1]],
        [[2, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [1, 2], [2, 2]],
        [[1, 0], [0, 1], [1, 1], [0, 2]],
      ],
      size: 3,
    },
    J: {
      color: "#3d6bff",
      rotations: [
        [[0, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [2, 2]],
        [[1, 0], [1, 1], [0, 2], [1, 2]],
      ],
      size: 3,
    },
    L: {
      color: "#ff9500",
      rotations: [
        [[2, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [1, 2], [2, 2]],
        [[0, 1], [1, 1], [2, 1], [0, 2]],
        [[0, 0], [1, 0], [1, 1], [1, 2]],
      ],
      size: 3,
    },
  };

  const PIECE_NAMES = ["I", "O", "T", "S", "Z", "J", "L"];

  // SRSキックテーブル（画面座標系: dyは下向き正に変換済み）
  // key: "from>to"
  const KICKS_JLSTZ = {
    "0>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "1>0": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "1>2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "2>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "2>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "3>2": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "3>0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "0>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  };
  const KICKS_I = {
    "0>1": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    "1>0": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    "1>2": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    "2>1": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    "2>3": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    "3>2": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    "3>0": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    "0>3": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  };

  function getKicks(type, from, to) {
    if (type === "O") return [[0, 0]];
    const table = type === "I" ? KICKS_I : KICKS_JLSTZ;
    return table[from + ">" + to] || [[0, 0]];
  }

  // ---- 盤面 ----
  function createBoard() {
    const b = new Array(ROWS);
    for (let y = 0; y < ROWS; y++) b[y] = new Array(COLS).fill(null);
    return b;
  }

  function cloneBoard(board) {
    return board.map((row) => row.slice());
  }

  function cellsOf(type, rot, x, y) {
    const def = PIECES[type].rotations[rot & 3];
    const out = new Array(4);
    for (let i = 0; i < 4; i++) out[i] = [x + def[i][0], y + def[i][1]];
    return out;
  }

  function collides(board, type, rot, x, y) {
    const def = PIECES[type].rotations[rot & 3];
    for (let i = 0; i < 4; i++) {
      const cx = x + def[i][0];
      const cy = y + def[i][1];
      if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
      if (cy >= 0 && board[cy][cx]) return true;
    }
    return false;
  }

  function lockPiece(board, type, rot, x, y, cellValue) {
    const cells = cellsOf(type, rot, x, y);
    let lockout = true; // 全セルが不可視領域 → ロックアウト負け
    for (const [cx, cy] of cells) {
      if (cy >= 0 && cy < ROWS) board[cy][cx] = cellValue || type;
      if (cy >= HIDDEN_ROWS) lockout = false;
    }
    return lockout;
  }

  function findFullRows(board) {
    const rows = [];
    for (let y = 0; y < ROWS; y++) {
      let full = true;
      for (let x = 0; x < COLS; x++) {
        if (!board[y][x]) { full = false; break; }
      }
      if (full) rows.push(y);
    }
    return rows;
  }

  function clearRows(board, rows) {
    // rows: 昇順の行番号。消して上から詰める
    for (const y of rows) {
      board.splice(y, 1);
      board.unshift(new Array(COLS).fill(null));
    }
  }

  function addGarbage(board, lines, holeCol) {
    // 下からせり上げ。holeCol の位置だけ穴
    for (let i = 0; i < lines; i++) {
      board.shift();
      const row = new Array(COLS).fill("G");
      row[holeCol] = null;
      board.push(row);
    }
  }

  function dropY(board, type, rot, x, y) {
    let ny = y;
    while (!collides(board, type, rot, x, ny + 1)) ny++;
    return ny;
  }

  function stackHeight(board) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (board[y][x]) return ROWS - y;
      }
    }
    return 0;
  }

  function isBoardEmpty(board) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (board[y][x]) return false;
      }
    }
    return true;
  }

  // ---- 7種1巡バッグ ----
  function makeBag(rng) {
    const bag = PIECE_NAMES.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  // シード付き乱数（対戦の公平性のため両者同じツモ順にできる）
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Tスピン判定（3コーナールール） ----
  function detectTSpin(board, type, rot, x, y, lastMoveWasRotation, lastKickIndex) {
    if (type !== "T" || !lastMoveWasRotation) return { tspin: false, mini: false };
    // Tの中心は (x+1, y+1)
    const cx = x + 1, cy = y + 1;
    const corners = [
      [cx - 1, cy - 1], [cx + 1, cy - 1],
      [cx - 1, cy + 1], [cx + 1, cy + 1],
    ];
    let filled = 0;
    const filledFlags = corners.map(([px, py]) => {
      const f = px < 0 || px >= COLS || py >= ROWS || (py >= 0 && board[py][px]);
      if (f) filled++;
      return !!f;
    });
    if (filled < 3) return { tspin: false, mini: false };
    // 前面2コーナー（向いている側）が両方埋まっていれば通常Tスピン、それ以外はミニ
    // rot0:前面=上(0,1), rot1:前面=右(1,3), rot2:前面=下(2,3), rot3:前面=左(0,2)
    const frontIdx = [[0, 1], [1, 3], [2, 3], [0, 2]][rot & 3];
    const frontFilled = filledFlags[frontIdx[0]] && filledFlags[frontIdx[1]];
    // SRS第5キック(インデックス4)成立時は通常Tスピン扱い
    const mini = !frontFilled && lastKickIndex !== 4;
    return { tspin: true, mini };
  }

  // ---- 攻撃力計算（送るおじゃま行数） ----
  const COMBO_TABLE = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];

  function attackOf(info) {
    // info: { lines, tspin, mini, b2b, combo, perfectClear }
    let atk = 0;
    if (info.tspin && !info.mini) {
      atk = [0, 2, 4, 6][info.lines] || 0;
    } else if (info.tspin && info.mini) {
      atk = [0, 0, 1, 2][info.lines] || 0;
    } else {
      atk = [0, 0, 1, 2, 4][info.lines] || 0;
    }
    if (info.b2b && atk > 0) atk += 1;
    if (info.combo > 0) {
      atk += COMBO_TABLE[Math.min(info.combo, COMBO_TABLE.length - 1)];
    }
    if (info.perfectClear) atk += 10;
    return atk;
  }

  function clearName(info) {
    if (info.perfectClear) return "PERFECT CLEAR";
    if (info.tspin) {
      const base = info.mini ? "T-SPIN MINI" : "T-SPIN";
      return base + ["", " SINGLE", " DOUBLE", " TRIPLE"][info.lines];
    }
    return ["", "SINGLE", "DOUBLE", "TRIPLE", "TETRIS"][info.lines] || "";
  }

  // スコア（演出用・勝敗はKOで決まる）
  function scoreOf(info, level) {
    let base = 0;
    if (info.tspin && !info.mini) base = [400, 800, 1200, 1600][info.lines];
    else if (info.tspin && info.mini) base = [100, 200, 400, 400][info.lines];
    else base = [0, 100, 300, 500, 800][info.lines];
    if (info.b2b && base > 0) base = Math.floor(base * 1.5);
    base += 50 * Math.max(0, info.combo);
    if (info.perfectClear) base += 2000;
    return base * level;
  }

  const Core = {
    COLS, ROWS, VISIBLE_ROWS, HIDDEN_ROWS,
    PIECES, PIECE_NAMES,
    getKicks, createBoard, cloneBoard, cellsOf, collides, lockPiece,
    findFullRows, clearRows, addGarbage, dropY, stackHeight, isBoardEmpty,
    makeBag, mulberry32, detectTSpin, attackOf, clearName, scoreOf,
    COMBO_TABLE,
  };

  root.Core = Core;
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
})(typeof window !== "undefined" ? window : globalThis);
