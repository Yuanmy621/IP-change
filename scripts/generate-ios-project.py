#!/usr/bin/env python3
"""Generate the small, dependency-free Xcode project from the iOS source tree."""
import hashlib
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "ios"
android_config = (root.parent / "android/app/build.gradle").read_text()
release_version = re.search(r"versionName '([^']+)'", android_config).group(1)
release_build = re.search(r"versionCode (\d+)", android_config).group(1)
objects = []
def ident(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def add(name, body):
    objects.append(f"{ident(name)} = {{ {body} }};")
    return ident(name)
def q(value):
    return json.dumps(value, ensure_ascii=False)
def ids(values):
    return "(" + ",".join(ident(v) for v in values) + ",)"

files = sorted(str(p.relative_to(root)) for p in (root / "DingDian").rglob("*.swift"))
for file in files:
    add(file, f"isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {q(file)}; sourceTree = SOURCE_ROOT;")
    add("build:" + file, f"isa = PBXBuildFile; fileRef = {ident(file)};")
add("license", 'isa = PBXFileReference; lastKnownFileType = text; path = "THIRD_PARTY_LICENSES.txt"; sourceTree = SOURCE_ROOT;')
add("license-build", f"isa = PBXBuildFile; fileRef = {ident('license')};")
add("product", 'isa = PBXFileReference; explicitFileType = wrapper.application; path = DingDian.app; sourceTree = BUILT_PRODUCTS_DIR;')
add("config", 'isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Config.xcconfig; sourceTree = SOURCE_ROOT;')
add("products", f"isa = PBXGroup; name = Products; children = {ids(['product'])}; sourceTree = \"<group>\";")
add("root", f"isa = PBXGroup; children = {ids(files + ['license','config','products'])}; sourceTree = \"<group>\";")
add("sources", f"isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = {ids(['build:' + p for p in files])}; runOnlyForDeploymentPostprocessing = 0;")
add("resources", f"isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = {ids(['license-build'])}; runOnlyForDeploymentPostprocessing = 0;")
add("frameworks", "isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;")
for config in ["Debug", "Release"]:
    add("project:" + config, f'isa = XCBuildConfiguration; name = {config}; buildSettings = {{ SDKROOT = iphoneos; SWIFT_VERSION = 5.0; IPHONEOS_DEPLOYMENT_TARGET = 18.0; CLANG_ENABLE_MODULES = YES; SWIFT_OPTIMIZATION_LEVEL = {q("-Onone" if config == "Debug" else "-O")}; }};')
    settings = {
        "PRODUCT_NAME": "DingDian", "PRODUCT_BUNDLE_IDENTIFIER": "com.yuanmy.dingdian.ios",
        "MARKETING_VERSION": release_version, "CURRENT_PROJECT_VERSION": release_build, "CODE_SIGN_STYLE": "Automatic",
        "GENERATE_INFOPLIST_FILE": "NO", "INFOPLIST_FILE": "DingDian/Info.plist",
        "TARGETED_DEVICE_FAMILY": "1", "SUPPORTED_PLATFORMS": "iphoneos", "SUPPORTS_MACCATALYST": "NO",
        "SWIFT_INCLUDE_PATHS": "$(PROJECT_DIR)/Vendor/idevice", "LIBRARY_SEARCH_PATHS": "$(PROJECT_DIR)/Vendor/idevice",
        "OTHER_LDFLAGS": "$(inherited) -lidevice_ffi -lc++ -lz -liconv -lresolv -framework Security -framework SystemConfiguration",
        "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks",
    }
    add("app:" + config, f"isa = XCBuildConfiguration; name = {config}; baseConfigurationReference = {ident('config')}; buildSettings = {{ " + " ".join(f"{k} = {q(v)};" for k, v in settings.items()) + " };")
for name in ["project", "app"]:
    add(name + "-configs", f"isa = XCConfigurationList; buildConfigurations = {ids([name + ':Debug', name + ':Release'])}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;")
add("app", f"isa = PBXNativeTarget; buildConfigurationList = {ident('app-configs')}; buildPhases = {ids(['sources','frameworks','resources'])}; buildRules = (); dependencies = (); name = DingDian; productName = DingDian; productReference = {ident('product')}; productType = \"com.apple.product-type.application\";")
add("project", f"isa = PBXProject; attributes = {{ LastUpgradeCheck = 2660; }}; buildConfigurationList = {ident('project-configs')}; compatibilityVersion = \"Xcode 14.0\"; developmentRegion = \"zh-Hans\"; knownRegions = (\"zh-Hans\",en,Base); mainGroup = {ident('root')}; productRefGroup = {ident('products')}; projectDirPath = \"\"; projectRoot = \"\"; targets = {ids(['app'])};")
project = root / "DingDian.xcodeproj"
project.mkdir(exist_ok=True)
(project / "project.pbxproj").write_text("// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n" + "\n".join(objects) + f"\n}}; rootObject = {ident('project')}; }}\n")
