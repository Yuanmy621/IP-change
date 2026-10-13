# 合并校验与发布流程

`main` 的改动通过 Pull Request 合并。必需状态检查名称为 **功能完整性校验**，并要求来源分支同步最新 main、解决全部评审讨论，禁止强推及删除；规则对管理员同样生效。个人仓库不强制另一位评审者批准，以免作者自己的 PR 永远无法合并。

## 自动验证

| 校验 | 内容 |
| --- | --- |
| Go 与前端 | Go vet、race 测试、两种 Mac 架构构建、前端坐标/搜索/地图加载单测、UI 资源重新构建一致性、发布包规则回归 |
| 浏览器功能回归 | 手机和桌面尺寸：空坐标保护、坐标搜索、应用/恢复、迟到定位、地图源切换、主题与收藏持久化、更新安装保护 |
| Android 构建与测试 | JVM 回归、Lint、APK 与测试 APK 构建、APK 内网页资源与源码一致性 |
| Android 模拟器 | 两端分别实际运行 4 项测试。API 28 验证旧版原生 GPS/网络定位接口、服务刷新、换点与恢复；API 36 验证公开链接、WebView 操作、后台刷新与恢复 |
| iOS 构建与逻辑校验 | Swift 坐标/链接/恢复记录测试、生成项目一致性、arm64 未签名 IPA 构建与版本校验 |

CI 在 PR、main 提交、合并队列以及手动触发时执行；不按文件路径跳过。汇总检查使用 `always()`，任何依赖失败、取消或跳过都失败，不能以跳过测试满足保护规则。PR 检查只读仓库权限，不使用发布密钥，也不自动发布。

浏览器使用隔离预览进程与网络夹具，不依赖高德、OSM、地名服务的在线状态。模拟器注入只允许 `emulator-*` 设备，拒绝真实手机。CI 产物保留 7 天供排查，不是可覆盖旧版的正式安装包。

网页组件的打包目标为 Chrome 111；Android 9 系统镜像附带的旧 WebView 不支持当前网页语法，因此该镜像使用原生流程测试。旧 Android 手机需安装支持该目标的新版系统 WebView；CI 不将旧镜像的原生校验当作网页兼容验证。

“完整性”指上述已定义的自动回归范围，不能证明所有手机、厂商后台策略或目标 App 的实际定位表现；iOS 配对及 DVT 协议仍需 iPhone 实机验收。新增功能需扩展对应测试，PR 模板提供实机验证记录入口。

## Release 自动发布

1. 在开发分支递增 `android/app/build.gradle` 的 `versionName` 和 `versionCode`，在 `CHANGELOG.md` 写正式版本记录，通过 CI 后合并到 main。
2. 在 GitHub **Actions → Release → Run workflow**，选择 `main`，填写与源码一致的版本号（例如 `1.3.0`）。
3. 流程核对最新公开更新清单，拒绝版本倒退、构建号复用或“开发中”记录；重新执行完整 CI 后再开始签名构建。
4. 使用原 Android 密钥构建，并与 `android/update-signing.sha256` 的公开证书摘要比较。自动打包两种 Mac 程序、ADB、未签名 iOS 实验 IPA，以及 `update.json` 和 `SHA256SUMS.txt`。
5. 校验所有附件后创建草稿，上传五个下载文件，核对 GitHub 的文件大小与 SHA-256；全部成功才发布并设为 Latest。失败保留草稿，不更新手机的最新下载入口，也不覆盖已有 Release。

main 合并只验证和生成 CI 产物，不会直接为已有 `v1.2.0` 再次发布。手动启动 Release 是明确的发布动作，不需要提交个人 GitHub Token。

## 首次配置发布签名

仓库管理员需在 **Settings → Secrets and variables → Actions** 配置以下四个 Secret，使用与当前已安装 APK 相同的原密钥：

| Secret | 内容 |
| --- | --- |
| `DINGDIAN_ANDROID_KEYSTORE_BASE64` | 原 keystore 文件的 Base64 内容 |
| `DINGDIAN_ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `DINGDIAN_ANDROID_KEY_ALIAS` | 原签名的 alias |
| `DINGDIAN_ANDROID_KEY_PASSWORD` | 原私钥密码 |

当前旧版沿用本机 Android 调试密钥，一般位于 `~/.android/debug.keystore`，默认 alias 为 `androiddebugkey`，默认两项密码均为 `android`。以实际原密钥为准，不能用新生成的调试密钥替代。密钥只在签名 job 的临时目录出现，完成或失败后清理，不加入日志和下载产物。

本次配置流程不会自动读取或上传个人私钥。未配置 Secret 时发布流程会明确失败；CI 合并验证照常工作。若不希望将密钥放在 GitHub，可继续本地运行 `prepare-release.py`，手动上传经校验的附件。

## 本地验证

```sh
npm ci
npx playwright install --only-shell chromium
npm test
npm run test:e2e
python3 -m unittest discover -s scripts/ci -p '*_test.py' -v
go test -race ./...
```

Android 测试与 iOS 构建继续使用 README 中的命令。运行 `scripts/ci/android-device.py` 会要求唯一的模拟器；不要用它验证个人手机。已构建完整发布包可执行：

```sh
python3 scripts/ci/artifacts.py --release dist/release-1.2.0
python3 scripts/ci/publish-release.py dist/release-1.2.0 --dry-run
```

参考：[GitHub 必需状态检查](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)、[保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)、[Playwright CI](https://playwright.dev/docs/ci-intro)。
