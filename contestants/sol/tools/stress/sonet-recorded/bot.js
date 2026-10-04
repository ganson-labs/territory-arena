import turns from './turns.js';
// This opponent repeats recorded turns; it cannot react to changed play.
export default {tick(s){return {turn:(turns[s.tick]||0)/1000};}};
