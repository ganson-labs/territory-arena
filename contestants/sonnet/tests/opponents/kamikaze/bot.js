// Тестовый соперник: всегда едет на голову соперника. Запуск: node arena/cli.mjs bot --vs tests/opponents/kamikaze
export default {
  tick(s) {
    return { heading: (Math.atan2(s.enemy.y - s.me.y, s.enemy.x - s.me.x) * 180) / Math.PI };
  },
};
