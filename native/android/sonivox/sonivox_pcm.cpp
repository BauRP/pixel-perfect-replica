// Own SoundWorld adapter for Sonivox EAS, using its real PCM output.
// Native library is not part of production APK until reviewed and packaged.
#include <jni.h>
#include <eas.h>
#include <cstdio>
#include <cstdint>
#include <vector>
#include <algorithm>
#include <stdexcept>
#include <memory>
#include <string>

static int readAt(void* handle,void* bytes,int offset,int size){
    FILE* file=static_cast<FILE*>(handle);
    if(fseek(file,offset,SEEK_SET)!=0)return 0;
    return static_cast<int>(fread(bytes,1,size,file));
}
static int fileSize(void* handle){
    FILE* file=static_cast<FILE*>(handle);
    if(fseek(file,0,SEEK_END)!=0)return -1;
    return static_cast<int>(ftell(file));
}
struct Engine {
    EAS_DATA_HANDLE data=nullptr;
    EAS_HANDLE stream=nullptr;
    ~Engine(){if(stream&&data)EAS_CloseFile(data,stream);if(data)EAS_Shutdown(data);}
};
static std::string path(JNIEnv* env,jstring value){
    if(!value)throw std::runtime_error("Missing private file path");
    const char* chars=env->GetStringUTFChars(value,nullptr);
    if(!chars)throw std::runtime_error("Invalid path");
    std::string result(chars);env->ReleaseStringUTFChars(value,chars);return result;
}
extern "C" JNIEXPORT jlong JNICALL
Java_kz_soundworld_ar_SoundWorldFermataPlugin_renderSonivoxFile(
    JNIEnv* env,jclass,jstring midiPath,jstring pcmPath,jlong frames){
    try{
        if(frames<60*48000LL||frames>120*48000LL)throw std::runtime_error("Invalid score duration");
        const auto midi=path(env,midiPath),pcm=path(env,pcmPath);
        using File=std::unique_ptr<FILE,decltype(&fclose)>;
        File input(fopen(midi.c_str(),"rb"),&fclose),output(fopen(pcm.c_str(),"wb"),&fclose);
        if(!input||!output)throw std::runtime_error("Cannot open local score");
        Engine e;
        if(EAS_Init(&e.data)!=EAS_SUCCESS||!e.data)throw std::runtime_error("EAS init");
        EAS_FILE file{};file.handle=input.get();file.readAt=readAt;file.size=fileSize;
        if(EAS_OpenFile(e.data,&file,&e.stream)!=EAS_SUCCESS||!e.stream||
           EAS_Prepare(e.data,e.stream)!=EAS_SUCCESS)throw std::runtime_error("EAS open");
        const auto* config=EAS_Config();
        if(!config||config->numChannels!=2||config->sampleRate!=22050||
           config->mixBufferSize<=0||config->mixBufferSize>4096||sizeof(EAS_PCM)!=2)
            throw std::runtime_error("Unsupported synth format");
        // Resample the actual stereo waveform incrementally. Exact rational
        // phase keeps chunk boundaries continuous, with bounded RAM.
        std::vector<EAS_PCM> block(config->mixBufferSize*2);
        std::vector<int16_t> out;out.reserve(8192);
        int64_t sourceIndex=-1,nextOutput=0;
        int16_t previous[2]={0,0};
        while(nextOutput<frames){
            EAS_STATE state;
            if(EAS_State(e.data,e.stream,&state)!=EAS_SUCCESS||
               state==EAS_STATE_ERROR||state==EAS_STATE_STOPPED)
                throw std::runtime_error("Synth ended before requested duration");
            EAS_I32 count=0;
            if(EAS_Render(e.data,block.data(),config->mixBufferSize,&count)!=EAS_SUCCESS||
               count<=0||count>config->mixBufferSize)throw std::runtime_error("EAS render");
            for(int i=0;i<count&&nextOutput<frames;i++){
                ++sourceIndex;
                const int16_t current[2]={static_cast<int16_t>(block[i*2]),static_cast<int16_t>(block[i*2+1])};
                if(sourceIndex==0){previous[0]=current[0];previous[1]=current[1];}
                while(nextOutput<frames&&nextOutput*22050LL<=sourceIndex*48000LL){
                    const int64_t fraction=sourceIndex==0?48000:
                        nextOutput*22050LL-(sourceIndex-1)*48000LL;
                    for(int c=0;c<2;c++){
                        const int64_t sample=(previous[c]*(48000-fraction)+current[c]*fraction)/48000;
                        out.push_back(static_cast<int16_t>(sample));
                    }
                    ++nextOutput;
                    if(out.size()>=8192){
                        if(fwrite(out.data(),sizeof(int16_t),out.size(),output.get())!=out.size())
                            throw std::runtime_error("PCM write failed");
                        out.clear();
                    }
                }
                previous[0]=current[0];previous[1]=current[1];
            }
        }
        if(!out.empty()&&fwrite(out.data(),sizeof(int16_t),out.size(),output.get())!=out.size())
            throw std::runtime_error("PCM write failed");
        if(fflush(output.get())!=0)throw std::runtime_error("PCM flush failed");
        return static_cast<jlong>(nextOutput);
    }catch(const std::exception& error){
        jclass type=env->FindClass("java/lang/IllegalStateException");
        if(type)env->ThrowNew(type,error.what());
        return 0;
    }
}
