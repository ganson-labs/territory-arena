// Тестовый соперник: кружит у собственной базы и никогда не выходит.
// кружит у собственной базы, никогда не выходит
export default { tick(s) { const me = s.me; const b = me.base; const d = Math.hypot(me.x - b.x, me.y - b.y); return { turn: d > 40 ? (Math.atan2(b.y - me.y, b.x - me.x) * 180 / Math.PI) : 0.5 }; } };
