const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Small references in library.json; one content-addressed file per image.
class CoverStore {
  constructor(root, nativeImage) { this.root = root; this.nativeImage = nativeImage; this.converted = new Map(); }
  fileFor(reference) {
    const match = String(reference || '').match(/^um-cover:\/\/image\/([a-f0-9]{64}\.jpg)$/);
    return match ? path.join(this.root(), match[1]) : null;
  }
  saveBuffer(buffer) {
    if (buffer.length > 12 * 1024 * 1024) throw Error('图片需要小于 12 MB');
    const sourceHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (this.converted.has(sourceHash) && fs.existsSync(this.fileFor(this.converted.get(sourceHash)))) return this.converted.get(sourceHash);
    let image = this.nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) throw Error('无法识别这张图片');
    const { width, height } = image.getSize();
    if (Math.max(width, height) > 1440) image = image.resize(width >= height ? { width: 1440, quality: 'good' } : { height: 1440, quality: 'good' });
    // Already optimized JPEGs survive export/import without repeated lossy encoding.
    const compact = Math.max(width, height) <= 1440 && buffer.length <= 1024 * 1024 && buffer[0] === 0xff && buffer[1] === 0xd8 ? buffer : image.toJPEG(88);
    const name = crypto.createHash('sha256').update(compact).digest('hex') + '.jpg';
    fs.mkdirSync(this.root(), { recursive: true });
    const file = path.join(this.root(), name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, compact, { flag: 'wx' });
    const reference = 'um-cover://image/' + name;
    if (this.converted.size >= 256) this.converted.clear();
    this.converted.set(sourceHash, reference);
    return reference;
  }
  compact(value) {
    const url = String(value || '');
    if (!/^data:image\/(?:png|jpeg|jpg|webp|gif|bmp);base64,/i.test(url)) return url;
    try { return this.saveBuffer(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')); }
    catch { return url; } // Never discard an existing image if conversion fails.
  }
  portable(value) {
    const file = this.fileFor(value);
    if (!file) return value;
    if (!fs.existsSync(file)) throw Error('本地封面文件缺失，无法生成完整备份');
    return 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
  }
  mapCovers(value, transform, depth=0) {
    if(depth>40)throw Error('资源关系嵌套过深，停止封面转换');
    if(Array.isArray(value))return value.map(v=>this.mapCovers(v,transform,depth+1));
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,['cover','coverPortrait','coverLandscape'].includes(key)&&typeof v==='string'?transform(v):this.mapCovers(v,transform,depth+1)]));
  }
  compactItem(item) { return this.mapCovers(item,value=>this.compact(value)); }
  exportLibrary(state) { return this.mapCovers(state,value=>this.portable(value)); }

}
module.exports = CoverStore;
