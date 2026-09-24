# 悦森盒 YueDen

版本：**1.0.1** · Windows x64

悦森盒 YueDen 是一款用于集中整理、浏览、播放和阅读个人影视、番剧、音频、书籍、漫画等本地数字内容的 Windows 桌面应用。

## 部分快捷操作
- 双击**ESC**快速最小化所有窗口并暂停、静音、启动伪装模式，自动跳转到伪装视频链接。
- **右键**：关闭窗口；播放列表排序；资源卡片快速修改；更换高亮、下划线；
- 筛选模式下，勾选框上左键拖动进行快速选择。

## 下载

[下载 Windows x64 独立发布包](https://github.com/Fyansher/YueDen/releases)。完整解压后运行根目录的 `YueDen.exe`。

本仓库为对应版本的应用源码；不包含个人资源库、账号凭据、缓存、日志、node_modules 或第三方可执行文件。

沿用单 mpv 会话、原内部标识和用户数据格式。

## 源码结构

- `app/`：Electron 主进程、preload、主界面、资源管理和阅读器。
- `app/player/src/`：TypeScript 播放服务、mpv 后端及窗口管理。
- `app/player/native/`、`app/native/`：原生窗口和文件选择器源码。
- `app/assets/`：应用及任务栏图标。
- `app/vendor/`：网页第三方组件及许可。
- `tests/`、`app/player/tests/`：测试源码；部分集成测试需额外运行时和本地测试媒体。
- `packaging/Launcher.cs`、`app/player/build-release.cjs`：启动器及现有发布脚本。
- `SOURCE-MANIFEST.json`：源码 SHA-256 与发布包对应检查记录。

## 开发与构建

需要 Node.js、pnpm、Windows x64、.NET Framework 4.x 编译器及 Electron **44.3.0**。播放器依赖已锁定：

```powershell
cd app/player
pnpm install --frozen-lockfile
pnpm build
pnpm test
node native/build.cjs
```

独立开发入口：`node app/player/start-isolated.cjs <Electron可执行文件绝对路径>`，使用 `app/player/dev-user-data`，避免连接正式数据。

完整运行还需要在原位置提供 ResourcePicker、mpv、FFmpeg 等组件，可从本版本 Windows 发布包取得。不要覆盖正式安装或个人数据。

现有完整打包脚本依赖仓库上一级的 `runtime-44/extracted`、`branding-tools`、`third-party-source`、`packaging/第三方组件.md` 及应用内原生/媒体运行组件。目前不是下载仓库即可一键打包的独立构建流程。源码上传保留现有实现，未重构或重新打包程序。

## 第三方组件与限制

mpv：`v0.41.0-1023-g69e63f425`。见[来源记录](app/player/vendor/source.json)、[材料清单](app/player/vendor/materials/manifest.json)、[第三方组件说明](app/docs/player-third-party.md)。材料清单中的源码压缩包位于 Windows 发布包内，不重复提交到 Git 目录。

第三方组件保留各自许可。本仓库未另行指定统一的开源许可证，不改变第三方许可适用范围。公开可见不代表可直接写入仓库；外部用户没有维护者写权限。

完整第三方对应源码及许可核对仍有已知缺口，包括静态依赖修订、libplacebo dirty 补丁和部分运行库再分发说明。多显示器、全部缩放比例、声卡回采等完整人工验收未完成。Windows 音量面板最终视觉呈现和任务栏缩略图按钮实际鼠标操作仍需人工确认。源码上传不增加功能验收结论。
