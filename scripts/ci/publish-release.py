"""Publish only a complete, verified bundle; leave failures as an unpublished draft."""
import argparse
import hashlib
import json
import mimetypes
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from artifacts import check_release, version

REPOSITORY = 'Yuanmy621/IP-change'
API = f'https://api.github.com/repos/{REPOSITORY}'


def api(method, url, data=None, mime='application/json'):
    request = urllib.request.Request(url, method=method, data=data, headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': mime,
        'User-Agent': 'DingDian-Release',
    })
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)


def lookup(url):
    try:
        return api('GET', url)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    assets = check_release(args.folder)
    name, _ = version()
    tag = 'v' + name
    notes = (args.folder / 'release-notes.md').read_text()
    notes += '\n\niOS 附件为未签名实验包，需自行签名侧载，尚未完成 iPhone 实机验证。\n'
    if args.dry_run:
        print('仅校验，不创建标签或发布：', tag, ', '.join(sorted(assets)))
        return
    if os.environ.get('GITHUB_REF') != 'refs/heads/main' or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise ValueError('发布只允许由本仓库 main 的 Actions 工作流执行')
    commit = os.environ['GITHUB_SHA']
    if lookup(API + '/releases/tags/' + tag) is not None:
        raise ValueError('该版本已有 Release，拒绝覆盖或修改旧附件')
    ref = lookup(API + '/git/ref/tags/' + tag)
    if ref is not None:
        target = ref['object']
        while target['type'] == 'tag':
            target = api('GET', target['url'])['object']
        if target['type'] != 'commit' or target['sha'] != commit:
            raise ValueError('现有版本标签不对应本次已验证提交')
    release = api('POST', API + '/releases', json.dumps({
        'tag_name': tag, 'target_commitish': commit,
        'name': '定点 ' + tag, 'body': notes, 'draft': True, 'prerelease': False,
    }).encode())
    upload = release['upload_url'].split('{', 1)[0]
    for filename in sorted(assets):
        data = (args.folder / filename).read_bytes()
        asset = api('POST', upload + '?' + urllib.parse.urlencode({'name': filename}), data,
                    mimetypes.guess_type(filename)[0] or 'application/octet-stream')
        if asset.get('state') != 'uploaded' or asset.get('size') != len(data) or asset.get('digest') != 'sha256:' + hashlib.sha256(data).hexdigest():
            raise ValueError('远端附件校验失败，保留草稿：' + filename)
    remote = api('GET', release['url'])
    if {asset['name'] for asset in remote['assets']} != assets:
        raise ValueError('远端附件不完整，保留草稿')
    published = api('PATCH', release['url'], json.dumps({'draft': False, 'make_latest': 'true'}).encode())
    if published['draft'] or published['prerelease']:
        raise ValueError('Release 没有成为正式发布')
    latest = api('GET', API + '/releases/latest')
    if latest['id'] != release['id']:
        raise ValueError('最新 Release 没有指向本次发布')
    print('已发布并核对所有附件：', published['html_url'])


if __name__ == '__main__':
    main()
