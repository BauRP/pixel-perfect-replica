#!/usr/bin/env python3
"""Verify the actual compiled APK contains offline YAMNet and Android 12 minSdk.

AndroidManifest.xml is AXML binary XML, so decode the uses-sdk tag directly
rather than depending on aapt2's version-specific human-readable output.
"""
import struct
import sys
import zipfile

def u16(b,p): return struct.unpack_from("<H",b,p)[0]
def u32(b,p): return struct.unpack_from("<I",b,p)[0]
def length8(b,p):
    k=b[p];p+=1
    if k&128:k=((k&127)<<8)|b[p];p+=1
    return k,p
def length16(b,p):
    k=u16(b,p);p+=2
    if k&32768:k=((k&32767)<<16)|u16(b,p);p+=2
    return k,p
def verify(path):
    with zipfile.ZipFile(path) as z:
        name="assets/yamnet.tflite"
        assert name in z.namelist(), "YAMNet model missing from final APK"
        assert z.getinfo(name).file_size >= 1000000, "YAMNet asset abnormally small"
        # Emulator testing uses x86_64. Actual Android phones typically use
        # arm64-v8a. Ensure MediaPipe native libraries are packaged for both.
        native_entries = [n for n in z.namelist() if n.startswith("lib/") and n.endswith(".so")]
        assert native_entries, "APK contains no native libraries: MediaPipe runtime not packaged"
        libs_by_abi = {}
        for name in native_entries:
            parts = name.split("/")
            if len(parts) == 3:
                libs_by_abi.setdefault(parts[1], set()).add(parts[2])
        for abi in ("arm64-v8a", "x86_64"):
            assert abi in libs_by_abi, f"No native libraries for {abi} in APK"
        missing_arm64 = sorted(libs_by_abi["x86_64"] - libs_by_abi["arm64-v8a"])
        assert not missing_arm64, f"Native libraries absent for physical arm64 phones: {missing_arm64}"
        print(f"VERIFIED: {len(libs_by_abi['arm64-v8a'])} arm64 phone libraries and {len(libs_by_abi['x86_64'])} x86_64 emulator libraries")
        data=z.read("AndroidManifest.xml")
    assert u16(data,0)==3, "Not an Android binary manifest"
    strings=[]
    sdk={}
    package=None
    pos=8
    while pos<len(data):
        typ,header,size=struct.unpack_from("<HHI",data,pos)
        assert size>=header and size>0 and pos+size<=len(data),"Malformed Android manifest"
        if typ==1:
            count,_,flags,start,_=struct.unpack_from("<IIIII",data,pos+8)
            strings=[]
            for i in range(count):
                off=u32(data,pos+header+i*4)
                p=pos+start+off
                if flags&256:
                    _,p=length8(data,p);n,p=length8(data,p)
                    value=data[p:p+n].decode("utf-8")
                else:
                    n,p=length16(data,p)
                    value=data[p:p+2*n].decode("utf-16le")
                strings.append(value)
        elif typ==0x102 and strings:
            _,_,_,tag_idx,attr_start,attr_size,attr_count=struct.unpack_from("<IIIIHHH",data,pos+8)
            assert tag_idx < len(strings)
            tag=strings[tag_idx]
            if tag in ("uses-sdk","manifest"):
                for i in range(attr_count):
                    q=pos+16+attr_start+i*attr_size
                    _,attr,raw,_,_,value_type,value=struct.unpack_from("<IIIHBBI",data,q)
                    assert attr < len(strings)
                    key=strings[attr]
                    if value_type==0x10:
                        val=value
                    elif raw!=0xFFFFFFFF and raw<len(strings):
                        val=strings[raw]
                    else:
                        continue
                    if tag=="uses-sdk":sdk[key]=val
                    elif key=="package":package=val
        pos+=size
    # The persistent saved-WAV service must be in the COMPILED APK, not just
    # declared in source: Capacitor dynamically regenerates AndroidManifest.
    assert ".SoundWorldClipPlaybackService" in strings, "Persistent WAV service not registered in APK"
    assert "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" in strings, "Foreground media permission missing"
    assert "android.permission.WAKE_LOCK" in strings, "MediaPlayer wake lock permission missing"
    assert sdk.get("minSdkVersion")==31, f"Expected minSdk 31, actual: {sdk}"
    assert package=="kz.soundworld.ar", f"Unexpected application ID: {package}"
    print(f"VERIFIED: YAMNet bundled; minSdk={sdk['minSdkVersion']}; targetSdk={sdk.get('targetSdkVersion')}; package={package}")
if __name__=="__main__":
    assert len(sys.argv)==2,"Usage: verify_android_apk.py app-debug.apk"
    verify(sys.argv[1])
