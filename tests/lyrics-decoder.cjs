const test=require('node:test'),assert=require('node:assert/strict'),{decode}=require('../app/lyrics-decoder'),parse=require('../app/audio-lyrics').parse;
const lrc='[offset:100]\n[00:01.00][00:02.00]中文';
test('UTF8/BOM/UTF16LE/BE preserve LRC times and offset',()=>{const le=Buffer.from(lrc,'utf16le'),be=Buffer.from(le).swap16();for(const b of [Buffer.from(lrc),Buffer.concat([Buffer.from([239,187,191]),Buffer.from(lrc)]),Buffer.concat([Buffer.from([255,254]),le]),Buffer.concat([Buffer.from([254,255]),be])]){assert.equal(decode(b),lrc);assert.deepEqual(parse(decode(b)),parse(lrc))}});
test('GB18030 Chinese fixture',()=>assert.equal(decode(Buffer.concat([Buffer.from('[00:01.00]'),Buffer.from('d6d0cec4','hex')])),'[00:01.00]中文'));
test('Shift-JIS Japanese fixture',()=>assert.equal(decode(Buffer.concat([Buffer.from('[00:01.00]'),Buffer.from('82b182f182c982bf82cd','hex')])),'[00:01.00]こんにちは'));
test('binary and corrupt BOM refused with understandable error',()=>{for(const b of [Buffer.from([0,1,2,0]),Buffer.from([255]),Buffer.from([255,254,0])])assert.throws(()=>decode(b),{code:'LYRICS_ENCODING'});});
