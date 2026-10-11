# 定点 · Mac 本地 Android 模拟定位工具

通过 Mac 上的本地网页，将选定的 WGS84 经纬度提交给 Android 测试定位接口。手机无需安装本工具的 App；无需 Root。该工具控制的是位置坐标，不改变网络出口 IP。

## 开始使用

1. 用支持数据传输的 USB 线把 Redmi K80 连接到 Mac。
2. 在手机设置中开启开发者选项、USB 调试和位置信息。HyperOS 的菜单名称可能随版本不同；可在设置中搜索“USB 调试”。
3. 解锁手机，在 USB 调试授权提示中允许此电脑。
4. 双击本文件夹里的 **`启动定点.command`**。它会自动选择 Apple 芯片或 Intel 版本，并打开浏览器。
5. 网页显示“已连接”后，点击“检查系统兼容性”。接口存在仅代表可以进一步尝试，不代表已经验证注入权限。
6. 输入经纬度或在地图上选点，点击“应用位置”。在手机上的目标 App 中核对实际定位。
7. 拔线前点击 **“恢复真实定位”**，或点击页面底部的 **“恢复定位并退出工具”**。

电脑只需要启动一次程序；使用期间保持程序运行和手机连接。关闭网页不会停止后台工具。Mac 休眠、关机或断开手机后，坐标无法继续刷新。

本机网页地址是 `http://127.0.0.1:8765`。启动器打开的页面带有一次性会话凭证，请优先使用自动打开的页面。同一浏览器标签页刷新会保留凭证；另一个浏览器或新的标签页可能需要重新启动工具打开。

## Redmi K80 兼容性

目前尚未在你的 Redmi K80 真机上验证。

- 程序会检测手机是否已授权、系统是否提供测试定位接口、位置信息开关是否开启。
- 应用位置时会尝试允许 ADB shell 的模拟定位权限，并核对权限是否生效。HyperOS 拒绝权限或命令时，会显示实际错误并尝试回滚。
- 默认模拟 `gps`。勾选“同时模拟网络定位”后会同时模拟 `network`；更换定位源前需先恢复。
- 系统会给测试坐标添加模拟位置标记。部分 App 使用其他融合定位服务、网络信息或缓存，或者拒绝模拟位置。命令成功不代表每个 App 都改变了位置。
- 工具不会绕过 App 的模拟定位检测，也不修改 HyperOS 系统文件。

## 地图和坐标

地图使用 Leaflet 和 OpenStreetMap，地图瓦片需要网络。网络不可用时仍可手动输入坐标和操作定位。

坐标按 **WGS84** 处理。直接复制高德的 GCJ-02 坐标或百度的 BD-09 坐标会产生偏移，请先转换。北京、上海、广州按钮是城市参考点。

收藏保存在当前浏览器本地。最多保留 8 个坐标，按住 Option 点击收藏按钮可删除该收藏。

## 恢复和异常退出

- 正常恢复会移除本工具创建的测试定位源，再还原启动前的 ADB 模拟定位权限。
- 工具不会主动修改手机的全局位置信息开关。
- 断线导致恢复失败时，`.runtime/session.json` 会保留恢复记录。重新连接同一手机、重新启动工具，再点击“恢复真实定位”。完成恢复前不允许开启新的会话。
- 点击“恢复定位并退出工具”时，如果手机未能恢复，程序会保持运行并提示重试。
- 在终端按 Control+C 或收到正常终止信号时，程序也会尝试恢复。强制结束进程、拔线、Mac 断电无法保证即时恢复。
- 真实位置重新显示可能需要等待下一次系统定位；请在手机上实际确认。
- 不要在待恢复时删除 `.runtime` 文件夹。它记录了本工具应清理的定位源和原有权限。
- 不建议同时运行其他模拟定位工具。程序会拒绝已检测到的现有模拟定位源。

如果 macOS 阻止打开下载的程序，可在 Finder 中按系统提示使用“打开”或在“隐私与安全性”中允许。这里生成的程序没有 Apple 开发者签名或公证。

## 本地控制

服务只监听 `127.0.0.1`，使用随机会话凭证验证接口，并检查 Host 和 Origin。无需账号、云服务器或数据库。

网页 API：

| 接口 | 作用 |
| --- | --- |
| `GET /api/status` | 设备和当前会话状态 |
| `POST /api/probe` | 读取手机版本并检查接口 |
| `POST /api/location/set` | 应用坐标并每 2 秒刷新 |
| `POST /api/location/reset` | 清理模拟定位并还原权限 |
| `POST /api/shutdown` | 恢复成功后退出工具 |

位置请求示例：

```json
{"serial":"设备序列号","latitude":31.2304,"longitude":121.4737,"network":false}
```

调用 API 需要当前会话的 `X-Session-Token` 请求头，以及写入请求的 `Content-Type: application/json`。手机浏览器无法直接访问这个仅监听 Mac 回环地址的页面；当前版本在 Mac 浏览器操作，通过 USB 控制手机。

## 开发与构建

服务端使用 Go 标准库，网页资源和 Leaflet 已嵌入二进制，运行时无需 Go、Node 或 Android Studio。

安装 Go 1.23 或更新版本后运行：

```sh
./build.sh
go test -race ./...
```

命令行参数可指定其他端口、ADB 路径和恢复记录路径：

```sh
./定点-Apple芯片 --port 8765
./定点-Apple芯片 --adb /path/to/adb --no-open
```

`--no-open` 主要供开发和自动化测试使用。需要手动打开页面时可加 `--print-url`，在终端打印带凭证的本机地址；请只在本机使用，不对外分享。默认不会在终端打印会话凭证。

自动化验证覆盖输入校验、权限拒绝、部分初始化失败回滚、断线恢复、重启恢复、现有模拟定位保护以及接口访问限制。自动化测试使用模拟设备，不替代 Redmi K80 真机验证。

## 依赖来源

- [Android SDK Platform-Tools 官方下载](https://developer.android.com/tools/releases/platform-tools)：`platform-tools/`；第三方声明见 `platform-tools/NOTICE.txt`。
- [Android 测试定位命令源码](https://android.googlesource.com/platform/frameworks/base/+/android16-release/services/core/java/com/android/server/location/LocationShellCommand.java)。
- [Leaflet 1.9.4](https://leafletjs.com/download.html)：`web/vendor/`；许可证见 `web/vendor/Leaflet-LICENSE`。
- [OpenStreetMap](https://www.openstreetmap.org/copyright)：地图页面保留署名。
