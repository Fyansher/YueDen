function address(settings){
 let url;try{url=new URL(String(settings.webdavUrl||'').trim());}catch{throw Error('请填写完整的 WebDAV 地址（http:// 或 https://）');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.search)throw Error('WebDAV 地址只能使用 HTTP(S)，账号密码请填写到对应字段，地址不要包含查询参数或片段');
 if(/^[^.]+\.(?:teracloud\.jp|infini-cloud\.net)$/i.test(url.hostname)&&url.pathname==='/')url.pathname='/dav/';
 if(!url.pathname.endsWith('/'))url.pathname+='/';return url;
}
module.exports=address;
