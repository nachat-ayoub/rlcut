// CPU-only export helper. The parent enforces affinity, priority, memory and cancellation.
#include <net.h>
#include <png.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include <sys/wait.h>
#include <unistd.h>
#include <cerrno>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <fstream>

struct Image {
    int w, h;
    std::vector<unsigned char> rgb;
    Image(int width, int height): w(width), h(height) {
        if (w <= 0 || h <= 0 || w > 8192 || h > 8192 || (long long)w*h > 34000000)
            throw std::runtime_error("AI image dimensions exceed the safety limit");
        rgb.resize((size_t)w*h*3);
    }
};
Image load(const std::string& path) {
    png_image image{}; image.version = PNG_IMAGE_VERSION;
    if (!png_image_begin_read_from_file(&image, path.c_str())) throw std::runtime_error("Cannot read AI input PNG");
    struct Release { png_image* image; ~Release() { png_image_free(image); } } release{&image};
    Image result(image.width, image.height); image.format = PNG_FORMAT_RGB;
    if (!png_image_finish_read(&image, nullptr, result.rgb.data(), 0, nullptr)) throw std::runtime_error("Cannot decode AI input PNG");
    return result;
}
void save(const Image& data, const std::string& path) {
    png_image image{}; image.version = PNG_IMAGE_VERSION; image.width = data.w; image.height = data.h; image.format = PNG_FORMAT_RGB;
    if (!png_image_write_to_file(&image, path.c_str(), 0, data.rgb.data(), 0, nullptr)) throw std::runtime_error("Cannot write AI output PNG");
}
Image crop(const Image& in, int x, int y, int w, int h) {
    Image out(w, h);
    for (int row=0; row<h; ++row) std::copy_n(in.rgb.data()+((size_t)(row+y)*in.w+x)*3, (size_t)w*3, out.rgb.data()+(size_t)row*w*3);
    return out;
}
int worker_threads() {
    const char* value=std::getenv("RLCUT_AI_THREADS");
    int threads=value ? std::atoi(value) : (int)std::thread::hardware_concurrency();
    return std::clamp(threads,1,4);
}
void progress(const char* path,int done,int total) {
    if (!path || !*path) return;
    if (FILE* file=std::fopen(path,"w")) { std::fprintf(file,"%d/%d\n",done,total); std::fclose(file); }
}
// CPU Warp and non-TTA RIFE v4 inference adapted from nihui/rife-ncnn-vulkan
// 20221029 (MIT, bundled RIFE-LICENSE). No Vulkan or subprocess per tile.
class CpuWarp : public ncnn::Layer {
public:
    int forward(const std::vector<ncnn::Mat>& in, std::vector<ncnn::Mat>& out, const ncnn::Option& opt) const override {
        const auto& image=in[0]; const auto& flow=in[1];
        out[0].create(image.w,image.h,image.c);
        if (out[0].empty()) return -100;
        #pragma omp parallel for num_threads(opt.num_threads)
        for(int c=0;c<image.c;++c) {
            auto channel=image.channel(c); float* dest=out[0].channel(c);
            const float* fx=flow.channel(0); const float* fy=flow.channel(1);
            for(int y=0;y<image.h;++y) for(int x=0;x<image.w;++x) {
                size_t i=(size_t)y*image.w+x;
                float sx=x+fx[i],sy=y+fy[i];
                int x0=std::clamp((int)std::floor(sx),0,image.w-1),y0=std::clamp((int)std::floor(sy),0,image.h-1);
                int x1=std::clamp((int)std::floor(sx)+1,0,image.w-1),y1=std::clamp((int)std::floor(sy)+1,0,image.h-1);
                float ax=sx-x0,ay=sy-y0;
                dest[i]=(channel.row(y0)[x0]*(1-ax)+channel.row(y0)[x1]*ax)*(1-ay)+(channel.row(y1)[x0]*(1-ax)+channel.row(y1)[x1]*ax)*ay;
            }
        }
        return 0;
    }
};
DEFINE_LAYER_CREATOR(CpuWarp)
std::unique_ptr<ncnn::Net> rife_net, upscale_net;
void configure(ncnn::Net& net) {
    net.opt.num_threads=worker_threads(); net.opt.use_packing_layout=true;
    net.opt.use_vulkan_compute=false;net.opt.use_fp16_storage=false;net.opt.use_fp16_arithmetic=false;
}
Image rife(const std::string& model, const Image& a, const Image& b) {
    if (!rife_net) {
        rife_net=std::make_unique<ncnn::Net>(); configure(*rife_net);
        rife_net->register_custom_layer("rife.Warp",CpuWarp_layer_creator);
        if(rife_net->load_param((model+"/flownet.param").c_str()) || rife_net->load_model((model+"/flownet.bin").c_str())) throw std::runtime_error("Cannot load RIFE model");
    }
    auto prepare=[](const Image& in) {
        auto rgb=ncnn::Mat::from_pixels(in.rgb.data(),ncnn::Mat::PIXEL_RGB,in.w,in.h);
        const float norm[]={1.f/255,1.f/255,1.f/255};rgb.substract_mean_normalize(nullptr,norm);
        ncnn::Mat padded;ncnn::copy_make_border(rgb,padded,0,(in.h+31)/32*32-in.h,0,(in.w+31)/32*32-in.w,ncnn::BORDER_CONSTANT,0.f);
        return padded;
    };
    auto first=prepare(a),second=prepare(b); ncnn::Mat time(first.w,first.h,1);time.fill(.5f);
    auto ex=rife_net->create_extractor();ex.set_light_mode(true);ncnn::Mat result;
    if(ex.input("in0",first) || ex.input("in1",second) || ex.input("in2",time) || ex.extract("out0",result)) throw std::runtime_error("RIFE CPU inference failed");
    if(result.w<a.w || result.h<a.h || result.c!=3) throw std::runtime_error("Invalid RIFE tensor dimensions");
    Image out(a.w,a.h);
    for(int c=0;c<3;++c) for(int y=0;y<a.h;++y) for(int x=0;x<a.w;++x)
        out.rgb[((size_t)y*a.w+x)*3+c]=(unsigned char)std::clamp(std::lround(result.channel(c).row(y)[x]*255),0L,255L);
    return out;
}
void interpolate(char** args,const char* status) {
    const Image a=load(args[4]), b=load(args[5]);
    if (a.w!=b.w || a.h!=b.h) throw std::runtime_error("AI frame sizes differ");
    Image out(a.w, a.h);
    std::vector<float> sums((size_t)a.w*a.h*3, 0), weights((size_t)a.w*a.h, 0);
    // Larger overlapping cores substantially reduce model/process startup overhead while
    // retaining the same 64px motion context and feathered seams.
    constexpr int step=576, core=640;
    const int total=((a.w+step-1)/step)*((a.h+step-1)/step); int done=0;
    progress(status,done,total);
    for (int y=0; y<a.h; y+=step) for (int x=0; x<a.w; x+=step) {
        int cw=std::min(core,a.w-x), ch=std::min(core,a.h-y);
        int left=std::max(0,x-64), top=std::max(0,y-64);
        int right=std::min(a.w,x+cw+64), bottom=std::min(a.h,y+ch+64);
        Image mid=rife(args[3],crop(a,left,top,right-left,bottom-top),crop(b,left,top,right-left,bottom-top));
        if (mid.w!=right-left || mid.h!=bottom-top) throw std::runtime_error("RIFE returned unexpected tile dimensions");
        for (int row=0; row<ch; ++row) for (int col=0; col<cw; ++col) {
            float wx=std::min({1.f,(col+1)/32.f,(cw-col)/32.f});
            float wy=std::min({1.f,(row+1)/32.f,(ch-row)/32.f});
            size_t target=(size_t)(y+row)*a.w+x+col, source=(size_t)(y-top+row)*mid.w+x-left+col;
            float weight=wx*wy; weights[target]+=weight;
            for (int c=0;c<3;++c) sums[target*3+c]+=mid.rgb[source*3+c]*weight;
        }
        progress(status,++done,total);
    }
    for (size_t i=0;i<weights.size();++i) for (int c=0;c<3;++c)
        out.rgb[i*3+c]=(unsigned char)std::clamp(std::lround(sums[i*3+c]/weights[i]),0L,255L);
    save(out,args[6]);
}
void upscale(char** args,const char* status) {
    if(!upscale_net) {
        upscale_net=std::make_unique<ncnn::Net>(); configure(*upscale_net);
        if(upscale_net->load_param(args[2]) || upscale_net->load_model(args[3])) throw std::runtime_error("Cannot load AI upscale model");
    }
    auto& net=*upscale_net;
    const Image input=load(args[4]); Image output(input.w*2,input.h*2);
    const float normalization[3]={1.f/255,1.f/255,1.f/255};
    // A 256px core with 32px context keeps memory bounded while avoiding hundreds
    // of tiny extractor calls per frame. Network output is
    // cropped to the core, retaining context rather than exposing tile borders.
    constexpr int core=256;
    const int total=((input.w+core-1)/core)*((input.h+core-1)/core); int done=0;
    progress(status,done,total);
    for (int y=0;y<input.h;y+=core) for (int x=0;x<input.w;x+=core) {
        int cw=std::min(core,input.w-x), ch=std::min(core,input.h-y);
        int left=std::max(0,x-32), top=std::max(0,y-32);
        int right=std::min(input.w,x+cw+32), bottom=std::min(input.h,y+ch+32);
        Image patch=crop(input,left,top,right-left,bottom-top);
        ncnn::Mat data=ncnn::Mat::from_pixels(patch.rgb.data(),ncnn::Mat::PIXEL_RGB,patch.w,patch.h);
        data.substract_mean_normalize(nullptr,normalization);
        auto extractor=net.create_extractor(); extractor.set_light_mode(true);
        ncnn::Mat result;
        if (extractor.input("data",data) || extractor.extract("output",result)) throw std::runtime_error("AI upscale inference failed");
        if (result.w!=patch.w*2 || result.h!=patch.h*2 || result.c!=3) throw std::runtime_error("Unexpected AI upscale output size");
        for (int row=0;row<ch*2;++row) for (int col=0;col<cw*2;++col) for (int c=0;c<3;++c) {
            const float value=result.channel(c).row((y-top)*2+row)[(x-left)*2+col];
            output.rgb[((size_t)(y*2+row)*output.w+x*2+col)*3+c]=(unsigned char)std::clamp(std::lround(value*255),0L,255L);
        }
        progress(status,++done,total);
    }
    save(output,args[5]);
}
// Fixed filenames inside a private per-job working directory keep the command
// protocol independent of Unicode paths, shell quoting and user-provided text.
void serve(const std::string& folder) {
    std::string mode;
    while(std::getline(std::cin,mode)) {
        std::remove("worker-result");
        try {
            if(mode=="interpolate") {
                std::vector<std::string> fields={"worker","interpolate","unused",folder+"/rife-v4.6","before.png","after.png","middle.png","."};
                std::vector<char*> args;for(auto& f:fields)args.push_back(f.data());interpolate(args.data(),"rife-progress");
            } else if(mode=="upscale") {
                std::vector<std::string> fields={"worker","upscale",folder+"/realesr-animevideov3-x2.param",folder+"/realesr-animevideov3-x2.bin","upscale-in.png","upscale-out.png"};
                std::vector<char*> args;for(auto& f:fields)args.push_back(f.data());upscale(args.data(),"upscale-progress");
            } else if(mode=="blend") {
                Image a=load("before.png"),b=load("after.png");
                if(a.w!=b.w || a.h!=b.h)throw std::runtime_error("Frame sizes differ");
                for(size_t i=0;i<a.rgb.size();++i)a.rgb[i]=(unsigned char)(((unsigned)a.rgb[i]+b.rgb[i]+1)/2);
                save(a,"middle.png");
            } else if(mode=="resize") {
                Image a=load("upscale-in.png"),out(a.w*2,a.h*2);
                auto data=ncnn::Mat::from_pixels(a.rgb.data(),ncnn::Mat::PIXEL_RGB,a.w,a.h);ncnn::Mat resized;
                ncnn::resize_bicubic(data,resized,out.w,out.h);resized.to_pixels(out.rgb.data(),ncnn::Mat::PIXEL_RGB);save(out,"upscale-out.png");
            } else throw std::runtime_error("Unknown worker command");
            std::ofstream("worker-result.tmp")<<"ok";
        } catch(const std::exception& e) {std::ofstream("worker-result.tmp")<<"error: "<<e.what();}
        if(std::rename("worker-result.tmp","worker-result")!=0) throw std::runtime_error("Cannot publish worker result");
    }
}
int main(int argc,char** argv) {
    try {
        if(argc==3 && std::string(argv[1])=="serve") serve(argv[2]);
        else if ((argc==8 || argc==9) && std::string(argv[1])=="interpolate") interpolate(argv,argc==9?argv[8]:nullptr);
        else if ((argc==6 || argc==7) && std::string(argv[1])=="upscale") upscale(argv,argc==7?argv[6]:nullptr);
        else throw std::runtime_error("Invalid AI CPU helper arguments");
        return 0;
    } catch (const std::exception& error) { std::fprintf(stderr,"AI CPU worker: %s\n",error.what());return 1; }
}
