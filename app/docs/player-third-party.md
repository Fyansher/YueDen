# 随包组件与来源核对

全包每个文件的SHA-256见根目录SHA256SUMS.json。mpv下载与核心源码、许可材料摘要见`player/vendor/materials/manifest.json`。这是可追溯清单，不是“全部许可义务已经满足”的声明。

| 组件 | 版本/来源 | 许可与材料 |
|---|---|---|
| mpv.exe / mpv.com | v0.41.0-1023-g69e63f425；[shinchiro 20260903](https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260903)，[mpv官网列出的构建](https://mpv.io/installation/) | 原二进制未修改；GPL/LGPL及Copyright、核心源码69e63f425a、构建脚本cd1edc11随包 |
| mpv内置FFmpeg | N-126390-g9fc8c785e | 对应FFmpeg核心源码随包；完整静态依赖材料未核齐 |
| mpv内置libplacebo | v7.371.0，v7.360.0-120-g86bbd5d-dirty | dirty补丁来源待上游提供；不能称完全对应源码 |
| d3dcompiler_43.dll | 与上述官方推荐mpv压缩包一起取得；文件版本10.0.18362.1，Microsoft署名版本信息 | 不将版本信息视为签名或分发授权；具体再分发许可待核对 |
| Electron及Chromium | 44.3.0，https://github.com/electron/electron/releases/tag/v44.3.0 | LICENSE.electron.txt、LICENSES.chromium.html随包；品牌资源修改不改变执行逻辑 |
| 既有FFmpeg/ffprobe | n8.1.2-51-g7ba069f4f1，BtbN Windows x64 LGPL shared | codec下版本/许可；根目录第三方源码含FFmpeg快照及BtbN构建脚本；既有说明保留 |
| hls.js/dash.js/epub.js/JSZip/PDF.js/DOMPurify/MOBI解析器 | app/vendor/manifest.json逐项版本 | vendor/licenses原有材料保留；每文件hash在总清单 |
| VideoHost / ResourcePicker / 启动器 | 项目自有C#，Windows .NET Framework 4.x | 源码保留，非额外下载未知来源二进制；VideoHost本轮重编译 |

mpv原下载压缩包SHA-256：`418dbfb5feb851cbed33d6c05d8481ba71802621bfd6efe8974522b28d42ac97`，与GitHub资产digest一致；包中mpv.exe SHA-256：`4a0bc712bc98e6f80cd980930b74b6ac202b8ccf2041e887adab69906f82731c`。

Electron下载ZIP SHA-256：`26bf9a617d58d81772b3d68305d59ee48272969c15083c06db634a77358a8d9d`，本轮重新计算并与保留的上游SHASUMS256.txt一致。既有FFmpeg下载ZIP摘要：`af773cb7fc15999e60f09af9c0d03100277397a09b5dda9580a09b6d9b84a574`（历史来源记录，本轮没有重新下载）。

阻塞证据：mpv上游工作流33697571182的x86_64日志artifact 9873346961已过期，无法据其确定所有静态依赖精确修订；未尝试绕过访问限制。所有新增材料通过HTTPS和系统信任证书获取，没有关闭TLS校验。公开发布前仍需补齐对应依赖源码/补丁及必要许可，不得把这个本地候选包标为已完成公开分发合规。
