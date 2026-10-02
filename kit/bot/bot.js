// Стартовый шаблон. Замени всё: правила и API — в ARENA.md.
// Сейчас бот просто нарезает квадраты 5x5 вокруг базы и никого не боится.

let step = 0;

export default {
  // Необязательно: вызывается в начале каждого раунда.
  init(info) {
    step = 0;
  },

  // Вызывается 10 раз в секунду. Верни 'up' | 'down' | 'left' | 'right' | 'straight'.
  tick(state) {
    const loop = ['right', 'right', 'right', 'right', 'right', 'down', 'down', 'down', 'down', 'down',
      'left', 'left', 'left', 'left', 'left', 'up', 'up', 'up', 'up', 'up'];
    return loop[step++ % loop.length];
  },
};
