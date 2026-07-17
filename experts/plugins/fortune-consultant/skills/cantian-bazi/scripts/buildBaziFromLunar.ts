import { baziToMarkdown, buildBaziFromLunar } from 'cantian-tymext';
import { parseArgs } from './util.ts';

const { time: lunarTime, gender, sect } = parseArgs(process.argv);

const bazi = buildBaziFromLunar({ lunarTime, gender, sect });
const md = baziToMarkdown(bazi);
console.log(md);
