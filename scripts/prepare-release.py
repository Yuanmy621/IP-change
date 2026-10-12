#!/usr/bin/env python3
"""Build and prepare GitHub Release assets, without committing or publishing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
REPO = "https://github.com/Yuanmy621/IP-change"


def run(*args, capture=False, env=None):
    return subprocess.run(args, cwd=ROOT, env=env, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def notes_for(version):
    changelog = (ROOT / "CHANGELOG.md").read_text()
    match = re.search(r"^## v" + re.escape(version) + r"[^\n]*\n(.*?)(?=^## |\Z)", changelog, re.M | re.S)
    if not match:
        raise ValueError(f"CHANGELOG.md 中缺少 v{version} 版本说明")
    return match.group(1).strip()


def prepare(skip_build=False, with_mac=False):
    if not skip_build:
        run("./build-android.sh")
    sdk = Path(os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME") or ROOT / ".tools/android-sdk")
    tools = sorted((sdk / "build-tools").glob("*"), key=lambda p: tuple(int(n) for n in p.name.split(".") if n.isdigit()))
    if not tools:
        raise ValueError("未找到 Android SDK build-tools，请设置 ANDROID_SDK_ROOT")
    tool = tools[-1]
    environment = os.environ.copy()
    if not environment.get("JAVA_HOME") and (ROOT / ".tools/java-home.txt").exists():
        environment["JAVA_HOME"] = (ROOT / ".tools/java-home.txt").read_text().strip()
    apk = ROOT / "dist/定点-Android.apk"
    info = run(str(tool / "aapt"), "dump", "badging", str(apk), capture=True, env=environment)
    package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", info)
    minimum = re.search(r"sdkVersion:'(\d+)'", info)
    if not package or not minimum or package[1] != "com.yuanmy.dingdian":
        raise ValueError("APK 包名或版本信息不正确")
    version = package[3]
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("仅准备 x.y.z 格式的正式版本")
    signature = run(str(tool / "apksigner"), "verify", "--print-certs", str(apk), capture=True, env=environment)
    digests = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([a-f0-9]+)", signature)
    expected = (ROOT / "android/update-signing.sha256").read_text().strip()
    if digests != [expected]:
        raise ValueError("APK 签名与已发布版本不同。请使用原签名密钥构建，不要替换证书摘要绕过检查。")
    notes = notes_for(version)
    output = ROOT / f"dist/release-{version}"
    output.mkdir(parents=True, exist_ok=True)
    filename = f"dingdian-{version}-android.apk"
    shutil.copy2(apk, output / filename)
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    manifest = {
        "schema": 1, "packageName": package[1], "versionName": version,
        "versionCode": int(package[2]), "minSdk": int(minimum[1]),
        "apkUrl": f"{REPO}/releases/download/v{version}/{filename}",
        "size": apk.stat().st_size, "sha256": digest, "notes": notes,
    }
    (output / "update.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    assets = [filename, "update.json"]
    if with_mac:
        if not skip_build:
            run("./build.sh")
        folder = output / f"DingDian-{version}-macos"
        folder.mkdir(exist_ok=True)
        for name in ["定点-Apple芯片", "定点-Intel芯片", "启动定点.command", "README.md", "CHANGELOG.md"]:
            shutil.copy2(ROOT / name, folder / name)
        shutil.copytree(ROOT / "platform-tools", folder / "platform-tools", dirs_exist_ok=True)
        archive = f"dingdian-{version}-macos.zip"
        with zipfile.ZipFile(output / archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for file in sorted(folder.rglob("*")):
                if file.is_file():
                    bundle.write(file, file.relative_to(output))
        assets.append(archive)
    (output / "SHA256SUMS.txt").write_text("".join(
        f"{hashlib.sha256((output / name).read_bytes()).hexdigest()}  {name}\n" for name in assets))
    # Keep release notes separate; only the files listed below are download assets.
    (output / "release-notes.md").write_text(notes + "\n")
    print(f"\n已准备 v{version}（versionCode {package[2]}），尚未发布：{output}")
    print("上传文件：" + ", ".join(assets + ["SHA256SUMS.txt"]))
    print("在 GitHub 发布为正式版本并设为 Latest；update.json 与 APK 必须属于同一个 v" + version + " Release。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-build", action="store_true", help="复用已构建的 APK；仍验证签名")
    parser.add_argument("--with-mac", action="store_true", help="同时构建并打包 Mac 版（需要 Go 与 platform-tools）")
    args = parser.parse_args()
    prepare(args.skip_build, args.with_mac)
