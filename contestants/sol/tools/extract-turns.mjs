import {readFileSync,writeFileSync} from 'node:fs';
const replay=JSON.parse(readFileSync('rounds/round-1.json','utf8'));
writeFileSync('tools/stress/sonet-recorded/turns.js','export default '+JSON.stringify(replay.moves[0])+';\n');
