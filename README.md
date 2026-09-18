# Agnes 视频生成

用 **Agnes Video 2.5 Flash** 生成视频。支持文生视频、首尾帧控制，以及图片 / 音频参考生成。

- 模型 ID：`agnes-video-2.5-flash`
- 异步任务接口：创建任务 → 轮询进度 → 下载 mp4（脚本已全流程封装）
- 画质固定 `720P`，时长 `4`–`12` 秒
- 纯 Node.js 实现，无第三方依赖，**要求 Node.js ≥ 18**
- 脚本不含任何 API Key，可直接分享给他人使用

---

## 一、准备 API Key

脚本会按以下顺序自动查找 Key，**只要命中一个即可**：

1. 环境变量 `AGNES_API_KEY`
2. 环境变量 `AGNES_KEY_FILE` 指向的文件
3. `~/.agnes_key`
4. `~/.workbuddy/agnes-key.txt`

Key 从 https://www.agnes-ai.cn 控制台获取。最简单的配置方式（任选其一）：

**Windows（PowerShell）**

```powershell
"你的_AGNES_KEY" | Out-File -Encoding ascii "$env:USERPROFILE\.agnes_key"
```

**macOS / Linux**

```bash
echo "你的_AGNES_KEY" > ~/.agnes_key
```

> 图像与视频技能**共用同一个 Key**，已配过图像技能的无需重复配置。

### 可选环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AGNES_BASE_URL` | `https://api.agnes-ai.cn` | 接口地址（一般不用改） |
| `AGNES_OUTPUT_DIR` | `~/agnes-output` | 默认视频保存目录 |

---

## 二、快速开始

```bash
node scripts/agnes_video.cjs \
  --prompt "夜晚森林中三只猫组成微型铜管乐队向前行进，镜头平稳后退，月光穿过树叶" \
  --seconds 5 --aspect-ratio 16:9
```

生成需要排队 + 推理，请耐心等待（脚本默认最长轮询 15 分钟）。

### 三种模式

#### 1）文生视频（`text`，默认）

```bash
node scripts/agnes_video.cjs \
  --prompt "雨后的未来城市街道，霓虹倒映地面，银色跑车缓慢驶过，电影级运镜" \
  --seconds 5 --aspect-ratio 16:9
```

#### 2）首尾帧控制（`keyframe`）

指定首帧和 / 或尾帧图片，让画面从指定姿态过渡到指定姿态。两者**至少给一个**。

```bash
node scripts/agnes_video.cjs --mode keyframe \
  --prompt "人物自然转身走向窗边，镜头缓慢推进并平滑过渡到尾帧" \
  --first-frame https://example.com/first.png \
  --last-frame  https://example.com/last.png
```

#### 3）图片 / 音频参考（`reference`）

用参考素材保持角色外观、美术风格或音色一致。提示词里可用 `<Picture N>`、`<Audio N>` 指代素材。

```bash
node scripts/agnes_video.cjs --mode reference \
  --prompt "以 <Picture 1> 中的角色和美术风格为参考，角色在花田中自然奔跑，保持外观一致" \
  --images https://example.com/character.png \
  --aspect-ratio 9:16
```

其他常用组合：

```bash
# 管道传入提示词
echo "一只小猫在草地上追蝴蝶" | node scripts/agnes_video.cjs --seconds 4

# 只打印将要发送的请求体，不发网络请求（无需 Key，排查用）
node scripts/agnes_video.cjs --prompt "test" --dry-run
```

---

## 三、参数说明

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--prompt` | 是 | 视频内容描述；`reference` 模式可用 `<Picture N>` / `<Audio N>` 指代素材。也可作为首个位置参数或用管道传入。用 `--video-id` 恢复任务时可省略 |
| `--mode` | 否 | `text`（文生视频，默认）/ `keyframe`（首尾帧）/ `reference`（图片或音频参考） |
| `--seconds` | 否 | 时长 `"4"`–`"12"`，默认 `"5"` |
| `--aspect-ratio` | 否 | `21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`，默认 `16:9`（`size` 固定 `720P`） |
| `--first-frame` | keyframe 条件 | 首帧图片 URL（与 `--last-frame` 至少一个） |
| `--last-frame` | keyframe 条件 | 尾帧图片 URL |
| `--images` | reference 条件 | 参考图 URL，逗号分隔，**最多 5 张** |
| `--audios` | reference 条件 | 参考音频 URL，逗号分隔，**最多 3 段** |
| `--seed` | 否 | 随机种子（`0` 也是合法值） |
| `--model` | 否 | 默认 `agnes-video-2.5-flash` |
| `--out` | 否 | 本地保存路径（`.mp4`）；缺省存到输出目录 |
| `--timeout` | 否 | 轮询超时秒数，默认 `900`（15 分钟） |
| `--video-id` | 否 | **跳过创建，直接接管 / 恢复一个已存在的任务**（轮询超时后原地续等用） |
| `--dry-run` | 否 | 只打印将要发送的请求体，不发网络请求 |
| `--json` | 否 | 以 JSON 输出结果 |
| `--help` | 否 | 显示帮助 |

### 模式规则

| mode | 用途 | 必需媒体 | 禁用的媒体字段 |
| --- | --- | --- | --- |
| `text` | 纯文本生成 | 无 | `first_frame`、`last_frame`、`images`、`audios`、`videos` |
| `keyframe` | 首帧 / 尾帧 / 首尾帧控制 | `first_frame` 与 `last_frame` 至少一个 | `images`、`audios`、`videos` |
| `reference` | 图片或音频参考 | `images` 或 `audios` 至少一类非空 | `first_frame`、`last_frame`、`videos` |

### Flash 版专属限制

- `size` **仅支持字符串 `"720P"`**，其他值返回 HTTP 400
- `reference` 模式：`images` 最多 **5 张**、`audios` 最多 **3 段**
- **不支持**参考视频（传入即返回 400）
- `n` 固定为 `1`

校验在创建 / 排队 / 计费 / 推理之前执行，**校验失败不会创建任务、不产生费用**。

---

## 四、画幅与输出尺寸

（`size` 固定 `720P`）

| aspect_ratio | 输出像素 |
| --- | --- |
| 21:9 | 1680x720 |
| 16:9 | 1280x704 |
| 4:3 | 960x720 |
| 1:1 | 720x720 |
| 3:4 | 720x960 |
| 9:16 | 720x1280 |

> 16:9 以实际生成文件为准；2026-09 实测 720P 输出为 1280x704。

---

## 五、长任务：轮询超时怎么续等

视频生成要排队 + 推理，**普通调用可能跑十几分钟，容易超过调用方（如 Agent 工具、CI）的单次执行时限**。脚本为此提供两步走：

```bash
# 第 1 步：已知要等很久就先加大超时；或让它跑到超时
node scripts/agnes_video.cjs --prompt "..." --timeout 1800 --out out.mp4

