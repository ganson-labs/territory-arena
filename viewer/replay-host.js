// Replay mode: stands in for BotHost and answers every tick with the turn recorded in a replay
// (moves[side][tick], integer -1000..1000), so the engine rebuilds the round exactly as it was played.
// Nothing of the contestant's current bot.js is loaded or run.
export class ReplayHost {
  constructor(entry) {
    this.entry = entry;
    this.moves = null;
    this.side = 0;
    this.served = 0;
    this.beyond = 0;
  }

  // The replay of the round about to be played; the side comes with init().
  use(replay) {
    this.moves = replay.moves;
    this.served = 0;
    this.beyond = 0;
  }

  async load() {
    return { hasTick: true };
  }

  async init(info) {
    this.side = info.side;
  }

  async tick(view) {
    const m = this.moves?.[this.side];
    if (!m || view.tick >= m.length) {
      this.beyond++;
      return { turn: 0 };
    }
    this.served++;
    return { turn: m[view.tick] / 1000 };
  }

  health() {
    return { missed: 0, misses: [], errors: 0, frozen: false, lastError: this.beyond ? `реплей кончился: ${this.beyond} ходов прямо` : '', replay: true };
  }

  dispose() {}
}
