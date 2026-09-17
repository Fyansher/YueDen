# 基础格式验证

所有样本由本机FFmpeg实际生成，随后通过完整Unified Manager的统一mpv链路播放。当前只确认后端解码和进度；各格式的实际画面/声音及硬件流畅性尚未全部验收。不是最终发布包测试。

| 样本 | 实际编码 | 测试状态 |
|---|---|---|
| mp3 | audio: mp3 / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| wav | audio: pcm_s16le / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| flac | audio: flac / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| aac | audio: aac / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| alac | audio: alac / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| vorbis | audio: vorbis / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| opus | audio: opus / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| h264 | video: h264 / yuv420p; audio: aac / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| hevc-aac | video: hevc / yuv420p; audio: aac / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| hevc-ac3 | video: hevc / yuv420p; audio: ac3 / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| vp9 | video: vp9 / yuv420p; audio: opus / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |
| av1 | video: av1 / yuv420p; audio: opus / 1声道 / 48000Hz | 后端解码/进度通过，画面声音未验收 |

样本路径及原始ffprobe信息：player/test-artifacts/formats/manifest.json。实际播放结果：player/test-artifacts/formats/played.json。HEVC最终样本320×184，其余视频320×180；全部短时生成测试信号，不代表高分辨率、高位深或所有硬件性能。

没有把AVI/MOV/TS/WMV/RM等额外容器标为已实测。