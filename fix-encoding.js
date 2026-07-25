const fs = require('fs');
let c = fs.readFileSync('C:\\Users\\pc\\Downloads\\web3\\index.html', 'utf8');

// Map of Windows-1252 high bytes to their byte values
const W = {
  '\u20AC':0x80, '\u201A':0x82, '\u0192':0x83, '\u201E':0x84,
  '\u2026':0x85, '\u2020':0x86, '\u2021':0x87, '\u02C6':0x88,
  '\u2030':0x89, '\u0160':0x8A, '\u2039':0x8B, '\u0152':0x8C,
  '\u017D':0x8E, '\u2018':0x91, '\u2019':0x92, '\u201C':0x93,
  '\u201D':0x94, '\u2022':0x95, '\u2013':0x96, '\u2014':0x97,
  '\u02DC':0x98, '\u2122':0x99, '\u0161':0x9A, '\u203A':0x9B,
  '\u0153':0x9C, '\u017E':0x9E, '\u0178':0x9F,
};

function c2b(ch) {
  const cp = ch.charCodeAt(0);
  if (cp <= 0xFF) return cp;
  return W[ch] !== undefined ? W[ch] : -1;
}

function fix(str) {
  const r = [];
  let i = 0;
  while (i < str.length) {
    const b0 = c2b(str[i]);
    if (b0 === -1) { r.push(str[i]); i++; continue; }

    // Try 4-byte UTF-8
    if (i+3 < str.length) {
      const b1=c2b(str[i+1]), b2=c2b(str[i+2]), b3=c2b(str[i+3]);
      if (b1>=0 && b2>=0 && b3>=0 && (b0&0xF0)===0xF0 && (b1&0xC0)===0x80 && (b2&0xC0)===0x80 && (b3&0xC0)===0x80) {
        const cp=((b0&0x07)<<18)|((b1&0x3F)<<12)|((b2&0x3F)<<6)|(b3&0x3F);
        r.push(String.fromCodePoint(cp)); i+=4; continue;
      }
    }
    // Try 3-byte UTF-8
    if (i+2 < str.length) {
      const b1=c2b(str[i+1]), b2=c2b(str[i+2]);
      if (b1>=0 && b2>=0 && (b0&0xE0)===0xC0 && (b1&0xC0)===0x80 && (b2&0xC0)===0x80) {
        const cp=((b0&0x1F)<<12)|((b1&0x3F)<<6)|(b2&0x3F);
        r.push(String.fromCodePoint(cp)); i+=3; continue;
      }
    }
    // Try 2-byte UTF-8
    if (i+1 < str.length) {
      const b1=c2b(str[i+1]);
      if (b1>=0 && (b0&0xE0)===0xC0 && (b1&0xC0)===0x80) {
        const cp=((b0&0x1F)<<6)|(b1&0x3F);
        r.push(String.fromCodePoint(cp)); i+=2; continue;
      }
    }
    r.push(str[i]); i++;
  }
  return r.join('');
}

// Run passes until stable
for (let p = 0; p < 5; p++) {
  const before = c;
  c = fix(c);
  if (c === before) break;
}

fs.writeFileSync('C:\\Users\\pc\\Downloads\\web3\\index.html', c, 'utf8');

// Verify specific lines
const check = fs.readFileSync('C:\\Users\\pc\\Downloads\\web3\\index.html', 'utf8').split('\n');
[3037, 1501, 3049, 3052, 3055].forEach(n => {
  if (check[n]) console.log((n+1) + ': ' + check[n].trim().substring(0, 120));
});
