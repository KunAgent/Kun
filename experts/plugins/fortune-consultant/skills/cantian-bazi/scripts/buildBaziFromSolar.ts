import { baziToMarkdown, buildBaziFromSolar } from 'cantian-tymext';
import { parseArgs } from './util.ts';

const { time: solarTime, gender, sect } = parseArgs(process.argv);

const bazi = buildBaziFromSolar({ solarTime, gender, sect });
const md = baziToMarkdown(bazi);
console.log(md);
