import turns from './turns.js';
export default {tick(s){return {turn:(turns[s.tick]||0)/1000};}};
