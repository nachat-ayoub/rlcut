/* Native playback owns decoding, audio output, clock and bounded frame queues.
 * appsink declarations are stable public ABI; no private WebKit media objects. */
#include <gst/gst.h>
#include <string.h>
typedef struct _GstAppSink GstAppSink;
extern GstSample *gst_app_sink_try_pull_sample(GstAppSink *, GstClockTime);
extern GstSample *gst_app_sink_try_pull_preroll(GstAppSink *, GstClockTime);
typedef struct { GstElement *pipeline, *sink; GstBus *bus; int playing; } Player;
static void copy_error(char *target, size_t size, const char *message) { g_strlcpy(target, message ? message : "Native media error", size); }
void rl_player_free(Player *p) {
  if (!p) return;
  gst_element_set_state(p->pipeline, GST_STATE_NULL);
  gst_object_unref(p->bus); gst_object_unref(p->sink); gst_object_unref(p->pipeline); g_free(p);
}
Player *rl_player_open(const char *path, int width, int height, char *error, size_t size) {
  GError *issue = NULL;
  if (!gst_init_check(NULL, NULL, &issue)) { copy_error(error,size,issue->message); g_error_free(issue); return NULL; }
  char *uri = g_filename_to_uri(path, NULL, &issue);
  if (!uri) { copy_error(error,size,issue->message); g_error_free(issue); return NULL; }
  GstElement *pipeline = gst_element_factory_make("playbin", NULL);
  char *description = g_strdup_printf("videoconvert ! videoscale ! video/x-raw,format=RGBA,width=%d,height=%d,pixel-aspect-ratio=1/1 ! appsink name=frames sync=true max-buffers=1 drop=true wait-on-eos=false", width,height);
  GstElement *video = gst_parse_bin_from_description(description, TRUE, &issue); g_free(description);
  if (!pipeline || !video || issue) {
    copy_error(error,size,issue ? issue->message : "Bundled native playback plugins are missing");
    if (issue) g_error_free(issue); if (video) gst_object_unref(video); if (pipeline) gst_object_unref(pipeline); g_free(uri); return NULL;
  }
  gst_object_ref_sink(video);
  gst_object_ref_sink(pipeline);
  GstElement *sink = gst_bin_get_by_name(GST_BIN(video), "frames");
  g_object_set(pipeline, "uri",uri,"video-sink",video,NULL); g_free(uri); gst_object_unref(video);
  Player *p = g_new0(Player,1); p->pipeline=pipeline;p->sink=sink;p->bus=gst_element_get_bus(pipeline);
  if (gst_element_set_state(pipeline,GST_STATE_PAUSED)==GST_STATE_CHANGE_FAILURE || gst_element_get_state(pipeline,NULL,NULL,5*GST_SECOND)==GST_STATE_CHANGE_FAILURE) {
    GstMessage *m=gst_bus_pop_filtered(p->bus,GST_MESSAGE_ERROR);
    if(m){gst_message_parse_error(m,&issue,NULL);copy_error(error,size,issue->message);g_error_free(issue);gst_message_unref(m);}else copy_error(error,size,"Cannot prepare native decoder");
    rl_player_free(p);return NULL;
  }
  return p;
}
int rl_player_play(Player *p, int playing) {
  p->playing=playing;
  return gst_element_set_state(p->pipeline,playing?GST_STATE_PLAYING:GST_STATE_PAUSED)!=GST_STATE_CHANGE_FAILURE;
}
int rl_player_seek(Player *p, double seconds) {
  gint64 duration=0;
  if(gst_element_query_duration(p->pipeline,GST_FORMAT_TIME,&duration)&&duration>0)seconds=MAX(0.,MIN(seconds,(double)duration/GST_SECOND-0.04));
  return gst_element_seek_simple(p->pipeline,GST_FORMAT_TIME,GST_SEEK_FLAG_FLUSH|GST_SEEK_FLAG_ACCURATE,(gint64)(seconds*GST_SECOND));
}
double rl_player_position(Player *p) { gint64 time=0;gst_element_query_position(p->pipeline,GST_FORMAT_TIME,&time);return (double)time/GST_SECOND; }
int rl_player_status(Player *p,char *error,size_t size) {
  GstMessage *m=gst_bus_pop_filtered(p->bus,GST_MESSAGE_ERROR|GST_MESSAGE_EOS);
  if(!m)return 0;
  int status=GST_MESSAGE_TYPE(m)==GST_MESSAGE_EOS?1:-1;
  if(status<0){GError *issue=NULL;gst_message_parse_error(m,&issue,NULL);copy_error(error,size,issue->message);g_error_free(issue);}
  gst_message_unref(m);return status;
}
/* Return a malloc-owned, tightly packed RGBA frame. Native queues retain only
 * one pending frame; the caller never downloads a growing event backlog. */
unsigned char *rl_player_frame(Player *p,int width,int height,double *pts) {
  GstSample *sample=p->playing?gst_app_sink_try_pull_sample((GstAppSink*)p->sink,0):gst_app_sink_try_pull_preroll((GstAppSink*)p->sink,0);
  if(!sample)return NULL;
  GstBuffer *buffer=gst_sample_get_buffer(sample);GstMapInfo map;
  unsigned char *result=NULL;
  if(gst_buffer_map(buffer,&map,GST_MAP_READ)){
    size_t row=(size_t)width*4,stride=map.size/(size_t)height;
    if(stride>=row&&map.size>=row*(size_t)height){
      result=g_malloc(row*(size_t)height);
      for(int y=0;y<height;y++)memcpy(result+(size_t)y*row,map.data+(size_t)y*stride,row);
      *pts=GST_BUFFER_PTS_IS_VALID(buffer)?(double)GST_BUFFER_PTS(buffer)/GST_SECOND:rl_player_position(p);
    }
    gst_buffer_unmap(buffer,&map);
  }
  gst_sample_unref(sample);return result;
}
void rl_frame_free(unsigned char *frame){g_free(frame);}
