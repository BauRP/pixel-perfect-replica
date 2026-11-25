// SoundWorld AR: invoke the actual Alibaba MNN 3.6.1 raw-token interface.
// Built only with the official MNN checkout, no placeholder native code.
#include <jni.h>
#include <llm/llm.hpp>
#include <memory>
#include <string>
#include <vector>
#include <stdexcept>

using MNN::Transformer::Llm;

static void fail(JNIEnv* env, const char* text) {
    jclass type=env->FindClass("java/lang/IllegalStateException");
    if(type)env->ThrowNew(type,text);
}

extern "C" JNIEXPORT jintArray JNICALL
Java_kz_soundworld_ar_SoundWorldFermataPlugin_generateMnnIds(
    JNIEnv* env,jclass,jstring configPath,jintArray input,jint maximum,jint threads,jint diversity) {
    try {
        if(!configPath||!input||maximum<1||maximum>4096||threads<1||threads>2||diversity<0||diversity>2)
            throw std::runtime_error("Invalid model request");
        const jsize count=env->GetArrayLength(input);
        if(count<1||count>32||count+maximum>4096)throw std::runtime_error("Invalid prompt length");
        std::vector<jint> javaIds(count);
        env->GetIntArrayRegion(input,0,count,javaIds.data());
        if(env->ExceptionCheck())return nullptr;
        std::vector<int> ids(javaIds.begin(),javaIds.end());
        for(int id:ids)if(id<0||id>=9507)throw std::runtime_error("Invalid token");
        const char* path=env->GetStringUTFChars(configPath,nullptr);
        if(!path)return nullptr;
        std::string config(path);
        env->ReleaseStringUTFChars(configPath,path);
        std::unique_ptr<Llm,decltype(&Llm::destroy)> model(
            Llm::createLLM(config),&Llm::destroy);
        if(!model)throw std::runtime_error("Cannot open MNN config");
        // Keep the checkpoint and original IDs intact. Diversity controls
        // sampling of actual model logits rather than fabricated melodies.
        const char* temperature=diversity==0?"0.60":diversity==1?"0.70":"0.90";
        const char* topK=diversity==0?"16":diversity==1?"24":"40";
        const std::string options="{\"backend_type\":\"cpu\",\"thread_num\":"+std::to_string(threads)+
            ",\"reuse_kv\":false,\"sampler_type\":\"mixed\",\"mixed_samplers\":[\"penalty\",\"topK\",\"temperature\"],"+
            "\"top_k\":"+topK+",\"temperature\":"+temperature+
            ",\"repetition_penalty\":1.12,\"frequency_penalty\":0.0,\"timeout_ms\":110000}";
        if(!model->set_config(options)||
           !model->load())throw std::runtime_error("Cannot load actual weights");
        model->generate_init();
        std::vector<int> result=model->generate(ids,maximum);
        if(result.empty()||result.size()>static_cast<size_t>(maximum))
            throw std::runtime_error("No valid MNN output");
        const auto status=model->getContext()->status;
        using MNN::Transformer::LlmStatus;
        if(status!=LlmStatus::NORMAL_FINISHED&&status!=LlmStatus::MAX_TOKENS_FINISHED)
            throw std::runtime_error("MNN generation failed");
        std::vector<jint> output;
        output.reserve(result.size());
        for(int id:result){
            if(id<0||id>=9507)throw std::runtime_error("Unknown output token");
            output.push_back(id);
        }
        jintArray array=env->NewIntArray(static_cast<jsize>(output.size()));
        if(array)env->SetIntArrayRegion(array,0,static_cast<jsize>(output.size()),output.data());
        return array;
    }catch(const std::exception& e){
        fail(env,e.what());
    }catch(...){
        fail(env,"Native MNN exception");
    }
    return nullptr;
}
