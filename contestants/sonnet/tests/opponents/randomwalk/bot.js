// Тестовый соперник: случайные повороты.
let seed = 1;
const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
export default { init() { seed = 7; }, tick(s) { return { turn: (r() - 0.5) * 0.6 }; } };
