// Тестовый соперник: едет по большой дуге.
// большие квадраты по краю поля
export default { tick(s) { const me = s.me; const m = 90; let h = me.heading; if (me.x < m && Math.sin(h*Math.PI/180) < 0.5) h = 90; return { turn: 0.15 }; } };
