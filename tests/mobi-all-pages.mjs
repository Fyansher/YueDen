import fs from 'node:fs';
import {initKf8File} from '../app/vendor/mobi-parser.min.mjs';
const bytes=new Uint8Array(fs.readFileSync(process.argv[2]));
const book=await initKf8File(bytes);let count=0;const failures=[];
try {for(const chapter of book.getSpine()){const value=await book.loadChapter(chapter.id);for(const match of value.html.matchAll(/src=["'](blob:[^"']+)["']/g)){count++;const response=await fetch(match[1]),data=new Uint8Array(await response.arrayBuffer());if(!(data[0]===255&&data[1]===216||data[0]===137&&data[1]===80||data[0]===71&&data[1]===73))failures.push({page:count,bytes:data.length});}}console.log(JSON.stringify({count,failures}));if(failures.length)process.exitCode=1;}finally{book.destroy();}
