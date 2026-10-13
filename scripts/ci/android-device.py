"""Run the opt-in native location flow only on a disposable Android emulator."""
import re
import subprocess
import sys
from pathlib import Path


def run(*args):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120).stdout


def main():
    directory = Path(sys.argv[1])
    devices = run('adb', 'devices')
    serials = re.findall(r'^(emulator-\d+)\s+device$', devices, re.M)
    if len(serials) != 1 or re.search(r'^(?!emulator-|List of devices|\s*$)\S+\s+device$', devices, re.M):
        raise RuntimeError('只允许在单个 CI 模拟器上执行；禁止使用真实手机')
    adb = ['adb', '-s', serials[0]]
    for name in ['app-debug.apk', 'app-debug-androidTest.apk']:
        matches = list(directory.rglob(name))
        if len(matches) != 1:
            raise RuntimeError(f'未找到唯一的 {name}')
        print(run(*adb, 'install', '-r', str(matches[0])))
    package = 'com.yuanmy.dingdian'
    for permission in ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION']:
        run(*adb, 'shell', 'pm', 'grant', package, 'android.permission.' + permission)
    sdk = int(run(*adb, 'shell', 'getprop', 'ro.build.version.sdk').strip())
    if sdk >= 33:
        run(*adb, 'shell', 'pm', 'grant', package, 'android.permission.POST_NOTIFICATIONS')
    run(*adb, 'shell', 'settings', 'put', 'secure', 'location_mode', '3')
    run(*adb, 'shell', 'appops', 'set', package, 'android:mock_location', 'allow')
    output = run(*adb, 'shell', 'am', 'instrument', '-w', '-e', 'exerciseMock', 'true', '-e', 'class',
                 package + '.ControllerTest,' + package + '.PhoneFlowTest', package + '.test/android.test.InstrumentationTestRunner')
    folder = Path('dist/android-device')
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'instrumentation.txt').write_text(output)
    print(output)
    if not re.search(r'OK \(4 tests\)', output) or any(marker in output for marker in ['FAILURES!!!', 'INSTRUMENTATION_FAILED', 'Process crashed']):
        raise RuntimeError('模拟器必须实际执行并通过全部 4 项测试')


if __name__ == '__main__':
    main()
