# Agnes Video 2.5 Flash — API 参考（摘自官方文档）

采用 OpenAI Videos 兼容 API，异步任务：创建 → 轮询 → 取结果。

## Endpoints

```
POST https://api.agnes-ai.cn/v1/videos
GET  https://api.agnes-ai.cn/agnesapi?video_id=<VIDEO_ID>&model_name=agnes-video-2.5-flash
```

请求头：

```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

## 创建任务 — 公共参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 固定 `agnes-video-2.5-flash` |
| `prompt` | string | 是 | 视频内容描述；reference 模式可用 `<Picture N>` / `<Audio N>` 指代素材 |
| `mode` | string | 是 | `text`、`keyframe` 或 `reference` |
| `seconds` | string | 否 | 时长 `"4"`–`"12"`，默认 `"5"` |
| `size` | string | 否 | Flash 固定 `"720P"`，其他值返回 HTTP 400 |
| `aspect_ratio` | string | 否 | 默认 `16:9` |
| `seed` | integer | 否 | 随机种子 |
| `n` | integer | 否 | 当前仅支持 `1`，默认 `1` |

## 模式专用参数

| 参数 | 类型 | 适用模式 | 说明 |
| --- | --- | --- | --- |
| `first_frame` | string | `keyframe` | 首帧图片 URL；与 `last_frame` 至少一个 |
| `last_frame` | string | `keyframe` | 尾帧图片 URL |
| `images` | string[] | `reference` | 参考图 URL 列表，Flash 最多 5 张 |
| `audios` | string[] | `reference` | 参考音频 URL 列表，Flash 最多 3 段 |
| `videos` | object[] | `reference` | Flash **不支持**；传入有效内容返回 HTTP 400 |

## 生成模式规则

| mode | 用途 | 必需媒体 | 不允许的媒体字段 |
| --- | --- | --- | --- |
| `text` | 纯文本生成 | 无 | `first_frame`、`last_frame`、`images`、`audios`、`videos` |
| `keyframe` | 首帧/尾帧/首尾帧控制 | `first_frame` 与 `last_frame` 至少一个 | `images`、`audios`、`videos` |
| `reference` | 图片或音频参考 | `images` 或 `audios` 至少一类非空 | `first_frame`、`last_frame`、`videos` |

## 请求示例

文生视频：

```json
{
  "model": "agnes-video-2.5-flash",
  "prompt": "夜晚森林中三只猫组成微型铜管乐队向前行进，镜头平稳后退，月光穿过树叶",
  "seconds": "5",
  "mode": "text",
  "size": "720P",
  "aspect_ratio": "16:9"
}
```

首尾帧控制：

```json
{
  "model": "agnes-video-2.5-flash",
  "prompt": "人物从首帧姿态自然转身走向窗边，镜头缓慢推进并平滑过渡到尾帧",
  "seconds": "5",
  "mode": "keyframe",
  "size": "720P",
  "first_frame": "https://example.com/first.png",
  "last_frame": "https://example.com/last.png"
}
```

图片参考：

```json
{
  "model": "agnes-video-2.5-flash",
  "prompt": "以 <Picture 1> 中的角色和美术风格为参考，角色在花田中自然奔跑，保持外观一致",
  "seconds": "5",
  "mode": "reference",
  "size": "720P",
  "aspect_ratio": "16:9",
  "images": ["https://example.com/character.png"]
}
```

## 响应与查询

创建成功后保存响应中的 `video_id`（`id` 和 `task_id` 是任务 ID，`video_id` 用于查询）。

```
GET https://api.agnes-ai.cn/agnesapi?video_id=<VIDEO_ID>&model_name=agnes-video-2.5-flash
```

- 适用于 `text`、`keyframe`、`reference` 全部模式（推荐）
- 不带 `model_name` 的纯 `video_id` 查询仅适用于 `mode: "text"`；`keyframe`/`reference` 必须带 `model_name=agnes-video-2.5-flash`
- 建议每 1–2 秒查询一次，直到 `status` 变为 `completed` 或 `failed`
- 完成后视频地址在 `metadata.url`

## Flash 专属错误（HTTP 400）

按 `size`、`images`、`audios`、`videos` 顺序返回首个检测到的错误：

| 错误信息 | 含义 |
| --- | --- |
| `size must be 720P` | size 非 720P |
| `images length must not exceed 5` | 参考图超过 5 张 |
| `audios length must not exceed 3` | 参考音频超过 3 段 |
| `videos is not supported` | 传入了参考视频 |

Flash 专属校验在创建/排队/计费/推理前执行，失败不创建任务、不产生费用。

## 视频尺寸与画幅（size 固定 720P）

| aspect_ratio | 输出像素 |
| --- | --- |
| 21:9 | 1680x720 |
| 16:9 | 1280x704 |
| 4:3 | 960x720 |
| 1:1 | 720x720 |
| 3:4 | 720x960 |
| 9:16 | 720x1280 |

## 计费规则

与 Agnes Video 2.5 相同公式，当前限时免费：

```
视频总金额 = 输出秒数 × 单价 + 输入视频秒数 × 单价 + max(0, 图片数 - 免费图片张数) × 图片超额单价
```

- 输出分辨率原价 ¥0.15/秒，现价 ¥0/秒（限时免费）
- 免费图片张数按刊例为 5 张；Flash 仅支持 720P，最多 5 张参考图、3 段参考音频

## 接入清单

- 模型 ID 用 `agnes-video-2.5-flash`
- `size` 固定为字符串 `"720P"`
- `reference` 模式：`images` ≤ 5、`audios` ≤ 3，不要传有效 `videos`
- `seconds` 用字符串 `"4"`–`"12"`，`n` 固定 `1`
- 所有模式推荐用 `video_id` + `model_name=agnes-video-2.5-flash` 查询
- 不要把 key 写入前端代码、日志或公开仓库
