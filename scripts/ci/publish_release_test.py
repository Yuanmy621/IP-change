import hashlib
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publish_release', Path(__file__).with_name('publish-release.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublishReleaseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        (self.folder / 'app.apk').write_bytes(b'verified apk')
        (self.folder / 'release-notes.md').write_text('本次改动')
        self.calls = []
        self.addCleanup(patch.stopall)
        patch.object(publisher, 'check_release', return_value={'app.apk'}).start()
        patch.object(publisher, 'version', return_value=('1.3.0', 5)).start()
        patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main', 'GITHUB_REPOSITORY': 'Yuanmy621/IP-change', 'GITHUB_SHA': 'a' * 40}).start()
        patch('sys.argv', ['publish-release.py', str(self.folder)]).start()

    def fake_api(self, method, url, data=None, mime=None, bad_digest=False):
        self.calls.append(method)
        if method == 'POST' and url.endswith('/releases'):
            return {'id': 8, 'url': 'https://api.github.com/releases/8', 'upload_url': 'https://uploads.github.com/releases/8/assets{?name}'}
        if method == 'POST':
            return {'state': 'uploaded', 'size': len(data), 'digest': 'sha256:' + ('0' * 64 if bad_digest else hashlib.sha256(data).hexdigest())}
        if method == 'PATCH':
            return {'draft': False, 'prerelease': False, 'html_url': 'https://github.com/release/8'}
        if url.endswith('/latest'):
            return {'id': 8}
        return {'assets': [{'name': 'app.apk'}]}

    def test_all_verified_assets_are_uploaded_before_publishing(self):
        with patch.object(publisher, 'lookup', return_value=None), patch.object(publisher, 'api', side_effect=self.fake_api):
            publisher.main()
        self.assertEqual(['POST', 'POST', 'GET', 'PATCH', 'GET'], self.calls)

    def test_bad_remote_digest_never_publishes_the_draft(self):
        with patch.object(publisher, 'lookup', return_value=None), patch.object(publisher, 'api', side_effect=lambda *args: self.fake_api(*args, bad_digest=True)):
            with self.assertRaisesRegex(ValueError, '保留草稿'):
                publisher.main()
        self.assertNotIn('PATCH', self.calls)

    def test_existing_release_or_wrong_tag_cannot_be_overwritten(self):
        with patch.object(publisher, 'lookup', return_value={'id': 7}), patch.object(publisher, 'api') as api:
            with self.assertRaisesRegex(ValueError, '拒绝覆盖'):
                publisher.main()
            api.assert_not_called()
        with patch.object(publisher, 'lookup', side_effect=[None, {'object': {'type': 'commit', 'sha': 'b' * 40}}]), patch.object(publisher, 'api') as api:
            with self.assertRaisesRegex(ValueError, '标签'):
                publisher.main()
            api.assert_not_called()

    def test_feature_branch_cannot_publish(self):
        with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/feature'}), patch.object(publisher, 'api') as api:
            with self.assertRaisesRegex(ValueError, 'main'):
                publisher.main()
            api.assert_not_called()


if __name__ == '__main__':
    unittest.main()