# 第 2 步：若第 1 步超时，用日志给出的 video_id 原地续等
#         （不会重复创建任务、不重复计费）
node scripts/agnes_video.cjs --video-id task_XXXXXXXX --timeout 1800 --out out.mp4
```

超时报错信息里会**直接给出一条可复制的续等命令**，照抄即可。

---

## 六、输出与错误处理

退出码：**0 = 成功 / 1 = 运行失败 / 2 = 参数错误**

- 默认输出人类可读摘要（含视频 URL 与本地路径）；任务 ID 与进度提示走 stderr
- 加 `--json` 时输出单行 JSON：
  - 成功：`{"ok":true,"code":"OK","model":"...","video_id":"...","url":"...","local_path":"..."}`
  - 失败：`{"ok":false,"code":1,"error":"..."}`

| code | 含义 | 常见原因与处理 |
| --- | --- | --- |
| `2` | 参数错误 | `mode`/`seconds`/`aspect-ratio` 非法、参考图超 5 张、keyframe 未给帧、缺少 `--prompt` |
| `MISSING_KEY`(1) | 未找到 API Key | 按第一节四种方式之一配置 Key |
| `NETWORK`(1) | 网络请求失败 | 已自动重试 2 次仍失败；检查网络或代理 |
| `API_ERROR`(1) | 服务端返回错误 | 附 HTTP 状态码；401 = Key 失效，404 = video_id 不存在 |
| `TASK_FAILED`(1) | 任务生成失败 | 附服务端原因；可调整提示词或参考素材后重试 |
| `POLL_TIMEOUT`(1) | 轮询超时 | **任务可能仍在跑**，用日志给出的 `--video-id` 命令续等 |
| `EMPTY_RESULT`(1) | 完成但无视频地址 | 罕见，附原始返回体便于排查 |
| `IO_ERROR`(1) | 视频下载失败 | 已自动重试；检查磁盘空间与网络 |

**可恢复错误自动重试**：网络抖动、`5xx`、`429`（限频）、`408` 都会退避重试而非直接失败 —— 视频轮询场景下 `429` 很常见，遇到不会中断任务。

---

## 七、适用边界

**适合**：文生视频、图生视频、首尾帧运镜控制、参考图 / 音频保持一致性。

**不适合**：

- **参考视频输入**（Flash 版不支持 `videos`，传入即 400）
- **本地文件直接当参考素材**（必须先把图片 / 音频上传到可公开访问的 HTTPS）
- **对字幕、剪辑、配乐有要求的成片**（本技能只产出原始视频片段，后期请用剪辑工具）
- **静态图像生成**（请改用「Agnes图像生成」技能）

---

## 八、常见问题

**Q：为什么本地图片不能当参考素材？**
Agnes 服务端需要主动拉取参考素材，因此必须是**可公开访问的 HTTPS 链接**，且在任务完成前保持有效。本地路径无法直接使用，请先上传到图床 / 对象存储。

**Q：一直提示「查询过于频繁 (429)」？**
这是平台限频，脚本会**自动退避重试**，通常无需干预。若长时间持续，适当加大 `--timeout` 或稍后再跑。

**Q：任务超时了，钱白花了吗？**
不会。任务在服务端继续执行，用日志给出的 `--video-id` 续等即可拿回结果，**不会重复创建、不重复计费**。

**Q：查询任务为什么要带 `model_name`？**
不带 `model_name` 的纯 `video_id` 查询**仅适用于 `text` 模式**。脚本已自动带上 `model_name=agnes-video-2.5-flash`，无需手动处理。

**Q：能一次生成多段视频吗？**
脚本一次产出一段。需要多段时并发调用多次即可。

---

## 九、参考文档

- 官方 API 细节（端点、参数、错误码、计费）：见 [`references/api.md`](references/api.md)
- 完整技能说明（供 Agent 调用）：见 [`SKILL.md`](SKILL.md)
- 需要静态图片生成：见同级技能「Agnes图像生成」（`~/.workbuddy/skills/Agnes图像生成/`）
