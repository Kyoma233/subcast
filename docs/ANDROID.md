# Android 版

同一套界面和 Rust 后端，作为 Tauri 2 的安卓目标编译。手机上没有桌面那套外挂程序，所以有一部分能力换成了别的做法。

## 能用的

- 订阅 YouTube 频道 / Apple Podcasts / 小宇宙 / RSS，单集页、双语字幕、AI 导读、AI 问答、收藏、离线下载、金句海报。
- 字幕：官方字幕、别人分享的字幕（`transcribe` 先查共享库），没有就用**云端识别**（豆包 / 硅基流动 / Groq / OpenAI 等，在 设置 › 识别 里填 Key）。
- 模型 Key 存在应用私有目录 `files/keys/*.key`（0600），不再是系统钥匙串。
- 界面按手机重排：侧栏变成抽屉（左上角菜单键），字幕 / 精读 / 问答是全屏页，`退出字幕栏` 回播放页；适配状态栏与手势条的安全区。

## 换掉的

| 桌面 | 安卓 | 原因 |
|---|---|---|
| 本机 whisper.cpp（子进程） | 云端识别，或共享字幕 | 手机不允许 App 启动自己的子进程 |
| 本机 Qwen3-ASR（CrispASR 程序） | 同上 | 同上，且下载的可执行文件不能 `exec` |
| yt-dlp 兜底播放 YouTube | 只用 InnerTube 官方轨道；失败时切「仅音频」 | 同上 |
| 系统钥匙串（keyring） | 应用私有文件 | 安卓没有对应钥匙串 |
| 界面热更新（`ota.rs`） | 随安装包更新 | 手机走应用商店 / APK 更新 |

## 构建

需要：Rust + `aarch64-linux-android` 目标、JDK 17、Android SDK（platform 36、build-tools 36、NDK 27）、Node 22。

```bash
export JAVA_HOME=<jdk17>
export ANDROID_HOME=<sdk>
export NDK_HOME=<sdk>/ndk/27.2.12479018

npx tauri android init          # 首次，生成 src-tauri/gen/android（已提交）
npx tauri android build --target aarch64 --apk
```

产物：`src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk`。

两点在 Windows 上会挡路：

- **项目路径必须是纯 ASCII**。路径里有中文时 `ld.lld` 会拿不到目标文件（`unspecified system_category error`），所以本机构建目录是 `D:\subcast`。
- **Tauri CLI 会把 `libsubcast_lib.so` 软链到 `jniLibs/`**，需要开发者模式。没开的话：cargo 编译完成后手动拷贝，再直接用 Gradle 出包：

```bash
cp src-tauri/target/aarch64-linux-android/release/libsubcast_lib.so \
   src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/
cd src-tauri/gen/android
./gradlew assembleRelease -x lint \
  -x rustBuildArmRelease -x rustBuildX86Release \
  -x rustBuildX86_64Release -x rustBuildArm64Release -x rustBuildUniversalRelease
```

## 签名

```bash
KEYSTORE_PASS=... apksigner sign \
  --ks subcast-release.jks --ks-key-alias subcast \
  --ks-pass env:KEYSTORE_PASS --key-pass env:KEYSTORE_PASS \
  --out SubCast-android-arm64.apk app-arm64-release-unsigned.apk
```

`compileSdk` / `targetSdk` 在 `src-tauri/gen/android/app/build.gradle.kts` 里，默认跟着 Tauri 模板（37）；本机装的是 platform 36，所以改成了 36。
