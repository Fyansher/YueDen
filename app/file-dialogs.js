const fs = require('node:fs');
const path = require('node:path');

function createFileDialogs({ dialog, windowFor, settings }) {
  async function choose(event, options) {
    try {
      const owner = windowFor(event);
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths?.length) return { canceled: true, paths: [] };
      const paths = result.filePaths.filter(value => typeof value === 'string' && fs.existsSync(value));
      if (!paths.length) return { ok: false, message: '所选位置不存在或无法访问' };
      return { ok: true, paths };
    } catch (error) { return { ok: false, message: error.message || '文件选择窗口无法打开' }; }
  }
  return {
    scan: event => choose(event, { title: '选择本地游戏扫描范围', properties: ['openDirectory', 'multiSelections'] }),
    async resource(event, kind, initial) {
      if (!['file', 'folder', 'note', 'noteRoot'].includes(kind)) return { ok: false, message: '不支持的选择类型' };
      const directory = kind === 'folder' || kind === 'noteRoot';
      const root = settings().obsidianRoot;
      const options = { title: { file: '选择本地资源文件', folder: '选择本地资源文件夹', note: '选择 Obsidian 笔记', noteRoot: '选择 Obsidian 笔记根目录' }[kind], properties: [directory ? 'openDirectory' : 'openFile'] };
      if (kind === 'note') options.filters = [{ name: 'Markdown 笔记', extensions: ['md', 'markdown'] },{name:'所有文件（All Files）',extensions:['*']}];
      if (!directory&&!options.filters) options.filters=[{name:'所有文件（All Files）',extensions:['*']}];
      if ((kind === 'note' || kind === 'noteRoot') && root && fs.existsSync(root)) options.defaultPath = root;
      if(typeof initial==='string'){try{if(initial.startsWith('obsidian://'))initial=new URL(initial).searchParams.get('path');if(initial&&path.isAbsolute(initial)&&fs.existsSync(initial))options.defaultPath=fs.statSync(initial).isDirectory()?initial:path.dirname(initial);}catch{}}
      const result = await choose(event, options); if (!result.ok) return result;
      const selected = result.paths[0];
      if (fs.statSync(selected).isDirectory() !== directory) return { ok: false, message: directory ? '请选择文件夹' : '请选择文件' };
      return { ok: true, value: kind === 'note' ? 'obsidian://open?path=' + encodeURIComponent(path.resolve(selected)) : selected };
    }
  };
}
module.exports = createFileDialogs;
