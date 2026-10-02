// Стартовый шаблон облика. Замени всё: API — в ARENA.md, раздел «Облик».
// Каждая функция рисует на переданном ctx (OffscreenCanvas 2D). Цвета из team.json приходят в color и accent.

export default {
  head(ctx, { size, dir, frame, frames, color, accent }) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
  },

  land(ctx, { size, color, accent }) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 0, size, size);
  },

  trail(ctx, { size, color, accent }) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(0, 0, size, size);
  },

  victory(ctx, { width, height, t, duration, color, accent, name }) {
    ctx.fillStyle = color;
    ctx.globalAlpha = Math.min(1, t);
    ctx.font = `bold ${Math.round(height / 6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(name, width / 2, height / 2);
  },
};
