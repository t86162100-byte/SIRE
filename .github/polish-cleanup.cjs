const fs=require('fs');
const p='backend/index.ts';
let s=fs.readFileSync(p,'utf8');
const duplicate="const BACKTEST_MAX_TICKS = 100000;\nconst DATA_PAGE_LIMIT = 100;\nconst PAPER_TABLE = 'sire_paper_trades_v1';\nconst DATA_MAX_PAGES = 120;\n\nconst BACKTEST_MAX_TICKS = 100000;\nconst DATA_PAGE_LIMIT = 100;\nconst PAPER_TABLE = 'sire_paper_trades_v1';\nconst DATA_MAX_PAGES = 120;";
const single="const BACKTEST_MAX_TICKS = 100000;\nconst DATA_PAGE_LIMIT = 100;\nconst PAPER_TABLE = 'sire_paper_trades_v1';\nconst DATA_MAX_PAGES = 120;";
if(!s.includes(duplicate)) throw new Error('Expected duplicate constant block was not found.');
s=s.replace(duplicate,single);
fs.writeFileSync(p,s);
console.log('Polish applied.');
