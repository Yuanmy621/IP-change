"""Release/build invariants shared by CI and the publishing workflow."""
import argparse
import hashlib
import json
import plistlib
import re
import stat
import struct
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def version(root=ROOT):
    config = (root / 'android/app/build.gradle').read_text()
    name = re.search(r"versionName '([^']+)'", config).group(1)
    code = int(re.search(r'versionCode (\d+)', config).group(1))
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', name) or code < 1:
        raise ValueError('版本必须为正式 x.y.z，构建号必须为正整数')
    return name, code


def check_apk(apk, root=ROOT):
    with zipfile.ZipFile(apk) as bundle:
        if bundle.testzip() is not None:
            raise ValueError('APK 压缩数据损坏')
        for file in (root / 'web').rglob('*'):
            if file.is_file() and bundle.read('assets/' + file.relative_to(root / 'web').as_posix()) != file.read_bytes():
                raise ValueError(f'APK 网页资源与源码不同：{file.name}')


def check_ipa(ipa, root=ROOT):
    name, code = version(root)
    with zipfile.ZipFile(ipa) as bundle:
        if bundle.testzip() is not None:
            raise ValueError('IPA 压缩数据损坏')
        info = plistlib.loads(bundle.read('Payload/DingDian.app/Info.plist'))
        if (info.get('CFBundleIdentifier'), info.get('CFBundleShortVersionString'), info.get('CFBundleVersion')) != ('com.yuanmy.dingdian.ios', name, str(code)):
            raise ValueError('IPA 标识、版本或构建号与源码不同')
        if any('/_CodeSignature/' in file or file.endswith('embedded.mobileprovision') for file in bundle.namelist()):
            raise ValueError('实验 IPA 不应包含个人签名或描述文件')


def check_macos(archive, name):
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise ValueError('Mac 压缩数据损坏')
        prefix = f'DingDian-{name}-macos/'
        for file in ['定点-Apple芯片', '定点-Intel芯片', '启动定点.command', 'platform-tools/adb']:
            info = bundle.getinfo(prefix + file)
            if not stat.S_IMODE(info.external_attr >> 16) & 0o111:
                raise ValueError(f'Mac 文件没有执行权限：{file}')
        for file, cpu in [('定点-Apple芯片', 0x0100000c), ('定点-Intel芯片', 0x01000007)]:
            header = bundle.read(prefix + file)[:8]
            if len(header) != 8 or struct.unpack('<II', header) != (0xfeedfacf, cpu):
                raise ValueError(f'Mac 程序架构不正确：{file}')
        for file in bundle.namelist():
            if '/.runtime/' in file or file.endswith(('.keystore', '.jks', '.mobileprovision', '.p12', 'Signing.xcconfig')):
                raise ValueError('Mac 包包含私有配置或签名文件')


def check_release(folder, root=ROOT):
    name, code = version(root)
    apk_name = f'dingdian-{name}-android.apk'
    ipa_name = f'dingdian-{name}-ios-experimental-unsigned.ipa'
    mac_name = f'dingdian-{name}-macos.zip'
    expected = {apk_name, ipa_name, mac_name, 'update.json'}
    checksums = {}
    for line in (folder / 'SHA256SUMS.txt').read_text().splitlines():
        digest, filename = line.split('  ', 1)
        if filename in checksums or filename not in expected or not re.fullmatch('[a-f0-9]{64}', digest):
            raise ValueError('文件摘要清单包含重复或未知文件')
        checksums[filename] = digest
    if set(checksums) != expected:
        raise ValueError('发布附件不完整')
    for filename, digest in checksums.items():
        if hashlib.sha256((folder / filename).read_bytes()).hexdigest() != digest:
            raise ValueError(f'文件摘要不一致：{filename}')
    manifest = json.loads((folder / 'update.json').read_text())
    apk = folder / apk_name
    if (manifest.get('schema'), manifest.get('packageName'), manifest.get('versionName'), manifest.get('versionCode'), manifest.get('minSdk')) != (1, 'com.yuanmy.dingdian', name, code, 28):
        raise ValueError('更新清单与源码版本不一致')
    if manifest.get('sha256') != checksums[apk_name] or manifest.get('size') != apk.stat().st_size:
        raise ValueError('更新清单的 APK 大小或摘要不一致')
    if manifest.get('apkUrl') != f'https://github.com/Yuanmy621/IP-change/releases/download/v{name}/{apk_name}':
        raise ValueError('更新清单下载地址不匹配')
    check_apk(apk, root)
    check_ipa(folder / ipa_name, root)
    check_macos(folder / mac_name, name)
    return expected | {'SHA256SUMS.txt'}


def check_upgrade(requested, latest, root=ROOT):
    name, code = version(root)
    if requested != name:
        raise ValueError('发布输入版本与源码不一致')
    if type(latest.get('versionCode')) is not int or code <= latest['versionCode']:
        raise ValueError('构建号必须高于当前公开版本')
    previous = latest.get('versionName', '')
    if not re.fullmatch(r'\d+\.\d+\.\d+', previous) or tuple(map(int, name.split('.'))) <= tuple(map(int, previous.split('.'))):
        raise ValueError('版本号必须高于当前公开版本')
    changelog = (root / 'CHANGELOG.md').read_text()
    section = re.search(r'^## v' + re.escape(name) + r'([^\n]*)\n(.+?)(?=^## |\Z)', changelog, re.M | re.S)
    if not section or any(word in section[1] for word in ['未发布', '开发中']):
        raise ValueError('缺少正式版本说明')
    return name, code


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path)
    parser.add_argument('--ipa', type=Path)
    parser.add_argument('--release', type=Path)
    args = parser.parse_args()
    if not any([args.apk, args.ipa, args.release]):
        parser.error('需要指定构建或发布附件')
    if args.apk:
        check_apk(args.apk)
    if args.ipa:
        check_ipa(args.ipa)
    if args.release:
        check_release(args.release)
    print('构建/发布附件一致性校验通过')
