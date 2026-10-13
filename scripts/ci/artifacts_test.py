import hashlib
import json
import plistlib
import tempfile
import unittest
import zipfile
from pathlib import Path
from artifacts import check_apk, check_ipa, check_upgrade, check_release


class ArtifactsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'android/app').mkdir(parents=True)
        (self.root / 'android/app/build.gradle').write_text("versionName '1.3.0'\nversionCode 5\n")
        (self.root / 'CHANGELOG.md').write_text('## v1.3.0 · 2026-10-13\n\n- 新功能\n')
        (self.root / 'web').mkdir()
        (self.root / 'web/app.js').write_text('current();')

    def test_apk_must_include_exact_frontend_source(self):
        apk = self.root / 'app.apk'
        with zipfile.ZipFile(apk, 'w') as bundle:
            bundle.writestr('assets/app.js', 'current();')
        check_apk(apk, self.root)
        (self.root / 'web/app.js').write_text('changed();')
        with self.assertRaises(ValueError):
            check_apk(apk, self.root)

    def test_ipa_version_and_signing_are_checked(self):
        ipa = self.root / 'app.ipa'
        info = {'CFBundleIdentifier': 'com.yuanmy.dingdian.ios', 'CFBundleShortVersionString': '1.3.0', 'CFBundleVersion': '5'}
        with zipfile.ZipFile(ipa, 'w') as bundle:
            bundle.writestr('Payload/DingDian.app/Info.plist', plistlib.dumps(info))
        check_ipa(ipa, self.root)
        with zipfile.ZipFile(ipa, 'a') as bundle:
            bundle.writestr('Payload/DingDian.app/embedded.mobileprovision', 'personal')
        with self.assertRaises(ValueError):
            check_ipa(ipa, self.root)

    def test_rejects_downgrade_reused_code_and_wrong_input(self):
        for latest in [{'versionName': '1.3.0', 'versionCode': 4}, {'versionName': '1.2.0', 'versionCode': 5}, {'versionName': 'invalid', 'versionCode': 3}]:
            with self.assertRaises(ValueError):
                check_upgrade('1.3.0', latest, self.root)
        with self.assertRaises(ValueError):
            check_upgrade('1.4.0', {'versionName': '1.2.0', 'versionCode': 4}, self.root)
        self.assertEqual(('1.3.0', 5), check_upgrade('1.3.0', {'versionName': '1.2.0', 'versionCode': 4}, self.root))

    def test_unreleased_changelog_blocks_publishing(self):
        (self.root / 'CHANGELOG.md').write_text('## v1.3.0 · 开发中，未发布\n\n- 新功能\n')
        with self.assertRaises(ValueError):
            check_upgrade('1.3.0', {'versionName': '1.2.0', 'versionCode': 4}, self.root)

    def test_missing_duplicate_and_modified_release_assets_fail(self):
        folder = self.root / 'release'
        folder.mkdir()
        (folder / 'update.json').write_text('{}')
        digest = hashlib.sha256(b'{}').hexdigest()
        for lines in [f'{digest}  update.json\n', f'{digest}  update.json\n{digest}  update.json\n', f'{digest}  ../outside\n']:
            (folder / 'SHA256SUMS.txt').write_text(lines)
            with self.assertRaises(ValueError):
                check_release(folder, self.root)


if __name__ == '__main__':
    unittest.main()
