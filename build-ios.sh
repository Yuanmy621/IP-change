#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 scripts/generate-ios-project.py
./scripts/fetch-ios-dependency.sh
xcodebuild -project ios/DingDian.xcodeproj -scheme DingDian -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build
mkdir -p dist/ios-unsigned/Payload
rm -rf dist/ios-unsigned/Payload/DingDian.app
cp -R ios/build/Build/Products/Release-iphoneos/DingDian.app dist/ios-unsigned/Payload/
rm -f dist/定点-iOS-实验版-未签名.ipa
(cd dist/ios-unsigned && /usr/bin/zip -q -r ../定点-iOS-实验版-未签名.ipa Payload)
printf '%s\n' '已生成 dist/定点-iOS-实验版-未签名.ipa。需自行签名侧载；未完成 iPhone 真机验证。'
