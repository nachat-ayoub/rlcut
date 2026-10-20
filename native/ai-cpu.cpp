// CPU-only export helper. The parent enforces affinity, priority, memory and cancellation.
#include <net.h>
#include <png.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>
#include <sys/wait.h>
#include <unistd.h>
#include <cerrno>

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
void rife(const std::string& binary, const std::string& model, const std::string& a, const std::string& b, const std::string& out) {
    pid_t child = fork();
    if (child == -1) throw std::runtime_error("Cannot start tiled RIFE worker");
    if (child == 0) {
        execl(binary.c_str(), binary.c_str(), "-0", a.c_str(), "-1", b.c_str(), "-o", out.c_str(), "-m", model.c_str(), "-g", "-1", "-j", "1:1:1", (char*)nullptr);
        _exit(127);
    }
    int status=0; pid_t waited;
    do { waited = waitpid(child, &status, 0); } while (waited == -1 && errno == EINTR);
    if (waited == -1 || !WIFEXITED(status) || WEXITSTATUS(status) != 0) throw std::runtime_error("Tiled RIFE inference failed within the memory limit");
}
void interpolate(char** args) {
    const Image a=load(args[4]), b=load(args[5]);
    if (a.w!=b.w || a.h!=b.h) throw std::runtime_error("AI frame sizes differ");
    Image out(a.w, a.h);
    std::vector<float> sums((size_t)a.w*a.h*3, 0), weights((size_t)a.w*a.h, 0);
    const std::string directory=args[7], pa=directory+"/tile-a.png", pb=directory+"/tile-b.png", pm=directory+"/tile-mid.png";
    // 384px cores overlap by 64px; 64px context reduces motion and tile seams.
    // Every RIFE invocation sees at most 512x512, regardless of output resolution.
    for (int y=0; y<a.h; y+=320) for (int x=0; x<a.w; x+=320) {
        int cw=std::min(384,a.w-x), ch=std::min(384,a.h-y);
        int left=std::max(0,x-64), top=std::max(0,y-64);
        int right=std::min(a.w,x+cw+64), bottom=std::min(a.h,y+ch+64);
        save(crop(a,left,top,right-left,bottom-top),pa); save(crop(b,left,top,right-left,bottom-top),pb);
        std::remove(pm.c_str()); rife(args[2],args[3],pa,pb,pm);
        Image mid=load(pm);
        if (mid.w!=right-left || mid.h!=bottom-top) throw std::runtime_error("RIFE returned unexpected tile dimensions");
        for (int row=0; row<ch; ++row) for (int col=0; col<cw; ++col) {
            float wx=std::min({1.f,(col+1)/32.f,(cw-col)/32.f});
            float wy=std::min({1.f,(row+1)/32.f,(ch-row)/32.f});
            size_t target=(size_t)(y+row)*a.w+x+col, source=(size_t)(y-top+row)*mid.w+x-left+col;
            float weight=wx*wy; weights[target]+=weight;
            for (int c=0;c<3;++c) sums[target*3+c]+=mid.rgb[source*3+c]*weight;
        }
    }
    for (size_t i=0;i<weights.size();++i) for (int c=0;c<3;++c)
        out.rgb[i*3+c]=(unsigned char)std::clamp(std::lround(sums[i*3+c]/weights[i]),0L,255L);
    save(out,args[6]);
}
void upscale(char** args) {
    ncnn::Net net;
    net.opt.num_threads=1; net.opt.use_packing_layout=false; net.opt.use_vulkan_compute=false;
    net.opt.use_fp16_storage=false; net.opt.use_fp16_arithmetic=false;
    if (net.load_param(args[2]) || net.load_model(args[3])) throw std::runtime_error("Cannot load AI upscale model");
    const Image input=load(args[4]); Image output(input.w*2,input.h*2);
    const float normalization[3]={1.f/255,1.f/255,1.f/255};
    // A 64px core with 32px context bounds working memory. Network output is
    // cropped to the core, retaining context rather than exposing tile borders.
    for (int y=0;y<input.h;y+=64) for (int x=0;x<input.w;x+=64) {
        int cw=std::min(64,input.w-x), ch=std::min(64,input.h-y);
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
    }
    save(output,args[5]);
}
int main(int argc,char** argv) {
    try {
        if (argc==8 && std::string(argv[1])=="interpolate") interpolate(argv);
        else if (argc==6 && std::string(argv[1])=="upscale") upscale(argv);
        else throw std::runtime_error("Invalid AI CPU helper arguments");
        return 0;
    } catch (const std::exception& error) { std::fprintf(stderr,"AI CPU worker: %s\n",error.what());return 1; }
}
