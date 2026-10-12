# 定点 iOS · 实验版

独立 SwiftUI / MapKit 客户端，面向 iPhone 16 及后续机型、iOS 27+，使用本机 Remote Pairing → LocalDevVPN → RSD / DVT LocationSimulation 调用开发调试定位服务。代码没有锁定某个 iPhone 型号，也没有修改第三方 App 或隐藏模拟位置标记。

**当前仅能确认构建与本地逻辑，未完成 iPhone 实机验证，不能承诺首次配置和日常使用均无需电脑。** 本机配对需要 iOS 27 的系统功能；若设备开发者服务 / 镜像尚未准备，当前实现会报错，可能仍需电脑。没有做自动镜像下载或挂载。它不是普通网页修改整机定位，也不是可从 App Store 直接安装的产品。

## 构建和签名

在项目根目录执行 `./build-ios.sh`。脚本校验固定版本的原生依赖，使用 Xcode 生成 `dist/定点-iOS-实验版-未签名.ipa`。未签名 IPA 不能直接点击安装，也未发布到当前 v1.1.0 Release。

在 Xcode 打开 `ios/DingDian.xcodeproj`，选自己的 Development Team 和签名设置；或用已有合法的侧载签名工具签名。个人 Team 可写入被 Git 忽略的 `ios/Signing.xcconfig`：

```xcconfig
DEVELOPMENT_TEAM = 你的TeamID
```

不要提交证书、描述文件、Apple 账号、配对凭据或 PIN。免费签名的有效期、刷新和首次侧载条件由所用工具与 Apple 账户决定；本项目没有实现无电脑签名安装或签名续期。iOS 更新也需沿用相同应用标识和签名覆盖安装新 IPA，Android 的更新清单不能用于 iOS 安装。

## 手机端配置

1. 安装已签名的实验包，手动开启开发者模式，允许本地网络和通知；本机配对阶段连接 Wi-Fi。
2. 安装并连接 [LocalDevVPN](https://github.com/jkcoxson/LocalDevVPN)。本项目不包含 VPN 扩展，不会修改已有 VPN 配置；需要用户自行管理连接。
3. 定点 → 设备设置 → 开始配对；在系统“隐私与安全性 → 开发者模式 → Pair with Host”中选择“定点 iOS”，按系统提示输入锁屏密码和六位验证码。PIN 不写日志，配对记录仅保存在设备受保护目录并排除备份。
4. 返回选点或搜索，点击应用位置。指令成功只表示开发者协议调用成功，请在 Apple 地图核对系统实际位置。
5. 结束后点击恢复真实定位，再核对真实位置；恢复失败会保留记录。进程重启不自动重放坐标，需先恢复旧会话。

启动链接：`dingdian-ios://open`，仅打开控制页，不接受坐标、设置或恢复指令。链接解析拒绝查询参数、用户信息、端口、片段与额外路径。

## 实机验收（全部尚未完成）

- [ ] iPhone 16 / 17 / 更新机型在实际 iOS 27.x 上完成签名安装与链接唤起
- [ ] 从未用电脑准备的手机：开发者模式、本机配对、DVT 服务可用
- [ ] LocalDevVPN 连接下设置、换点和恢复，并用 Apple 地图观察结果
- [ ] 无 USB、仅 Wi-Fi；蜂窝建连；网络切换；其他 VPN 共存
- [ ] 切后台、锁屏、进程终止、手机重启后的状态与恢复
- [ ] 恢复失败后保留数据，重试恢复；覆盖更新保留配对和恢复记录

切换工具前先恢复旧工具的定位，同一时间只使用一个模拟定位工具。

客户端仅在系统允许执行时每 4 秒重发已应用坐标；未申请后台音频等保活能力，不保证长期后台定位保持。地图与地名搜索使用 Apple 服务，需网络；输入坐标在本机解析。定位变化不改变网络出口 IP，也不能保证每个目标 App 都采用模拟位置。

## 依赖与来源

连接、配对和受保护存储适配自 MIT 项目 [Aurora Location](https://github.com/AuroraNest/Aurora-Location)，固定提交 `e475b071ef092090e459836d1c4c48bc89f490b8`，保留 [原许可证](LICENSE.Aurora.txt)。没有采用该项目的路线、蜂窝快捷指令、Shadowrocket 中继或 VPN 扩展。

底层使用 MIT [idevice](https://github.com/jkcoxson/idevice)，上游提交 `e98264c4194e6980173c576ac79a58adce95492b`，搭配 Aurora 的固定补丁。`Vendor/idevice/` 保留头文件、补丁、Cargo.lock、来源和依赖许可证；应用内包含 `THIRD_PARTY_LICENSES.txt`。57 MB 静态库不加入 Git，由 `scripts/fetch-ios-dependency.sh` 按提交下载并验证 SHA-256 与头文件匹配。重建输入见 [SOURCE.md](Vendor/idevice/SOURCE.md)；本项目 Swift 改动不改变该 ABI。

Android 与 iOS 的版本和构建号统一来自 `android/app/build.gradle`，iOS 构建脚本会同步生成项目设置。

新增 Swift 源文件后运行 `python3 scripts/generate-ios-project.py` 更新 Xcode 项目。协议调用集中在串行队列，FFI 句柄按依赖逆序释放；错误后不无限自动重连。设置前保存恢复意图，恢复指令成功后才删除记录。

本地逻辑检查（不需要 iPhone，不代表协议验收）：

```sh
mkdir -p .tools/ios-tests
xcrun swiftc ios/DingDian/LocationModels.swift ios/DingDian/RecoveryJournal.swift ios/Tests/LocationModelsTests.swift -o .tools/ios-tests/location-models
.tools/ios-tests/location-models
```

准备双平台 Release 文件：`python3 scripts/prepare-release.py --with-ios`；附带 Mac 包再加 `--with-mac`。脚本会验证两端版本与构建号一致，把未签名实验 IPA 加入文件摘要；Android 更新清单仍只引用 APK。它只准备文件，不会提交或发布，IPA 仍需用户自行签名安装。
